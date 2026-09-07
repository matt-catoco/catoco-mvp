import {
  ACCOMMODATION_SEARCH_SUBTYPE_TO_DETAILED,
  EXPERIENCE_SEARCH_SUBTYPE_TO_DETAILED,
  type AccommodationSearchSubtype,
  type ExperienceSearchSubtype,
  type ElementType,
} from "@/lib/trip-elements";
import type { VendorSearchParams, VendorSearchResult } from "./types";

/**
 * Maps a selected vendor result straight into the raw draft shape
 * submitOption()/normalizeOptionValue() expect — there's no review step (the
 * founder's call: submit directly, no manual confirm/edit screen), so this
 * is the one place the Subtype pre-guess and every other vendor-specific
 * field actually lands. An already-submitted option can still be edited
 * afterward through the existing edit flow if something needs correcting.
 */
export function vendorResultToOptionValue(
  elementType: ElementType,
  params: VendorSearchParams,
  result: VendorSearchResult,
): Record<string, unknown> {
  const extra = result.extra ?? {};

  switch (elementType) {
    case "travel":
      return {
        mode: params.searchSubtype,
        note: "",
        start_location: params.location ?? "",
        destination_location: params.destination ?? "",
        round_trip: Boolean(extra.return_date),
        booking_link: result.booking_link ?? "",
        price: result.price ?? "",
        currency: result.currency ?? "USD",
        pricing_basis: result.pricing_basis ?? "",
        title: result.title,
        description: result.description,
        thumbnail_url: result.thumbnail_url,
        ...extra,
      };

    case "accommodation":
      return {
        name: result.title,
        subtype: ACCOMMODATION_SEARCH_SUBTYPE_TO_DETAILED[params.searchSubtype as AccommodationSearchSubtype],
        accommodation_fields: {},
        booking_link: result.booking_link ?? "",
        price: result.price ?? "",
        currency: result.currency ?? "USD",
        pricing_basis: result.pricing_basis ?? "",
        title: result.title,
        description: result.description,
        thumbnail_url: result.thumbnail_url,
        ...extra,
      };

    case "experience":
      return {
        name: result.title,
        experience_subtype: EXPERIENCE_SEARCH_SUBTYPE_TO_DETAILED[params.searchSubtype as ExperienceSearchSubtype],
        location_name: params.location ?? "",
        booking_link: result.booking_link ?? "",
        price: result.price ?? "",
        currency: result.currency ?? "USD",
        pricing_basis: result.pricing_basis ?? "per_person",
        title: result.title,
        description: result.description,
        thumbnail_url: result.thumbnail_url,
        ...extra,
      };

    case "dining":
      return {
        name: result.title,
        location_name: params.location ?? "",
        booking_link: result.booking_link ?? "",
        title: result.title,
        description: result.description,
        thumbnail_url: result.thumbnail_url,
        ...extra,
      };

    default:
      return {};
  }
}
