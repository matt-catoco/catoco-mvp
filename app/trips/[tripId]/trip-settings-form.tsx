"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconPicker } from "../new/icon-picker";
import { ICON_BUCKET } from "@/lib/trip-icons";
import { updateTrip, deleteTrip } from "./actions";
import { btnPrimary, fieldClass, labelClass } from "@/lib/ui";

const field = `h-10 ${fieldClass}`;

/** A real uploaded image (never starts with the retired `preset:` prefix,
 * and isn't null) — the only kind of icon value that actually has a
 * storage object worth cleaning up. */
function isUploadedIcon(icon: string | null): icon is string {
  return Boolean(icon) && !icon!.startsWith("preset:");
}

/**
 * Rename + icon change (organizer or co-organizer) and, below a visual
 * break, the organizer-only delete section. Icon replacement/trip deletion
 * both best-effort clean up the OLD storage object client-side — the
 * bucket's delete policy is scoped to whoever originally uploaded it
 * (storage.foldername(name)[1] = auth.uid()), so a co-organizer changing
 * an icon the organizer uploaded (or vice versa) will find that cleanup
 * silently fails; that's fine; it's cosmetic cruft-prevention, never
 * allowed to block the rename/icon-update/delete itself.
 */
export function TripSettingsForm({
  tripId,
  currentUserId,
  isOrganizer,
  initialName,
  initialIcon,
}: {
  tripId: string;
  currentUserId: string;
  isOrganizer: boolean;
  initialName: string;
  initialIcon: string | null;
}) {
  const router = useRouter();

  const [name, setName] = useState(initialName);
  const [icon, setIcon] = useState<string | null>(initialIcon);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [savePending, startSave] = useTransition();

  const [confirmName, setConfirmName] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletePending, startDelete] = useTransition();

  async function cleanupOldIcon(oldIcon: string | null) {
    if (!isUploadedIcon(oldIcon)) return;
    try {
      await createClient().storage.from(ICON_BUCKET).remove([oldIcon]);
    } catch {
      // best-effort — see the component doc comment above
    }
  }

  function save() {
    setSaveError(null);
    setSaved(false);
    const trimmed = name.trim();
    if (!trimmed) {
      setSaveError("Give the trip a name.");
      return;
    }
    const iconChanged = icon !== initialIcon;
    const nameChanged = trimmed !== initialName;
    if (!iconChanged && !nameChanged) {
      setSaved(true);
      return;
    }
    startSave(async () => {
      const res = await updateTrip(tripId, {
        name: nameChanged ? trimmed : undefined,
        icon: iconChanged ? icon : undefined,
        setIcon: iconChanged,
      });
      if (res.error) {
        setSaveError(res.error);
        return;
      }
      if (iconChanged) await cleanupOldIcon(initialIcon);
      setSaved(true);
      router.refresh();
    });
  }

  function handleDelete() {
    setDeleteError(null);
    startDelete(async () => {
      const res = await deleteTrip(tripId);
      if (res.error) {
        setDeleteError(res.error);
        return;
      }
      await cleanupOldIcon(icon);
      router.push("/trips");
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-5">
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Trip name</span>
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className={labelClass}>Icon</span>
          <IconPicker value={icon} onChange={setIcon} userId={currentUserId} />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={savePending}
            className={`self-start px-4 py-2 text-sm ${btnPrimary}`}
          >
            {savePending ? "Saving…" : "Save changes"}
          </button>
          {saved && !saveError && <p className="text-xs text-brand-muted">Saved.</p>}
        </div>
        {saveError && <p className="text-sm text-red-500">{saveError}</p>}
      </div>

      {isOrganizer && (
        <div className="flex flex-col gap-3 rounded-xl border border-red-500/30 p-4">
          <div>
            <h2 className="text-sm font-semibold text-red-600 dark:text-red-400">Delete trip</h2>
            <p className="mt-1 text-xs text-brand-muted">
              Permanent — removes every element, vote, and contribution record for everyone on
              this trip. Blocked while any element still has unrefunded funding on it (settle up
              and mark it refunded from that element's page first).
            </p>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>
              Type <span className="font-mono">{initialName}</span> to confirm
            </span>
            <input
              className={field}
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={initialName}
            />
          </label>

          <button
            type="button"
            onClick={handleDelete}
            disabled={deletePending || confirmName !== initialName}
            className="self-start rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {deletePending ? "Deleting…" : "Delete this trip"}
          </button>
          {deleteError && <p className="text-sm text-red-500">{deleteError}</p>}
        </div>
      )}
    </div>
  );
}
