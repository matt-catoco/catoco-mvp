"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateTripPermissions } from "./actions";
import { btnPrimary } from "@/lib/ui";
import {
  TripPermissionsFields,
  tripPermissionsError,
  type TripPermissions,
} from "@/components/trip-permissions-fields";

export type { TripPermissions };

/**
 * Trip settings → Permissions & funding (organizer / co-organizer).
 * Every rule here is enforced server-side (create_element, lock_element,
 * create_funding_request_for_element) — this form only edits the trip's
 * settings via update_trip_permissions(). The same fields are offered at
 * trip creation (app/trips/new).
 */
export function TripPermissionsForm({ tripId, initial }: { tripId: string; initial: TripPermissions }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);

  return (
    <div className="rounded-xl border border-black/[.1] p-4 dark:border-white/[.14]">
      <h2 className="text-sm font-semibold text-black dark:text-zinc-50">Permissions &amp; funding</h2>

      <div className="mt-4">
        <TripPermissionsFields
          value={v}
          onChange={setV}
          timingNote="Applies to elements and funding started after you change it — existing deadlines stay as they are."
        />
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          disabled={!dirty || pending}
          onClick={() => {
            const invalid = tripPermissionsError(v);
            if (invalid) return setMessage({ ok: false, text: invalid });
            setMessage(null);
            startTransition(async () => {
              const res = await updateTripPermissions(tripId, v);
              if (res.error) {
                setMessage({ ok: false, text: res.error });
                return;
              }
              setMessage({ ok: true, text: "Saved" });
              router.refresh();
            });
          }}
          className={`h-9 px-4 text-sm ${btnPrimary}`}
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {message && <span className={`text-xs ${message.ok ? "text-brand-muted" : "text-red-500"}`}>{message.text}</span>}
      </div>
    </div>
  );
}
