"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton } from "./sign-out-button";

const focusRing =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent";

/** "My trips" with the teal underline when it's the current section. */
export function MyTripsLink() {
  const pathname = usePathname();
  const current = pathname === "/trips" || pathname.startsWith("/trips/");
  return (
    <Link
      href="/trips"
      aria-current={current ? "page" : undefined}
      className={`flex h-full items-center text-sm font-medium ${
        current ? "text-foreground shadow-[inset_0_-2px_0_var(--brand-teal)]" : "text-brand-muted hover:text-foreground"
      } ${focusRing}`}
    >
      My trips
    </Link>
  );
}

function initials(name: string, email: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (email[0] ?? "?").toUpperCase();
}

const itemClass = `flex w-full items-center gap-2.5 rounded-[9px] px-3 py-2 text-left text-sm font-medium text-foreground hover:bg-brand-teal-wash focus-visible:bg-brand-teal-wash disabled:opacity-50 ${focusRing}`;

/**
 * Initials avatar + account menu (menu button pattern): name and email at
 * the top, then Profile and Sign out. Opens on click / Enter / Space /
 * ArrowDown, moves with the arrow keys, Home/End, closes on Escape, Tab or
 * a click outside, and hands focus back to the avatar.
 */
export function AccountMenu({ name, email }: { name: string; email: string }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<(HTMLElement | null)[]>([]);
  const menuId = useId();
  const pathname = usePathname();

  // Close on navigation (adjust state while rendering, not in an effect).
  const [menuPath, setMenuPath] = useState(pathname);
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    itemsRef.current[0]?.focus();
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function close(refocus = true) {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  }

  function onMenuKey(e: React.KeyboardEvent) {
    const items = itemsRef.current.filter(Boolean) as HTMLElement[];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === "Tab") {
      close(false);
    }
  }

  const displayName = name.trim() || email;

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={`grid size-[34px] place-items-center rounded-full border-[1.5px] border-brand-accent bg-brand-teal-wash font-[family-name:var(--font-display)] text-xs font-bold text-brand-accent ${focusRing}`}
      >
        {initials(name, email)}
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKey}
          className="absolute right-0 top-[calc(100%+10px)] z-50 w-[230px] rounded-[14px] border border-brand-line bg-brand-surface p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
        >
          <div className="mb-1.5 border-b border-brand-line px-3 pb-2.5 pt-2">
            <b className="block truncate font-[family-name:var(--font-display)] text-sm font-bold text-foreground">
              {displayName}
            </b>
            <span className="block truncate text-[12.5px] text-brand-muted">{email}</span>
          </div>
          <Link
            ref={(el) => {
              itemsRef.current[0] = el;
            }}
            href="/profile"
            role="menuitem"
            tabIndex={-1}
            className={itemClass}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="flex-none text-brand-muted" aria-hidden>
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6" />
            </svg>
            Profile
          </Link>
          <hr className="my-1.5 border-0 border-t border-brand-line" />
          <SignOutButton
            ref={(el) => {
              itemsRef.current[1] = el;
            }}
            role="menuitem"
            tabIndex={-1}
            className={itemClass}
            icon={
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-none text-brand-muted" aria-hidden>
                <path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4" />
                <path d="M16 8l4 4-4 4M20 12H9" />
              </svg>
            }
          />
        </div>
      )}
    </div>
  );
}
