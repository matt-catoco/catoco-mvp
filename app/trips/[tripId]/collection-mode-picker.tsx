"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PAYMENT_METHODS, type CollectionMode } from "@/lib/collection-modes";
import { fmt } from "@/lib/i18n/config";
import { useT } from "@/lib/i18n/client";
import { trackEvent } from "@/components/posthog-provider";
import { btnPrimary, btnSecondary } from "@/lib/ui";
import { selectCollectionMode } from "./collection-actions";

const focusRing = "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent";

/**
 * Organizer: how will the group pay (Prompt 0 + launch-scope amendment).
 * Both payment methods are always shown (vendor_direct isn't one: it comes
 * from requesting a quote when the element is added); a method switched off in this environment
 * carries an "On the roadmap" badge, shows no cost detail, and only explains
 * itself when tapped — it never creates anything. Once someone has
 * committed, the choice is locked and only the summary shows.
 */
export function CollectionModePicker({
  tripId,
  elementId,
  fundingRequestId,
  elementLabel,
  mode,
  chosen,
  locked,
  enabled,
  feePercent,
}: {
  tripId: string;
  elementId: string;
  fundingRequestId: string;
  elementLabel: string;
  mode: CollectionMode;
  chosen: boolean;
  locked: boolean;
  enabled: Record<CollectionMode, boolean>;
  feePercent: number;
}) {
  const t = useT();
  const router = useRouter();
  const [editing, setEditing] = useState(!chosen);
  const [explaining, setExplaining] = useState<CollectionMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const viewed = useRef(false);

  const showCards = editing && !locked;
  useEffect(() => {
    if (showCards && !viewed.current) {
      viewed.current = true;
      trackEvent("collection_mode_viewed");
    }
  }, [showCards]);

  function choose(next: CollectionMode) {
    setError(null);
    if (!enabled[next]) {
      setExplaining(next);
      return;
    }
    setExplaining(null);
    startTransition(async () => {
      const res = await selectCollectionMode(tripId, elementId, fundingRequestId, next);
      if (res.error) {
        setError(res.error);
        return;
      }
      trackEvent("collection_mode_selected", { mode: next });
      setEditing(false);
      router.refresh();
    });
  }

  if (!showCards) {
    const m = t.collection.modes[mode];
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-line px-3.5 py-2.5 text-[13px]">
        <span className="min-w-0">
          <span className="text-brand-muted">{t.collection.chosenHeading}: </span>
          <b className="font-semibold text-foreground">{m.title}</b>
          {locked && <span className="block text-[12px] text-brand-muted">{t.collection.lockedNote}</span>}
        </span>
        {!locked && (
          <button type="button" onClick={() => setEditing(true)} className={`h-8 px-3 text-xs ${btnSecondary}`}>
            {t.collection.change}
          </button>
        )}
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-3" aria-labelledby={`collect-${fundingRequestId}`}>
      <div>
        <h3 id={`collect-${fundingRequestId}`} className="font-[family-name:var(--font-display)] text-base font-bold text-foreground">
          {t.collection.heading}
        </h3>
        <p className="text-[13px] text-brand-muted">{fmt(t.collection.sub, { element: elementLabel })}</p>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {PAYMENT_METHODS.map((m) => {
          const copy: { title: string; badge: string; body: string; cost?: string; risk?: string } = t.collection.modes[m];
          const on = enabled[m];
          const isCurrent = chosen && m === mode;
          return (
            <button
              key={m}
              type="button"
              aria-pressed={isCurrent}
              aria-disabled={!on}
              disabled={pending}
              onClick={() => choose(m)}
              className={`flex flex-col gap-1.5 rounded-xl border-[1.5px] p-3 text-left transition-colors ${focusRing} ${
                !on
                  ? "border-dashed border-brand-line opacity-75"
                  : isCurrent
                    ? "border-brand-accent bg-brand-teal-wash"
                    : "border-brand-line hover:border-brand-accent"
              }`}
            >
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="font-[family-name:var(--font-display)] text-[14px] font-bold leading-tight text-foreground">
                  {copy.title}
                </span>
                <span
                  className={`rounded-full px-2 py-px text-[10.5px] font-semibold ${
                    on ? "bg-brand-teal-wash text-brand-accent" : "border border-brand-line text-brand-muted"
                  }`}
                >
                  {on ? copy.badge : t.collection.comingSoon}
                </span>
              </span>
              <span className="text-[12.5px] leading-snug text-brand-muted">{copy.body}</span>
              {/* Cost and risk only for a mode that can actually be used. */}
              {on && copy.cost && (
                <span className="text-[12px] font-semibold text-foreground">{fmt(copy.cost, { percent: feePercent })}</span>
              )}
              {on && copy.risk && <span className="text-[12px] leading-snug text-brand-muted">{copy.risk}</span>}
              {on && (
                <span className={`mt-1 w-fit px-3 py-1 text-xs ${isCurrent ? btnSecondary : btnPrimary}`}>
                  {pending ? t.common.saving : isCurrent ? t.collection.selected : t.collection.use}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {explaining && (
        <p
          role="status"
          className="rounded-lg border border-brand-line bg-black/[.03] px-3 py-2 text-[12.5px] text-brand-muted dark:bg-white/[.05]"
        >
          <b className="font-semibold text-foreground">{t.collection.modes[explaining].title}</b> · {t.collection.comingSoonDetail}
        </p>
      )}
      {error && (
        <p role="alert" className="text-[12.5px] text-red-500">
          {error}
        </p>
      )}
      {chosen && (
        <button type="button" onClick={() => setEditing(false)} className={`self-start text-xs text-brand-muted underline ${focusRing}`}>
          {t.collection.keep}
        </button>
      )}
    </section>
  );
}
