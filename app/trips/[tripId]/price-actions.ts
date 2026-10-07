"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { toUserFacingError } from "@/lib/action-errors";
import { requoteOption } from "@/lib/vendor-search/requote";

export type PriceActionResult = {
  error?: string;
  /** reprice_locked_element(): unchanged | within_cushion | over_cushion */
  outcome?: string;
  unitPrice?: number;
};

function refresh(tripId: string, elementId: string) {
  revalidatePath(`/trips/${tripId}`);
  revalidatePath(`/trips/${tripId}/elements/${elementId}`);
}

/** Organizer/purchaser sets the current price (hand-priced options, or after
 * checking the vendor themselves). Authority + cushion logic live in
 * reprice_locked_element(). */
export async function updateElementPrice(
  tripId: string,
  elementId: string,
  unitPrice: number,
): Promise<PriceActionResult> {
  if (!Number.isFinite(unitPrice) || unitPrice < 0) return { error: "Enter a valid price." };
  const supabase = await createClient();
  const rounded = Math.round(unitPrice * 100) / 100;
  const { data, error } = await supabase.rpc("reprice_locked_element", {
    p_element_id: elementId,
    p_unit_price: rounded,
  });
  if (error) return { error: toUserFacingError(error) };
  refresh(tripId, elementId);
  return { outcome: data as string, unitPrice: rounded };
}

/** Re-quotes a Duffel/LiteAPI option with the vendor, then reprices. */
export async function recheckElementPrice(tripId: string, elementId: string): Promise<PriceActionResult> {
  const supabase = await createClient();
  const { data: element } = await supabase
    .from("trip_elements")
    .select("locked_option_id")
    .eq("id", elementId)
    .maybeSingle();
  if (!element?.locked_option_id) return { error: "This isn't locked yet." };
  const { data: option } = await supabase
    .from("element_options")
    .select("value")
    .eq("id", element.locked_option_id)
    .maybeSingle();
  const value = (option?.value ?? {}) as Record<string, unknown>;

  const quote = await requoteOption(value);
  if (!quote.ok) return { error: quote.reason };
  const currency = String(value.currency ?? "").toUpperCase();
  if (currency && quote.currency.toUpperCase() !== currency) {
    return { error: `The vendor now quotes in ${quote.currency} instead of ${currency} — update the price by hand.` };
  }
  return updateElementPrice(tripId, elementId, quote.unitPrice);
}
