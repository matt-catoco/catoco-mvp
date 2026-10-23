"use client";

import { useActionState, useEffect } from "react";
import Link from "next/link";
import type { suppliers } from "@/content/pages/en";
import { trackEvent } from "@/components/posthog-provider";
import { btnPrimary, fieldClass, labelClass } from "@/lib/ui";
import { LIMITS, OFFERINGS } from "@/lib/supplier-interest";
import { submitSupplierInterest, type SupplierInterestState } from "./actions";

type Copy = typeof suppliers;

export function SupplierForm({ copy, source, privacyHref }: { copy: Copy; source: string; privacyHref: string | null }) {
  const [state, action, pending] = useActionState<SupplierInterestState, FormData>(submitSupplierInterest, { status: "idle" });

  // No personal data in analytics properties.
  useEffect(() => {
    trackEvent("supplier_interest_viewed");
  }, []);
  useEffect(() => {
    if (state.status === "ok") trackEvent("supplier_interest_submitted");
  }, [state.status]);

  if (state.status === "ok") {
    return (
      <p role="status" className="mt-6 rounded-xl bg-brand-teal-wash px-4 py-3 font-medium text-foreground">
        {copy.thanks}
      </p>
    );
  }

  const field = `h-11 ${fieldClass}`;
  const f = copy.fields;
  return (
    <form action={action} className="mt-6 grid gap-4 sm:grid-cols-2" noValidate>
      {/* Honeypot: hidden from people and screen readers. */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Company website
          <input type="text" name="company_website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <input type="hidden" name="source" value={source} />

      <label className="flex flex-col gap-1">
        <span className={labelClass}>{f.businessName}</span>
        <input name="businessName" required maxLength={LIMITS.businessName} autoComplete="organization" className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>{f.contactName}</span>
        <input name="contactName" required maxLength={LIMITS.contactName} autoComplete="name" className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>{f.email}</span>
        <input name="email" type="email" required maxLength={LIMITS.email} autoComplete="email" className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>{f.city}</span>
        <input name="city" required maxLength={LIMITS.city} defaultValue={f.cityDefault} autoComplete="address-level2" className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>{f.offering}</span>
        <select name="offering" required defaultValue="" className={field}>
          <option value="" disabled>
            {f.offeringPlaceholder}
          </option>
          {OFFERINGS.map((o) => (
            <option key={o} value={o}>
              {copy.offerings[o]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>{f.groupSize}</span>
        <input name="groupSize" inputMode="numeric" maxLength={LIMITS.groupSize} placeholder={f.groupSizeHint} className={field} />
      </label>
      <label className="flex flex-col gap-1 sm:col-span-2">
        <span className={labelClass}>{f.website}</span>
        <input name="website" type="url" maxLength={LIMITS.website} placeholder="https://" autoComplete="url" className={field} />
      </label>
      <label className="flex flex-col gap-1 sm:col-span-2">
        <span className={labelClass}>{f.note}</span>
        <textarea name="note" rows={4} maxLength={LIMITS.note} className={`py-2 ${fieldClass}`} />
      </label>

      <p className="text-sm text-brand-muted sm:col-span-2">
        {copy.consent}{" "}
        {privacyHref ? (
          <>
            {copy.privacyLead}{" "}
            <Link href={privacyHref} className="font-medium text-brand-teal-deep hover:underline">
              {copy.privacyLink}
            </Link>
            .
          </>
        ) : (
          copy.privacyFallback
        )}
      </p>

      {state.status === "error" && (
        <p role="alert" className="text-sm font-medium text-brand-coral sm:col-span-2">
          {copy.errors[state.error]}
        </p>
      )}

      <div className="sm:col-span-2">
        <button type="submit" disabled={pending} className={`px-5 py-2.5 text-sm ${btnPrimary}`}>
          {pending ? copy.submitting : copy.submit}
        </button>
      </div>
    </form>
  );
}
