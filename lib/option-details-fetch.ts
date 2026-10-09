import "server-only";
import type { ElementType } from "@/lib/trip-elements";
import type { FlightSegment, OptionDetails } from "@/lib/option-details";
import { decodeEntities, readCapped, safeUrl } from "@/lib/link-preview";

/**
 * One best-effort details pass per option (see lib/option-details.ts).
 * Source order: the vendor the option came from (LiteAPI hotel, Viator
 * product, Duffel offer) → the booking link's schema.org JSON-LD. Never
 * throws; a source that fails just yields nothing. Shapes verified against
 * live sandbox calls on 2026-10-09 (LiteAPI /data/hotel, Viator
 * /products/{code}); Duffel per its v2 offer schema.
 */

const TIMEOUT_MS = 6000;
const PAGE_MAX_BYTES = 600_000; // JSON-LD often sits low in <body>
const USER_AGENT = "Mozilla/5.0 (compatible; CatocoLinkPreview/1.0; +https://catoco.co)";
const MAX_TEXT = 600;

function clip(s: unknown, max = MAX_TEXT): string | undefined {
  if (typeof s !== "string") return undefined;
  const t = decodeEntities(s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
  if (!t) return undefined;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

async function timedFetch(url: string, init: RequestInit = {}): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function prune(d: OptionDetails): OptionDetails | null {
  const out = Object.fromEntries(
    Object.entries(d).filter(([, v]) => v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0)),
  ) as OptionDetails;
  // source + fetched_at alone isn't worth storing
  return Object.keys(out).length > 2 ? out : null;
}

// ---- LiteAPI ----------------------------------------------------------------
async function liteapiDetails(hotelId: string): Promise<OptionDetails | null> {
  const key = process.env.LITEAPI_KEY;
  if (!key) return null;
  const res = await timedFetch(`https://api.liteapi.travel/v3.0/data/hotel?hotelId=${encodeURIComponent(hotelId)}`, {
    headers: { "X-API-Key": key, accept: "application/json" },
  });
  if (!res?.ok) return null;
  const h = (await res.json().catch(() => null))?.data;
  if (!h) return null;
  const times = h.checkinCheckoutTimes ?? {};
  const policies: string[] = [];
  for (const p of (h.policies ?? []) as { name?: string; description?: string }[]) {
    const line = clip([p.name, p.description].filter(Boolean).join(": "), 300);
    if (line) policies.push(line);
  }
  if (h.childAllowed === false) policies.push("Children not allowed");
  if (h.petsAllowed === false) policies.push("No pets");
  else if (h.petsAllowed === true) policies.push("Pets allowed");
  const important = clip(h.hotelImportantInformation, 400);
  if (important) policies.push(important);
  return prune({
    source: "liteapi",
    fetched_at: new Date().toISOString(),
    summary: clip(h.hotelDescription),
    address: [h.address, h.zip, h.city].filter(Boolean).join(", ") || undefined,
    lat: typeof h.location?.latitude === "number" ? h.location.latitude : undefined,
    lng: typeof h.location?.longitude === "number" ? h.location.longitude : undefined,
    phone: h.phone || undefined,
    email: h.email || undefined,
    rating: [
      h.starRating ? `${h.starRating}★ hotel` : null,
      h.rating ? `guests ${h.rating}/10${h.reviewCount ? ` (${Number(h.reviewCount).toLocaleString("en-US")} reviews)` : ""}` : null,
    ]
      .filter(Boolean)
      .join(" · ") || undefined,
    checkin: times.checkin_start
      ? `From ${times.checkin_start}${times.checkin_end ? ` until ${times.checkin_end}` : ""}`
      : undefined,
    checkout: times.checkout ? `By ${times.checkout}` : undefined,
    policies,
    images: ((h.hotelImages ?? []) as { urlHd?: string; url?: string }[])
      .map((i) => i.urlHd || i.url)
      .filter((u): u is string => Boolean(u))
      .slice(0, 8),
  });
}

// ---- Viator -----------------------------------------------------------------
/** Product code from a Viator product URL: …/d739-6743EDI?… → 6743EDI */
export function viatorProductCode(url: string): string | null {
  const m = url.match(/\/d\d+-([A-Za-z0-9]+)(?:[/?#]|$)/);
  return m ? m[1] : null;
}

async function viatorDetails(code: string): Promise<OptionDetails | null> {
  const key = process.env.VIATOR_API_KEY;
  if (!key) return null;
  const res = await timedFetch(`https://api.sandbox.viator.com/partner/products/${encodeURIComponent(code)}`, {
    headers: { "exp-api-key": key, Accept: "application/json;version=2.0", "Accept-Language": "en-US" },
  });
  if (!res?.ok) return null;
  const p = await res.json().catch(() => null);
  if (!p) return null;
  const text = (i: { otherDescription?: string; description?: string; typeDescription?: string }) =>
    i.otherDescription || i.description || i.typeDescription || "";
  const dur = p.itinerary?.duration ?? {};
  const hours = (m: number) => (m % 60 === 0 ? `${m / 60}h` : m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`);
  const range = (a: number, b: number) => (b < 180 ? `${a}–${b} min` : `${hours(a)}–${hours(b)}`);
  const reviews = p.reviews;
  return prune({
    source: "viator",
    fetched_at: new Date().toISOString(),
    summary: clip(p.description),
    duration: dur.fixedDurationInMinutes
      ? hours(dur.fixedDurationInMinutes)
      : dur.variableDurationFromMinutes && dur.variableDurationToMinutes
        ? range(dur.variableDurationFromMinutes, dur.variableDurationToMinutes)
        : undefined,
    // Viator's meeting location itself is a Google place ref we can't
    // resolve; its text often says "the location above" — point at the listing.
    meeting_point: (() => {
      const t = clip(p.logistics?.start?.[0]?.description, 400);
      return t && /\babove\b/i.test(t) ? `${t} (exact spot on the listing)` : t;
    })(),
    cancellation: clip(p.cancellationPolicy?.description, 400),
    inclusions: ((p.inclusions ?? []) as object[]).map(text).filter(Boolean).slice(0, 8),
    exclusions: ((p.exclusions ?? []) as object[]).map(text).filter(Boolean).slice(0, 8),
    policies: ((p.additionalInfo ?? []) as { description?: string }[])
      .map((i) => clip(i.description, 200))
      .filter((s): s is string => Boolean(s))
      .slice(0, 6),
    supplier: p.supplier?.name || undefined,
    rating: reviews?.combinedAverageRating
      ? `${Number(reviews.combinedAverageRating).toFixed(1)}★ (${Number(reviews.totalReviews ?? 0).toLocaleString("en-US")} reviews)`
      : undefined,
    images: ((p.images ?? []) as { variants?: { url?: string; width?: number }[] }[])
      .map((i) => {
        const v = (i.variants ?? []).filter((x) => x.url).sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
        return v.find((x) => (x.width ?? 0) <= 1200)?.url ?? v[0]?.url;
      })
      .filter((u): u is string => Boolean(u))
      .slice(0, 8),
  });
}

// ---- Duffel (flights) -------------------------------------------------------
async function duffelOfferDetails(offerId: string): Promise<OptionDetails | null> {
  const key = process.env.DUFFEL_API_KEY;
  if (!key) return null;
  const res = await timedFetch(`https://api.duffel.com/air/offers/${encodeURIComponent(offerId)}`, {
    headers: { Authorization: `Bearer ${key}`, "Duffel-Version": "v2", Accept: "application/json" },
  });
  if (!res?.ok) return null;
  const o = (await res.json().catch(() => null))?.data;
  if (!o) return null;
  type Seg = {
    origin?: { iata_code?: string };
    destination?: { iata_code?: string };
    departing_at?: string;
    arriving_at?: string;
    marketing_carrier?: { name?: string; iata_code?: string };
    marketing_carrier_flight_number?: string;
    passengers?: { baggages?: { type?: string; quantity?: number }[] }[];
  };
  const segs: Seg[] = ((o.slices ?? []) as { segments?: Seg[] }[]).flatMap((s) => s.segments ?? []);
  const segments: FlightSegment[] = segs.map((s) => ({
    from: s.origin?.iata_code ?? "?",
    to: s.destination?.iata_code ?? "?",
    depart: s.departing_at ?? "",
    arrive: s.arriving_at ?? "",
    carrier: s.marketing_carrier?.name,
    flight: s.marketing_carrier?.iata_code && s.marketing_carrier_flight_number
      ? `${s.marketing_carrier.iata_code}${s.marketing_carrier_flight_number}`
      : undefined,
  }));
  const bags = segs[0]?.passengers?.[0]?.baggages ?? [];
  const baggage = bags
    .filter((b) => (b.quantity ?? 0) > 0)
    .map((b) => `${b.quantity} ${b.type === "checked" ? "checked" : "carry-on"} bag${b.quantity === 1 ? "" : "s"}`)
    .join(", ");
  const cond = (c: { allowed?: boolean; penalty_amount?: string; penalty_currency?: string } | null | undefined, what: string) =>
    !c
      ? null
      : c.allowed
        ? `${what} allowed${c.penalty_amount && Number(c.penalty_amount) > 0 ? ` (fee ${c.penalty_currency ?? ""} ${c.penalty_amount})` : " free"}`
        : `${what} not allowed`;
  const refund = cond(o.conditions?.refund_before_departure, "Refunds");
  const change = cond(o.conditions?.change_before_departure, "Changes");
  return prune({
    source: "duffel",
    fetched_at: new Date().toISOString(),
    segments,
    baggage: baggage ? `${baggage} per passenger` : undefined,
    cancellation: [refund, change].filter(Boolean).join(" · ") || undefined,
    supplier: o.owner?.name || undefined,
  });
}

// ---- Any booking page: schema.org JSON-LD ----------------------------------
type Ld = Record<string, unknown>;

function ldNodes(html: string): Ld[] {
  const out: Ld[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const stack = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (stack.length) {
        const n = stack.shift();
        if (!n || typeof n !== "object") continue;
        if (Array.isArray((n as Ld)["@graph"])) stack.push(...((n as Ld)["@graph"] as Ld[]));
        out.push(n as Ld);
      }
    } catch {
      // malformed block — skip
    }
  }
  return out;
}

const PLACE_TYPES = /Hotel|Lodging|Resort|Hostel|BedAndBreakfast|Restaurant|FoodEstablishment|LocalBusiness|TouristAttraction|Place|Product|Event|Accommodation|House|Apartment|VacationRental|Campground/i;

function addressText(a: unknown): string | undefined {
  if (!a) return undefined;
  if (typeof a === "string") return a;
  if (typeof a === "object") {
    const o = a as Record<string, unknown>;
    const country = typeof o.addressCountry === "object" ? (o.addressCountry as Record<string, unknown>)?.name : o.addressCountry;
    return [o.streetAddress, o.addressLocality, o.postalCode, o.addressRegion, country]
      .filter((x) => typeof x === "string" && x.trim())
      .join(", ") || undefined;
  }
  return undefined;
}

function metaContent(html: string, name: string): string | undefined {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']*)["']`, "i");
  const m = html.match(re);
  return m?.[1] ? decodeEntities(m[1]).trim() || undefined : undefined;
}

function htmlFallbacks(html: string): { phone?: string; email?: string; address?: string; lat?: number; lng?: number } {
  const tel = html.match(/href=["']tel:([^"']+)["']/i)?.[1];
  const mail = html.match(/href=["']mailto:([^"'?]+)/i)?.[1];
  const addrTag = clip(html.match(/<address[^>]*>([\s\S]*?)<\/address>/i)?.[1], 200)?.replace(/\n+/g, ", ");
  const street = metaContent(html, "business:contact_data:street_address");
  const metaAddr = street
    ? [street, metaContent(html, "business:contact_data:locality"), metaContent(html, "business:contact_data:postal_code"), metaContent(html, "business:contact_data:country_name")]
        .filter(Boolean)
        .join(", ")
    : undefined;
  const lat = Number(metaContent(html, "place:location:latitude"));
  const lng = Number(metaContent(html, "place:location:longitude"));
  return {
    phone: tel ? decodeURIComponent(tel).trim() : metaContent(html, "business:contact_data:phone_number"),
    email: mail ? decodeURIComponent(mail).trim() : metaContent(html, "business:contact_data:email"),
    address: metaAddr || addrTag,
    lat: Number.isFinite(lat) && lat !== 0 ? lat : undefined,
    lng: Number.isFinite(lng) && lng !== 0 ? lng : undefined,
  };
}

async function pageDetails(rawUrl: string): Promise<OptionDetails | null> {
  const url = safeUrl(rawUrl);
  if (!url) return null;
  const res = await timedFetch(url.toString(), { redirect: "follow", headers: { "User-Agent": USER_AGENT, Accept: "text/html" } });
  if (!res?.ok || !(res.headers.get("content-type") ?? "").includes("text/html")) return null;
  const html = await readCapped(res, PAGE_MAX_BYTES).catch(() => "");
  const nodes = ldNodes(html).filter((n) => PLACE_TYPES.test(String(n["@type"] ?? "")));
  // Most venue sites carry no JSON-LD at all (checked 2026-10-09 against
  // real hotel/restaurant sites) — fall back to what nearly all of them do
  // have: tel:/mailto: links, an <address>, business-contact meta tags.
  const n: Ld = nodes.find((x) => x.address) ?? nodes[0] ?? {};
  const fb = htmlFallbacks(html);
  const geo = (n.geo ?? {}) as Record<string, unknown>;
  const agg = (n.aggregateRating ?? {}) as Record<string, unknown>;
  const images = ([] as unknown[]).concat(n.image ?? []).map((i) => (typeof i === "string" ? i : (i as Ld)?.url)).filter(
    (u): u is string => typeof u === "string" && u.startsWith("http"),
  );
  const hours = n.openingHours;
  return prune({
    source: "page",
    fetched_at: new Date().toISOString(),
    summary: clip(n.description),
    address: addressText(n.address) ?? fb.address,
    lat: Number.isFinite(Number(geo.latitude)) && geo.latitude != null ? Number(geo.latitude) : fb.lat,
    lng: Number.isFinite(Number(geo.longitude)) && geo.longitude != null ? Number(geo.longitude) : fb.lng,
    phone: typeof n.telephone === "string" ? n.telephone : fb.phone,
    email: typeof n.email === "string" ? n.email.replace(/^mailto:/, "") : fb.email,
    rating: agg.ratingValue
      ? `${agg.ratingValue}${agg.bestRating ? `/${agg.bestRating}` : "★"}${agg.reviewCount ? ` (${agg.reviewCount} reviews)` : ""}`
      : undefined,
    checkin: typeof n.checkinTime === "string" ? n.checkinTime : undefined,
    checkout: typeof n.checkoutTime === "string" ? n.checkoutTime : undefined,
    policies: [
      Array.isArray(hours) ? `Hours: ${hours.join(", ")}` : typeof hours === "string" ? `Hours: ${hours}` : null,
      typeof n.priceRange === "string" ? `Price range: ${n.priceRange}` : null,
      typeof n.servesCuisine === "string" ? `Cuisine: ${n.servesCuisine}` : null,
    ].filter((s): s is string => Boolean(s)),
    website: url.origin,
    images: images.slice(0, 8),
  });
}

/**
 * The details pass for one option value. Vendor data wins; the booking
 * page's JSON-LD fills in when there's no vendor source (or it failed).
 */
export async function fetchOptionDetails(type: ElementType, value: Record<string, unknown>): Promise<OptionDetails | null> {
  try {
    const str = (k: string) => (typeof value[k] === "string" ? (value[k] as string).trim() : "");
    const link = str("booking_link");
    if (type === "accommodation" && value.vendor_source === "liteapi" && str("vendor_offer_id")) {
      const d = await liteapiDetails(str("vendor_offer_id"));
      if (d) return d;
    }
    if (type === "travel" && value.vendor_source === "duffel" && str("vendor_offer_id")) {
      const d = await duffelOfferDetails(str("vendor_offer_id"));
      if (d) return d;
    }
    if (type === "experience" && link && /viator\.com/i.test(link)) {
      const code = viatorProductCode(link);
      const d = code ? await viatorDetails(code) : null;
      if (d) return d;
    }
    if (link) return await pageDetails(link);
    return null;
  } catch {
    return null;
  }
}
