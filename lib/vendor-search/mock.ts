import "server-only";
import type { VendorSearchParams, VendorSearchResponse, VendorSearchResult } from "./types";

// Mock data for every vendor that's either blocked on keys (Duffel) or
// still pending a vendor decision/coverage confirmation (Rental Car/Train/
// Bus, Accommodations, Dining) — see the vendor-search build prompt's §1.
// One generator per scene rather than one generic "make up N results"
// function, since each scene's plausible fields differ (a flight has a
// depart time, a rental car has a vehicle type) and the whole point of
// building this now is that the UI/data shape is real even though the data
// isn't -- swapping in a real vendor call later means only dispatch.ts
// changes, not any of the rendering code that consumes VendorSearchResult.

function id(prefix: string, i: number): string {
  return `mock-${prefix}-${i}`;
}

function mockFlights(params: VendorSearchParams): VendorSearchResult[] {
  const from = params.location || "Origin";
  const to = params.destination || "Destination";
  const carriers = ["Delta", "United", "American", "JetBlue"];
  return carriers.map((carrier, i) => ({
    id: id("flight", i),
    title: `${carrier} — ${from} → ${to}`,
    description: `${["Nonstop", "1 stop", "1 stop", "Nonstop"][i]} · ${5 + i}h ${15 * i}m`,
    price: 210 + i * 85,
    currency: "USD",
    pricing_basis: "per_person",
    extra: {
      depart_date: params.startDate || "",
      return_date: params.endDate || "",
      travelers: params.travelers,
    },
  }));
}

function mockRentalCars(params: VendorSearchParams): VendorSearchResult[] {
  const location = params.location || "Pickup location";
  const vehicles = [
    { type: "Economy", transmission: "automatic" as const },
    { type: "SUV", transmission: "automatic" as const },
    { type: "Compact", transmission: "manual" as const },
  ];
  return vehicles.map((v, i) => ({
    id: id("car", i),
    title: `${v.type} — ${location}`,
    description: `${v.transmission === "automatic" ? "Automatic" : "Manual"} · 4 seats`,
    price: 45 + i * 20,
    currency: "USD",
    pricing_basis: "per_night",
    extra: {
      pickup_location: location,
      pickup_datetime: params.startDate || "",
      dropoff_datetime: params.endDate || "",
      vehicle_type: v.type,
      transmission: v.transmission,
    },
  }));
}

function mockTrains(params: VendorSearchParams): VendorSearchResult[] {
  const from = params.location || "Origin";
  const to = params.destination || "Destination";
  return [0, 1, 2].map((i) => ({
    id: id("train", i),
    title: `${from} → ${to}`,
    description: `Departs ${["08:1" + i, "12:4" + i, "18:0" + i][i]} · ${2 + i}h ${10 * i}m`,
    price: 35 + i * 15,
    currency: "USD",
    pricing_basis: "per_person",
    extra: { depart_date: params.startDate || "" },
  }));
}

function mockBuses(params: VendorSearchParams): VendorSearchResult[] {
  const from = params.location || "Origin";
  const to = params.destination || "Destination";
  return [0, 1].map((i) => ({
    id: id("bus", i),
    title: `${from} → ${to}`,
    description: `Departs ${["09:15", "16:30"][i]} · ${4 + i}h`,
    price: 18 + i * 6,
    currency: "USD",
    pricing_basis: "per_person",
    extra: { depart_date: params.startDate || "" },
  }));
}

function mockAccommodations(params: VendorSearchParams): VendorSearchResult[] {
  const location = params.location || "the area";
  const names: Record<string, string[]> = {
    hotel: ["Grand Plaza Hotel", "Harborview Hotel", "The Continental"],
    vacation_rental: ["Sunny Loft near Center", "Cozy 2BR with View", "Modern Studio Downtown"],
    resort: ["Azure Bay Resort", "The Palms Resort & Spa"],
    bnb: ["Maple Street B&B", "The Garden House B&B"],
    hostel: ["Traveler's Hostel", "Backpacker's Nest"],
    guesthouse: ["Riverside Guesthouse", "Old Town Guesthouse"],
    camping_glamping: ["Pinewood Glamping Domes", "Lakeside Campsite"],
  };
  const options = names[params.searchSubtype] ?? names.hotel;
  return options.map((name, i) => ({
    id: id("stay", i),
    title: `${name} — ${location}`,
    description: `${4 - (i % 3)}.${5 + i} ★ · Free cancellation`,
    price: 95 + i * 55,
    currency: "USD",
    pricing_basis: "per_night",
    extra: {
      dates: { start_date: params.startDate || "", end_date: params.endDate || "" },
      travelers: params.travelers,
    },
  }));
}

function mockDining(params: VendorSearchParams): VendorSearchResult[] {
  const location = params.location || "the area";
  const names = ["Trattoria Bella", "The Copper Grill", "Sakura House", "Le Petit Bistro"];
  return names.map((name, i) => {
    const tier = PRICE_TIER_STRINGS[i % PRICE_TIER_STRINGS.length];
    return {
      id: id("dining", i),
      title: `${name} — ${location}`,
      description: `${tier} · ${["Italian", "American", "Japanese", "French"][i]}`,
      extra: {
        cuisine: ["Italian", "American", "Japanese", "French"][i],
        dining_time: params.time || "",
        guests: params.partySize,
        price_tier: tier,
      },
    };
  });
}

const PRICE_TIER_STRINGS = ["$", "$$", "$$$", "$$$$"];

export async function mockSearch(
  params: VendorSearchParams,
  vendorLabel: string,
): Promise<VendorSearchResponse> {
  let results: VendorSearchResult[];
  switch (params.elementType) {
    case "travel":
      results =
        params.searchSubtype === "flight"
          ? mockFlights(params)
          : params.searchSubtype === "rental_car"
            ? mockRentalCars(params)
            : params.searchSubtype === "train"
              ? mockTrains(params)
              : mockBuses(params);
      break;
    case "accommodation":
      results = mockAccommodations(params);
      break;
    case "dining":
      results = mockDining(params);
      break;
    default:
      results = [];
  }
  // Every mock result needs a well-formed booking link -- bookingLinkError()
  // requires one across every price-bearing type regardless of whether the
  // vendor behind it is real or mocked, and a mock/placeholder page keeps
  // that requirement satisfiable while a real vendor's still pending.
  results = results.map((r) => ({ ...r, booking_link: r.booking_link ?? `https://example.com/mock/${r.id}` }));
  return { status: "mock", vendorLabel, results };
}
