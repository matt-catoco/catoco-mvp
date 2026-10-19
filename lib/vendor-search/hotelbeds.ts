import "server-only";
import { createHash } from "node:crypto";
import type { TravelersBreakdown } from "@/lib/trip-elements";
import type { VendorSearchParams, VendorSearchResponse, VendorSearchResult } from "./types";

// Hotelbeds APItude (founder, 2026-10-19) — SEARCH AND PRICE ONLY. No booking,
// confirm, modify or cancel call exists here, and no "Book" link: Hotelbeds is
// a B2B API with no consumer checkout. Prices shown are Hotelbeds' quoted
// amounts (net, or the selling rate when the hotel mandates one) — never a
// Catoco markup. Seller of record is unknown until Hotelbeds answers.
//
// One key + secret PER SUITE (Hotels, Activities, Transfers), read from env.
// Every request is signed: X-Signature = sha256hex(apiKey + secret + unix
// seconds), regenerated per request, server-side only.
//
// Test keys allow ~50 requests/day: everything is cached briefly in memory,
// and a 403/429 (quota) or any failure makes this source drop out quietly —
// the aggregators fall back to the other vendors, or to mock data.

export type HotelbedsSuite = "hotels" | "activities" | "transfers";

const BASE = () => (process.env.HOTELBEDS_BASE_URL || "https://api.test.hotelbeds.com").replace(/\/+$/, "");
const TIMEOUT_MS = 12_000;
const AVAILABILITY_TTL_MS = 10 * 60_000;
const CONTENT_TTL_MS = 24 * 60 * 60_000;
const MAX_RESULTS = 12;

function creds(suite: HotelbedsSuite): { key: string; secret: string } | null {
  const up = suite.toUpperCase();
  const key = process.env[`HOTELBEDS_${up}_API_KEY`];
  const secret = process.env[`HOTELBEDS_${up}_SECRET`];
  return key && secret ? { key, secret } : null;
}

export function hotelbedsConfigured(suite: HotelbedsSuite): boolean {
  return creds(suite) !== null;
}

export function hotelbedsLabel(): string {
  return BASE().includes("api.test.") ? "Hotelbeds (test)" : "Hotelbeds";
}

/** Quota exhausted or access refused — the source drops out, nothing crashes. */
export class HotelbedsUnavailableError extends Error {}

// Per-instance memo (serverless instances don't share it, but repeat searches
// on a warm instance — the common case while someone is comparing — are free).
const memo = new Map<string, { at: number; ttl: number; value: unknown }>();
function cached<T>(key: string): T | undefined {
  const hit = memo.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > hit.ttl) {
    memo.delete(key);
    return undefined;
  }
  return hit.value as T;
}
function remember(key: string, value: unknown, ttl: number) {
  if (memo.size > 500) memo.clear();
  memo.set(key, { at: Date.now(), ttl, value });
}

async function hbFetch<T>(suite: HotelbedsSuite, path: string, init: { method?: "GET" | "POST"; body?: unknown; ttl: number }): Promise<T> {
  const c = creds(suite);
  if (!c) throw new HotelbedsUnavailableError(`Hotelbeds ${suite} isn't configured`);
  const cacheKey = `${suite}|${path}|${init.body ? JSON.stringify(init.body) : ""}`;
  const hit = cached<T>(cacheKey);
  if (hit !== undefined) return hit;

  const ts = Math.floor(Date.now() / 1000);
  const signature = createHash("sha256").update(`${c.key}${c.secret}${ts}`).digest("hex");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE()}${path}`, {
      method: init.method ?? "GET",
      headers: {
        "Api-key": c.key,
        "X-Signature": signature,
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 403 || res.status === 429) {
      // Never log the response body wholesale; the status says enough.
      throw new HotelbedsUnavailableError(`Hotelbeds ${suite} refused the request (${res.status}) — quota or access`);
    }
    if (!res.ok) throw new Error(`Hotelbeds ${suite} ${path.split("?")[0]} failed (${res.status})`);
    const json = (await res.json()) as T;
    remember(cacheKey, json, init.ttl);
    return json;
  } finally {
    clearTimeout(timer);
  }
}

const nightsBetween = (a: string, b: string) => Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 864e5));
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Group stays are searched as double rooms: 8 adults → 4 rooms of 2 (adults are per room). */
function hotelOccupancy(travelers?: TravelersBreakdown) {
  const adults = Math.max(1, travelers?.adults ?? 1);
  if (adults === 1) return [{ rooms: 1, adults: 1, children: 0 }];
  return [{ rooms: Math.ceil(adults / 2), adults: 2, children: 0 }];
}

// ---- Hotels ------------------------------------------------------------------

type HbRate = {
  rateKey?: string;
  rateType?: string; // "BOOKABLE" | "RECHECK"
  net?: string | number;
  sellingRate?: string | number;
  hotelMandatory?: boolean;
  boardCode?: string;
  boardName?: string;
  rooms?: number;
  cancellationPolicies?: { amount?: string | number; from?: string }[];
};
type HbHotel = {
  code: number;
  name?: string;
  categoryName?: string;
  destinationName?: string;
  zoneName?: string;
  currency?: string;
  rooms?: { code?: string; name?: string; rates?: HbRate[] }[];
};
type HbAvailability = { hotels?: { hotels?: HbHotel[]; checkIn?: string; checkOut?: string } };
type HbContentHotel = {
  code: number;
  name?: { content?: string };
  address?: { content?: string };
  city?: { content?: string };
  images?: { path?: string; order?: number; imageTypeCode?: string }[];
};

/** The amount the group would pay for this rate: the hotel's mandated selling rate if set, else Hotelbeds' net. */
function rateAmount(r: HbRate): number | null {
  const n = Number(r.hotelMandatory && r.sellingRate != null ? r.sellingRate : r.net);
  return Number.isFinite(n) && n > 0 ? n : null;
}

type CheapestRate = { amount: number; rate: HbRate; roomCode?: string; roomName?: string };
function cheapestRate(h: HbHotel, match?: { roomCode?: string; boardCode?: string }): CheapestRate | null {
  let best: CheapestRate | null = null;
  for (const room of h.rooms ?? []) {
    if (match?.roomCode && room.code !== match.roomCode) continue;
    for (const rate of room.rates ?? []) {
      if (match?.boardCode && rate.boardCode !== match.boardCode) continue;
      const amount = rateAmount(rate);
      if (amount !== null && (!best || amount < best.amount)) best = { amount, rate, roomCode: room.code, roomName: room.name };
    }
  }
  return best;
}

async function hotelContent(codes: number[]): Promise<Map<number, HbContentHotel>> {
  const out = new Map<number, HbContentHotel>();
  if (codes.length === 0) return out;
  try {
    const json = await hbFetch<{ hotels?: HbContentHotel[] }>(
      "hotels",
      `/hotel-content-api/1.0/hotels?codes=${codes.join(",")}&fields=name,address,city,images&language=ENG&useSecondaryLanguage=false&from=1&to=${codes.length}`,
      { ttl: CONTENT_TTL_MS },
    );
    for (const h of json.hotels ?? []) out.set(h.code, h);
  } catch (err) {
    // Photos are a nice-to-have; prices still show without them.
    console.error("[hotelbeds] content failed", err instanceof Error ? err.message : err);
  }
  return out;
}

const photoUrl = (path?: string) => (path ? `https://photos.hotelbeds.com/giata/bigger/${path.replace(/^\/+/, "")}` : undefined);

export async function hotelbedsHotelSearch(
  params: VendorSearchParams,
  coords: { lat: number; lng: number },
): Promise<VendorSearchResponse> {
  if (!params.startDate || !params.endDate) return { status: "live", vendorLabel: hotelbedsLabel(), results: [] };
  const json = await hbFetch<HbAvailability>("hotels", "/hotel-api/1.0/hotels", {
    method: "POST",
    ttl: AVAILABILITY_TTL_MS,
    body: {
      stay: { checkIn: params.startDate, checkOut: params.endDate },
      occupancies: hotelOccupancy(params.travelers),
      geolocation: { latitude: coords.lat, longitude: coords.lng, radius: 10, unit: "km" },
      filter: { maxHotels: 30, maxRatesPerRoom: 3 },
    },
  });
  const nights = nightsBetween(params.startDate, params.endDate);
  const priced = (json.hotels?.hotels ?? [])
    .map((h) => ({ h, best: cheapestRate(h) }))
    .filter((x): x is { h: HbHotel; best: CheapestRate } => x.best !== null)
    .sort((a, b) => a.best.amount - b.best.amount)
    .slice(0, MAX_RESULTS);
  const content = await hotelContent(priced.map((x) => x.h.code));

  const results: VendorSearchResult[] = priced.map(({ h, best }) => {
    const c = content.get(h.code);
    const image = [...(c?.images ?? [])].sort((a, b) => (a.imageTypeCode === "GEN" ? -1 : 0) - (b.imageTypeCode === "GEN" ? -1 : 0) || (a.order ?? 99) - (b.order ?? 99))[0];
    const address = [c?.address?.content, c?.city?.content].filter(Boolean).join(", ");
    const cancel = best.rate.cancellationPolicies?.[0];
    return {
      id: `hotelbeds-${h.code}`,
      source: "Hotelbeds",
      title: c?.name?.content || h.name || "Hotel",
      description: [
        h.categoryName,
        best.roomName && best.rate.rooms && best.rate.rooms > 1 ? `${best.rate.rooms} × ${best.roomName}` : best.roomName,
        best.rate.boardName,
        address || h.zoneName || h.destinationName,
      ]
        .filter(Boolean)
        .join(" · "),
      thumbnail_url: photoUrl(image?.path),
      booking_link: "",
      // Hotelbeds quotes the whole stay for all rooms; options compare per night.
      price: round2(best.amount / nights),
      currency: h.currency ?? "EUR",
      pricing_basis: "per_night" as const,
      extra: {
        dates: { start_date: params.startDate, end_date: params.endDate },
        travelers: params.travelers,
        vendor_source: "hotelbeds",
        // Hotel code + room + board identify the quote; rateKeys expire, so
        // re-verification searches the hotel again and re-checks the rate.
        vendor_offer_id: String(h.code),
        vendor_rate: {
          room_code: best.roomCode,
          board_code: best.rate.boardCode,
          rate_key: best.rate.rateKey,
          rate_type: best.rate.rateType,
          quoted_total: best.amount,
        },
        note: [
          address ? `Address: ${address}` : "",
          cancel?.from ? `Cancellation charges from ${String(cancel.from).slice(0, 10)}` : "",
          "Quoted by Hotelbeds — booked by the organizer, not through Catoco",
        ]
          .filter(Boolean)
          .join(" · "),
      },
    };
  });
  return { status: "live", vendorLabel: hotelbedsLabel(), results };
}

/**
 * Re-quote a Hotelbeds hotel (at pick and after lock): search the hotel by
 * code for the stored dates/party, take the same room + board when still
 * offered (else the cheapest), and run /checkrates when the rate is RECHECK.
 * Returns the per-night price, or null when the hotel has no availability.
 */
export async function verifyHotelbedsHotel(
  hotelCode: string,
  checkin: string,
  checkout: string,
  travelers?: TravelersBreakdown,
  rate?: { room_code?: string; board_code?: string },
): Promise<{ perNightPrice: number; currency: string } | null> {
  if (!hotelbedsConfigured("hotels") || !/^\d{1,10}$/.test(hotelCode) || !checkin || !checkout) return null;
  const json = await hbFetch<HbAvailability>("hotels", "/hotel-api/1.0/hotels", {
    method: "POST",
    ttl: 60_000,
    body: {
      stay: { checkIn: checkin, checkOut: checkout },
      occupancies: hotelOccupancy(travelers),
      hotels: { hotel: [Number(hotelCode)] },
    },
  });
  const hotel = json.hotels?.hotels?.[0];
  if (!hotel) return null;
  const best =
    cheapestRate(hotel, { roomCode: rate?.room_code, boardCode: rate?.board_code }) ?? cheapestRate(hotel);
  if (!best) return null;
  let amount = best.amount;
  let currency = hotel.currency ?? "EUR";
  if (best.rate.rateType === "RECHECK" && best.rate.rateKey) {
    const checked = await hbFetch<{ hotel?: HbHotel }>("hotels", "/hotel-api/1.0/checkrates", {
      method: "POST",
      ttl: 60_000,
      body: { rooms: [{ rateKey: best.rate.rateKey }] },
    });
    const confirmed = checked.hotel ? cheapestRate(checked.hotel) : null;
    if (!confirmed) return null;
    amount = confirmed.amount;
    currency = checked.hotel?.currency ?? currency;
  }
  return { perNightPrice: round2(amount / nightsBetween(checkin, checkout)), currency };
}

// ---- Activities --------------------------------------------------------------

type HbAmount = { paxType?: string; amount?: number; ageFrom?: number; ageTo?: number };
type HbActivity = {
  code?: string;
  name?: string;
  currency?: string;
  amountsFrom?: HbAmount[];
  content?: {
    name?: string;
    description?: string;
    media?: { images?: { urls?: { resource?: string; sizeType?: string }[] }[] };
    location?: { startingPoints?: { meetingPoint?: { description?: string } }[] };
  };
  modalities?: { code?: string; name?: string; amountsFrom?: HbAmount[] }[];
};

function activityPaxes(travelers?: TravelersBreakdown) {
  const adults = Math.max(1, travelers?.adults ?? 1);
  const kids = [...(travelers?.children_ages ?? []), ...(travelers?.infants_ages ?? [])].map(Number).filter((n) => Number.isFinite(n));
  return [...Array.from({ length: adults }, () => ({ age: 30 })), ...kids.map((age) => ({ age }))];
}

/** Lowest adult price across the activity and its modalities. */
function adultFrom(a: HbActivity): number | null {
  const all = [...(a.amountsFrom ?? []), ...(a.modalities ?? []).flatMap((m) => m.amountsFrom ?? [])];
  const adults = all.filter((x) => (x.paxType ?? "ADULT").toUpperCase() === "ADULT" && typeof x.amount === "number" && x.amount > 0);
  return adults.length ? Math.min(...adults.map((x) => x.amount!)) : null;
}

const plain = (html?: string) => (html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

async function activityAvailability(body: unknown): Promise<HbActivity[]> {
  const json = await hbFetch<{ activities?: HbActivity[] }>("activities", "/activity-api/3.0/activities/availability", {
    method: "POST",
    ttl: AVAILABILITY_TTL_MS,
    body,
  });
  return json.activities ?? [];
}

export async function hotelbedsActivitySearch(
  params: VendorSearchParams,
  coords: { lat: number; lng: number },
): Promise<VendorSearchResponse> {
  const from = params.startDate;
  if (!from) return { status: "live", vendorLabel: hotelbedsLabel(), results: [], notice: "Pick a date to see Hotelbeds activities." };
  const activities = await activityAvailability({
    filters: [{ searchFilterItems: [{ type: "gps", latitude: coords.lat, longitude: coords.lng }] }],
    from,
    to: params.endDate || from,
    language: "en",
    paxes: activityPaxes(params.travelers),
    pagination: { itemsPerPage: 40, page: 1 },
    order: "DEFAULT",
  });
  // The GPS search returns everything nearby; the keyword narrows it here.
  const words = (params.keyword ?? "").toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const results: VendorSearchResult[] = activities
    .map((a) => ({ a, price: adultFrom(a) }))
    .filter((x): x is { a: HbActivity; price: number } => x.price !== null && Boolean(x.a.code))
    .filter(({ a }) => {
      if (words.length === 0) return true;
      const hay = `${a.name ?? ""} ${a.content?.name ?? ""} ${plain(a.content?.description)}`.toLowerCase();
      return words.some((w) => hay.includes(w));
    })
    .slice(0, MAX_RESULTS)
    .map(({ a, price }) => {
      const urls = a.content?.media?.images?.[0]?.urls ?? [];
      const image = urls.find((u) => /LARGE|XLARGE|RAW/i.test(u.sizeType ?? "")) ?? urls[0];
      const meeting = a.content?.location?.startingPoints?.[0]?.meetingPoint?.description;
      return {
        id: `hotelbeds-act-${a.code}`,
        source: "Hotelbeds",
        title: a.content?.name || a.name || "Activity",
        description: plain(a.content?.description).slice(0, 240),
        thumbnail_url: image?.resource,
        booking_link: "",
        price: round2(price),
        currency: a.currency ?? "EUR",
        pricing_basis: "per_person" as const,
        extra: {
          date: from,
          travelers: params.travelers,
          vendor_source: "hotelbeds_activities",
          vendor_offer_id: String(a.code),
          note: [meeting ? `Meeting point: ${plain(meeting)}` : "", "Quoted by Hotelbeds — booked by the organizer, not through Catoco"]
            .filter(Boolean)
            .join(" · "),
        },
      };
    });
  return { status: "live", vendorLabel: hotelbedsLabel(), results };
}

/** Re-quote one activity by code on its date: the lowest adult price, or null when unavailable. */
export async function verifyHotelbedsActivity(
  code: string,
  date: string,
  travelers?: TravelersBreakdown,
): Promise<{ perPersonPrice: number; currency: string } | null> {
  if (!hotelbedsConfigured("activities") || !/^[A-Za-z0-9_-]{2,40}$/.test(code) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const activities = await activityAvailability({
    filters: [{ searchFilterItems: [{ type: "service", value: code }] }],
    from: date,
    to: date,
    language: "en",
    paxes: activityPaxes(travelers),
    pagination: { itemsPerPage: 5, page: 1 },
    order: "DEFAULT",
  });
  const a = activities.find((x) => x.code === code) ?? activities[0];
  const price = a ? adultFrom(a) : null;
  return a && price !== null ? { perPersonPrice: round2(price), currency: a.currency ?? "EUR" } : null;
}

// ---- Transfers ---------------------------------------------------------------
// Travel mode "transfer" (founder, 2026-10-19). Airport (IATA) → hotel or
// address (GPS from the geocoded "To"), or a Hotelbeds hotel code (ATLAS)
// when one is given. Priced as one total for the whole group ("flat").

type HbTransferService = {
  id?: number;
  direction?: string;
  transferType?: string; // PRIVATE | SHARED
  vehicle?: { code?: string; name?: string };
  category?: { code?: string; name?: string };
  pickupInformation?: { date?: string; time?: string };
  minPaxCapacity?: number;
  maxPaxCapacity?: number;
  content?: { images?: { url?: string; type?: string }[] };
  price?: { totalAmount?: number; currencyId?: string };
  rateKey?: string;
  cancellationPolicies?: { amount?: number; from?: string }[];
};

export type TransferPoint = { type: "IATA" | "ATLAS" | "GPS"; code: string };

function transferPaxes(travelers?: TravelersBreakdown) {
  return {
    adults: Math.max(1, travelers?.adults ?? 1),
    children: (travelers?.children_ages ?? []).length,
    infants: (travelers?.infants_ages ?? []).length,
  };
}

const toTitle = (s?: string) => (s ? s.charAt(0) + s.slice(1).toLowerCase() : "");

async function transferAvailability(
  from: TransferPoint,
  to: TransferPoint,
  outbound: string,
  inbound: string | null,
  travelers?: TravelersBreakdown,
): Promise<HbTransferService[]> {
  const p = transferPaxes(travelers);
  const seg = (x: TransferPoint) => `${x.type}/${encodeURIComponent(x.code)}`;
  const path =
    `/transfer-api/1.0/availability/en/from/${seg(from)}/to/${seg(to)}/${outbound}` +
    `${inbound ? `/${inbound}` : ""}/${p.adults}/${p.children}/${p.infants}`;
  const json = await hbFetch<{ services?: HbTransferService[] }>("transfers", path, { ttl: AVAILABILITY_TTL_MS });
  return json.services ?? [];
}

/** "14:30" → "2027-09-16T14:30:00"; no time → midday. */
const transferMoment = (date: string, time?: string) => `${date}T${/^\d{1,2}:\d{2}/.test(time ?? "") ? (time as string).slice(0, 5).padStart(5, "0") : "12:00"}:00`;

export async function hotelbedsTransferSearch(
  params: VendorSearchParams,
  from: TransferPoint,
  to: TransferPoint,
): Promise<VendorSearchResponse> {
  if (!params.startDate) return { status: "live", vendorLabel: hotelbedsLabel(), results: [] };
  const outbound = transferMoment(params.startDate, params.time);
  const inbound = params.endDate ? transferMoment(params.endDate) : null;
  const services = await transferAvailability(from, to, outbound, inbound, params.travelers);
  const results: VendorSearchResult[] = services
    .filter((s) => typeof s.price?.totalAmount === "number" && s.price.totalAmount > 0)
    .sort((a, b) => (a.price!.totalAmount ?? 0) - (b.price!.totalAmount ?? 0))
    .slice(0, MAX_RESULTS)
    .map((s, i) => {
      const image = s.content?.images?.find((im) => /LARGE/i.test(im.type ?? "")) ?? s.content?.images?.[0];
      const cancel = s.cancellationPolicies?.[0];
      return {
        id: `hotelbeds-transfer-${i}-${s.vehicle?.code ?? ""}-${s.category?.code ?? ""}`,
        source: "Hotelbeds",
        title: [toTitle(s.transferType), s.vehicle?.name].filter(Boolean).join(" · ") || "Transfer",
        description: [
          s.category?.name,
          s.direction ? toTitle(s.direction) : "",
          s.maxPaxCapacity ? `up to ${s.maxPaxCapacity} people` : "",
          s.pickupInformation?.time ? `pickup ${s.pickupInformation.time.slice(0, 5)}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
        thumbnail_url: image?.url,
        booking_link: "",
        price: round2(s.price!.totalAmount!),
        currency: s.price?.currencyId ?? "EUR",
        // One price for the whole group, split across the people it's for.
        pricing_basis: "flat" as const,
        extra: {
          depart_date: params.startDate,
          ...(params.endDate ? { return_date: params.endDate } : {}),
          depart_time: (s.pickupInformation?.time ?? outbound.slice(11)).slice(0, 5),
          travelers: params.travelers,
          vendor_source: "hotelbeds_transfers",
          vendor_offer_id: [s.transferType, s.vehicle?.code, s.category?.code].filter(Boolean).join("|") || "transfer",
          vendor_rate: {
            from,
            to,
            transfer_type: s.transferType,
            vehicle_code: s.vehicle?.code,
            category_code: s.category?.code,
            rate_key: s.rateKey,
            quoted_total: s.price?.totalAmount,
          },
          note: [
            cancel?.from ? `Cancellation charges from ${String(cancel.from).slice(0, 10)}` : "",
            "Quoted by Hotelbeds — booked by the organizer, not through Catoco",
          ]
            .filter(Boolean)
            .join(" · "),
        },
      };
    });
  return { status: "live", vendorLabel: hotelbedsLabel(), results };
}

/** Re-quote a transfer: same route, time and party; the same transfer type + vehicle + category. */
export async function verifyHotelbedsTransfer(value: Record<string, unknown>): Promise<{ total: number; currency: string } | null> {
  if (!hotelbedsConfigured("transfers")) return null;
  const rate = (value.vendor_rate ?? {}) as {
    from?: TransferPoint;
    to?: TransferPoint;
    transfer_type?: string;
    vehicle_code?: string;
    category_code?: string;
  };
  const okPoint = (p?: TransferPoint): p is TransferPoint =>
    Boolean(p && ["IATA", "ATLAS", "GPS"].includes(p.type) && typeof p.code === "string" && /^[A-Za-z0-9.,-]{2,40}$/.test(p.code));
  const date = String(value.depart_date ?? "");
  if (!okPoint(rate.from) || !okPoint(rate.to) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const ret = String(value.return_date ?? "");
  const services = await transferAvailability(
    rate.from,
    rate.to,
    transferMoment(date, String(value.depart_time ?? "")),
    /^\d{4}-\d{2}-\d{2}$/.test(ret) ? transferMoment(ret) : null,
    value.travelers as TravelersBreakdown | undefined,
  );
  const match = services.find(
    (s) =>
      s.transferType === rate.transfer_type &&
      s.vehicle?.code === rate.vehicle_code &&
      (!rate.category_code || s.category?.code === rate.category_code) &&
      typeof s.price?.totalAmount === "number",
  );
  return match ? { total: round2(match.price!.totalAmount!), currency: match.price?.currencyId ?? "EUR" } : null;
}
