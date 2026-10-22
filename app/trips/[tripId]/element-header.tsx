"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import { EditElementForm } from "./edit-element-form";
import { useRouter } from "next/navigation";
import { nudgeElement } from "./nudge-actions";
import { extendPaymentRetry } from "./payment-actions";
import { Lightbox } from "./traveler-details";

const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-brand-teal-deep focus-visible:ring-offset-2";

/**
 * Element page UI state shared between the header's "⋯" menu and the
 * funding card (founder redesign, 2026-10-14): "Set a new deadline" in the
 * menu opens the funding card's existing deadline editor instead of a
 * second deadline form.
 */
type ElementPageUI = { deadlineEditorOpen: boolean; setDeadlineEditorOpen: (open: boolean) => void };
const ElementPageUIContext = createContext<ElementPageUI | null>(null);

export function ElementPageUIProvider({ children }: { children: ReactNode }) {
  const [deadlineEditorOpen, setDeadlineEditorOpen] = useState(false);
  return (
    <ElementPageUIContext.Provider value={{ deadlineEditorOpen, setDeadlineEditorOpen }}>{children}</ElementPageUIContext.Provider>
  );
}

/** null outside the element page (FundingCard then keeps its own state). */
export function useElementPageUI(): ElementPageUI | null {
  return useContext(ElementPageUIContext);
}

/** A "⋯" menu item that opens a dialog with server-rendered content
 * (e.g. "Traveler details…", "Edit booking record"). */
export type HeaderDialog = { key: string; text: string; title: string; subtitle?: string; content: ReactNode };

type EditProps = Omit<Parameters<typeof EditElementForm>[0], "forceOpen" | "onRequestClose">;

/** Icon-only status marker with a native tooltip and an accessible label. */
function IconBadge({ label, tone, children }: { label: string; tone: "amber" | "coral"; children: ReactNode }) {
  const tones = {
    amber: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300",
    coral: "border-transparent bg-[#D4402F] text-white",
  };
  return (
    <span
      role="img"
      tabIndex={0}
      aria-label={label}
      title={label}
      className={`inline-grid size-7 flex-none place-items-center rounded-full border ${tones[tone]} ${focusRing}`}
    >
      {children}
    </span>
  );
}

/**
 * The element card's header: type badge, name + chosen option, status chip,
 * the deadline clock and "waiting on you" (icon-only), and the "⋯" menu.
 */
export function ElementHeader({
  tripId,
  elementId,
  symbol,
  label,
  subtitle,
  chip,
  deadlineLabel,
  waitingOnYou,
  edit,
  deadlineAction,
  nudge,
  finalNudge,
  dialogs,
  chipAction,
}: {
  tripId: string;
  elementId: string;
  symbol: string;
  label: string;
  /** the locked option's name, or the leading option while voting */
  subtitle?: string | null;
  chip?: { text: string; dashed?: boolean } | null;
  /** e.g. "Funding closes in 9h" — null when there's no deadline */
  deadlineLabel?: string | null;
  waitingOnYou?: boolean;
  /** EditElementForm props when the viewer can edit (canEdit), else null */
  edit?: EditProps | null;
  /** "Set a new deadline" (organizers): open the edit dialog (voting) or the funding deadline editor */
  deadlineAction?: "edit" | "funding" | null;
  /** organizers, when someone still has to act */
  nudge?: { count: number; phaseLabel: string } | null;
  /** organizers while Committing: give the stragglers 24h more */
  finalNudge?: { fundingRequestId: string } | null;
  /** extra menu items that open a dialog */
  dialogs?: HeaderDialog[];
  /** a control on the status row, right-aligned opposite the chip (e.g. Opt out) */
  chipAction?: ReactNode;
}) {
  const router = useRouter();
  const [openDialog, setOpenDialog] = useState<string | null>(null);
  const ui = useElementPageUI();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [nudgeMsg, setNudgeMsg] = useState<string | null>(null);
  const [nudging, startNudge] = useTransition();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const menuId = useId();

  const items: { key: string; text: string; run: () => void }[] = [];
  if (edit) items.push({ key: "edit", text: "Edit element", run: () => setEditing(true) });
  if (deadlineAction === "edit" && edit) items.push({ key: "deadline", text: "Set a new deadline", run: () => setEditing(true) });
  if (deadlineAction === "funding")
    items.push({
      key: "deadline",
      text: "Set a new deadline",
      run: () => {
        ui?.setDeadlineEditorOpen(true);
        // the editor lives in the funding card below
        requestAnimationFrame(() => document.getElementById("funding-deadline")?.scrollIntoView({ behavior: "smooth", block: "center" }));
      },
    });
  if (nudge && nudge.count > 0)
    items.push({
      key: "nudge",
      text: `Nudge those who haven't ${({ commit: "committed", vote: "voted", submit: "submitted", pledge: "pledged", pay: "paid", pledgeOrPay: "pledged or paid" } as Record<string, string>)[nudge.phaseLabel] ?? "acted"}`,
      run: () =>
        startNudge(async () => {
          const res = await nudgeElement(tripId, elementId);
          setNudgeMsg(res.error ?? (res.sent ? `Nudged ${res.sent}` : "Nobody to nudge"));
        }),
    });

  if (finalNudge)
    items.push({
      key: "final-nudge",
      text: "Final nudge (+24h)",
      run: () =>
        startNudge(async () => {
          const res = await extendPaymentRetry(tripId, elementId, finalNudge.fundingRequestId, 24);
          setNudgeMsg(res.error ?? "Gave everyone 24 more hours");
          if (!res.error) router.refresh();
        }),
    });
  for (const d of dialogs ?? []) items.push({ key: `dialog-${d.key}`, text: d.text, run: () => setOpenDialog(d.key) });

  const close = useCallback((refocus = true) => {
    setMenuOpen(false);
    if (refocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen, close]);

  function onMenuKey(e: React.KeyboardEvent) {
    const els = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      els[(i + 1) % els.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      els[(i - 1 + els.length) % els.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      els[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      els[els.length - 1]?.focus();
    } else if (e.key === "Tab") {
      close(false);
    }
  }

  // Clock + "waiting on you": in the header on wider screens; next to the
  // chip on phones so the name keeps its room.
  const statusIcons = (deadlineLabel || waitingOnYou) && (
    <>
    {deadlineLabel && (
      <IconBadge label={deadlineLabel} tone="amber">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      </IconBadge>
    )}
    {waitingOnYou && (
      <IconBadge label="Waiting on you" tone="coral">
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
          <path d="M12 6.4v7.2" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
          <circle cx="12" cy="17.6" r="1.6" fill="currentColor" />
        </svg>
      </IconBadge>
    )}
    </>
  );

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="grid size-[38px] flex-none place-items-center rounded-[10px] border border-brand-line font-[family-name:var(--font-display)] text-sm font-bold text-brand-accent"
          >
            {symbol}
          </span>
          <div className="min-w-0">
            <h1 className="truncate font-[family-name:var(--font-display)] text-xl font-bold leading-tight text-foreground sm:text-[22px]">
              {label}
            </h1>
            {subtitle && <p className="truncate text-[13px] text-brand-muted">{subtitle}</p>}
          </div>
        </div>
        <div className="flex flex-none items-center gap-2">
          <span className="hidden items-center gap-2 sm:flex">{statusIcons}</span>
          {items.length > 0 && (
            <div className="relative">
              <button
                ref={buttonRef}
                type="button"
                aria-label="Element actions"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-controls={menuOpen ? menuId : undefined}
                onClick={() => setMenuOpen((v) => !v)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown" && !menuOpen) {
                    e.preventDefault();
                    setMenuOpen(true);
                  }
                }}
                className={`grid size-[34px] place-items-center rounded-[10px] border border-brand-line bg-brand-surface text-brand-muted hover:text-foreground ${focusRing}`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <circle cx="5" cy="12" r="1.8" />
                  <circle cx="12" cy="12" r="1.8" />
                  <circle cx="19" cy="12" r="1.8" />
                </svg>
              </button>
              {menuOpen && (
                <ul
                  ref={menuRef}
                  id={menuId}
                  role="menu"
                  aria-label="Element actions"
                  onKeyDown={onMenuKey}
                  className="absolute right-0 top-[calc(100%+6px)] z-30 w-max min-w-[180px] rounded-xl border border-brand-line bg-brand-surface p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
                >
                  {items.map((it) => (
                    <li key={it.key} role="none">
                      <button
                        type="button"
                        role="menuitem"
                        tabIndex={-1}
                        disabled={(it.key === "nudge" || it.key === "final-nudge") && nudging}
                        onClick={() => {
                          close(it.key !== "edit" && it.key !== "deadline" && !it.key.startsWith("dialog-"));
                          it.run();
                        }}
                        className={`block w-full whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm font-medium text-foreground hover:bg-brand-teal-wash focus-visible:bg-brand-teal-wash disabled:opacity-50 ${focusRing}`}
                      >
                        {(it.key === "nudge" || it.key === "final-nudge") && nudging ? "Sending…" : it.text}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
      {(chip || nudgeMsg || statusIcons || chipAction) && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-2 sm:hidden">{statusIcons}</span>
          {chip && (
            <span
              className={`rounded-full border-[1.5px] border-brand-accent px-2.5 py-0.5 text-xs font-semibold text-brand-accent ${
                chip.dashed ? "border-dashed bg-brand-teal-wash" : ""
              }`}
            >
              {chip.text}
            </span>
          )}
          {nudgeMsg && (
            <span role="status" className="text-xs text-brand-muted">
              {nudgeMsg}
            </span>
          )}
          {chipAction && <span className="ml-auto">{chipAction}</span>}
        </div>
      )}
      {(dialogs ?? []).map(
        (d) =>
          openDialog === d.key && (
            <Lightbox key={d.key} title={d.title} subtitle={d.subtitle} onClose={() => setOpenDialog(null)}>
              {d.content}
            </Lightbox>
          ),
      )}
      {editing && edit && (
        <Lightbox title="Edit element" onClose={() => setEditing(false)}>
          <EditElementForm {...edit} forceOpen onRequestClose={() => setEditing(false)} />
        </Lightbox>
      )}
    </div>
  );
}
