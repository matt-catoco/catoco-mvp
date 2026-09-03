import { headers } from "next/headers";
import type { createClient } from "@/lib/supabase/server";
import { notifyOrganizer } from "./notify";
import type { ElementType } from "@/lib/trip-elements";

type ResolvedRow = { element_id: string; element_type: ElementType; reason: "tie" | "empty" };

/**
 * Lazy auto-lock trigger, shared by the Trip Home dashboard and the
 * per-element drill-in page — either can be the first page visited after a
 * voting_deadline passes, so both need to fire this. Resolves anything due
 * and best-effort emails the organizer once per outcome (resolve_due_elements'
 * tie_notified/empty_notified flags make repeat calls a no-op). A
 * notification failure must never break the page that called this.
 */
export async function resolveAndNotify(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tripId: string,
  organizerId: string,
  tripName: string,
): Promise<void> {
  const { data: resolvedData, error: resolveError } = await supabase.rpc("resolve_due_elements", {
    p_trip_id: tripId,
  });
  if (resolveError) {
    // This RPC silently rolled back on every call for a long time (a check
    // constraint violation on the auto-lock UPDATE, fixed in
    // 20260914000000) with zero trace anywhere — logging server-side so a
    // regression like that surfaces immediately instead of needing another
    // from-scratch investigation.
    console.error("resolve_due_elements failed", { tripId, error: resolveError });
    return;
  }
  const resolved = (resolvedData ?? null) as ResolvedRow[] | null;
  if (!resolved || resolved.length === 0) return;

  try {
    const { data: organizerEmail } = await supabase.rpc("get_user_email", {
      p_user_id: organizerId,
    });
    if (!organizerEmail) return;
    const h = await headers();
    const host = h.get("host");
    const proto = process.env.NODE_ENV === "development" ? "http" : "https";
    const origin = host ? `${proto}://${host}` : "https://catoco.co";
    await Promise.all(
      resolved.map((r) =>
        notifyOrganizer({
          reason: r.reason,
          elementType: r.element_type,
          tripId,
          tripName,
          organizerEmail,
          origin,
        }),
      ),
    );
  } catch {
    // best-effort — a notification failure must never break the page
  }
}
