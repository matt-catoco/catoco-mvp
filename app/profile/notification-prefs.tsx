"use client";

import { useState, useTransition } from "react";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { ChannelPreference } from "@/lib/push/channels";
import { setNotificationPreference } from "./notification-actions";

type Choice = ChannelPreference | "default";
const CHOICES: Choice[] = ["default", "push", "email", "both", "off"];

/**
 * Per-kind channel choice. Shown only once this person has the app with
 * push turned on (founder 2026-10-14: no email-notification settings on the
 * web for now; the unsubscribe link covers email).
 */
export function NotificationPrefs({ t, initial }: { t: Dictionary["push"]; initial: Record<string, ChannelPreference> }) {
  const [values, setValues] = useState<Record<string, Choice>>(initial);
  const [savedKind, setSavedKind] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function change(kind: string, channel: Choice) {
    const before = values[kind] ?? "default";
    setValues((v) => ({ ...v, [kind]: channel }));
    setError("");
    startTransition(async () => {
      const res = await setNotificationPreference(kind, channel);
      if (res.error) {
        setValues((v) => ({ ...v, [kind]: before }));
        setError(res.error);
        return;
      }
      setSavedKind(kind);
    });
  }

  return (
    <section aria-labelledby="notif-prefs" className="mt-4">
      <h2 id="notif-prefs" className="font-display text-xl font-semibold">
        {t.prefsHeading}
      </h2>
      <p className="mt-1 text-sm text-brand-muted">{t.prefsSub}</p>
      <p className="mt-1 text-sm text-brand-muted">{t.prefsCritical}</p>
      <ul className="mt-4 divide-y divide-brand-line">
        {Object.entries(t.labels).map(([kind, label]) => (
          <li key={kind} className="flex items-center justify-between gap-3 py-2">
            <label htmlFor={`pref-${kind}`} className="text-sm text-foreground">
              {label}
            </label>
            <span className="flex items-center gap-2">
              {savedKind === kind && !pending && <span className="text-xs text-brand-muted">{t.saved}</span>}
              <select
                id={`pref-${kind}`}
                value={values[kind] ?? "default"}
                onChange={(e) => change(kind, e.target.value as Choice)}
                className="tap-target rounded-lg border border-brand-line bg-transparent px-2 text-sm"
              >
                {CHOICES.map((c) => (
                  <option key={c} value={c}>
                    {t.channels[c]}
                  </option>
                ))}
              </select>
            </span>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-brand-coral">
          {error}
        </p>
      )}
    </section>
  );
}
