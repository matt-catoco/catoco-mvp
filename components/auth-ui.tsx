import type { ReactNode } from "react";

/**
 * Shared pieces for the sign-in, account and error screens ("Getting In"
 * mockup, 2026-10-14): one centered card, a filled teal button, a ghost
 * button, a text field and an icon badge. Brand tokens only (globals.css),
 * so light and dark both work; focus rings stay visible.
 */

const focusRing =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent";

/** Filled teal button (44px, 12px radius, ink text). */
export const authButton = `inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-teal px-5 text-sm font-semibold text-[#0d2020] transition-opacity hover:opacity-90 disabled:opacity-50 ${focusRing}`;

/** Ghost button: same size, line border, foreground text. */
export const authGhostButton = `inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-brand-line bg-transparent px-5 text-sm font-semibold text-foreground transition-colors hover:border-brand-accent ${focusRing}`;

/** Text field (46px, brand-line border, 12px radius). */
export const authField = `h-[46px] w-full rounded-xl border-[1.5px] border-brand-line bg-brand-surface px-3.5 text-[15px] text-foreground placeholder:text-brand-muted focus:border-brand-accent ${focusRing}`;

export const authLabel = "mb-1.5 block text-[13px] font-semibold text-foreground";

/** Inline text link (e.g. "Undo"). */
export const authLink = `font-semibold text-brand-accent underline underline-offset-[3px] ${focusRing} rounded-sm`;

/** Coral error text. */
export const authError = "text-sm text-brand-coral";

/** The centered page + card every screen uses. */
export function AuthCard({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16 sm:py-24" aria-label={label}>
      <div className="flex w-full max-w-[340px] flex-col gap-4">{children}</div>
    </main>
  );
}

export function AuthHeading({ children }: { children: ReactNode }) {
  return (
    <h1 className="font-[family-name:var(--font-display)] text-[26px] font-bold leading-[1.1] tracking-[-0.02em] text-foreground">
      {children}
    </h1>
  );
}

export function AuthText({ children }: { children: ReactNode }) {
  return <p className="text-[14.5px] text-brand-muted">{children}</p>;
}

/** The wordmark in the display face. */
export function Wordmark({ className = "text-2xl" }: { className?: string }) {
  return (
    <span className={`font-[family-name:var(--font-display)] font-bold tracking-[-0.02em] text-foreground ${className}`}>
      catoco
    </span>
  );
}

/** 52px icon badge above a heading. `tone="error"` = coral outline. */
export function AuthIcon({ icon, tone = "ok" }: { icon: "mail" | "check" | "alert"; tone?: "ok" | "error" }) {
  const box =
    tone === "error"
      ? "border-brand-coral text-brand-coral"
      : "border-brand-accent bg-brand-teal-wash text-brand-accent";
  return (
    <span className={`grid size-[52px] place-items-center rounded-[15px] border-[1.5px] ${box}`} aria-hidden>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={icon === "check" ? 2.6 : 2.2} strokeLinecap="round" strokeLinejoin="round">
        {icon === "mail" && (
          <>
            <rect x="3" y="5" width="18" height="14" rx="3" />
            <path d="M3.5 7.5l8.5 6 8.5-6" />
          </>
        )}
        {icon === "check" && <path d="M5 12l5 5 9-10" />}
        {icon === "alert" && <path d="M12 7v6M12 17h.01" />}
      </svg>
    </span>
  );
}
