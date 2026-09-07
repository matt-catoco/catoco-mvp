import "server-only";
import type { ElementType, PricingBasis, TravelersBreakdown } from "@/lib/trip-elements";

// A search's parameters — the union of every field any scene needs, all
// optional here since each dispatch case only reads what its own vendor/mock
// generator actually uses. Kept as one shape (not one type per element) so
// the dispatcher and the API route don't need a discriminated-union parse.
export type VendorSearchParams = {
  elementType: ElementType;
  searchSubtype: string; // TravelMode | AccommodationSearchSubtype | ExperienceSearchSubtype | "" (Dining has none)
  location?: string; // free-text place name (From/To, pickup location, destination, dining location)
  destination?: string; // Travel's "To" leg specifically, kept distinct from `location` (the "From" leg)
  startDate?: string;
  endDate?: string;
  time?: string; // Dining
  partySize?: number; // Dining
  travelers?: TravelersBreakdown; // Flight, Accommodations
  vehicleType?: string; // Rental Car
  transmission?: "automatic" | "manual" | "";
};

export type VendorSearchResult = {
  id: string;
  title: string;
  description?: string;
  thumbnail_url?: string;
  booking_link?: string;
  price?: number;
  currency?: string;
  pricing_basis?: PricingBasis;
  // Vendor/subtype-specific extra fields, merged straight into the
  // submitted option's value — e.g. depart_date, travelers, vehicle_type.
  // Loosely typed on purpose, same reasoning as OptionValue itself: no
  // SQL-side mirror, and every subtype's shape differs too much for one
  // fixed interface to cover cleanly.
  extra?: Record<string, unknown>;
};

export type VendorSearchStatus = "live" | "mock";

export type VendorSearchResponse = {
  status: VendorSearchStatus;
  vendorLabel: string; // shown as the search modal's source badge
  results: VendorSearchResult[];
};
