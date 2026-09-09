"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ViewTable } from "./view-table";
import { ViewItinerary } from "./view-itinerary";
import { ViewCalendar } from "./view-calendar";
import { ViewKanban } from "./view-kanban";
import type { OverviewElement } from "./types";

type ViewKey = "table" | "itinerary" | "calendar" | "kanban";

const VIEWS: { key: ViewKey; label: string }[] = [
  { key: "table", label: "Table" },
  { key: "itinerary", label: "Itinerary" },
  { key: "calendar", label: "Calendar" },
  { key: "kanban", label: "Kanban" },
];

function SettingsGearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 15a3 3 0 100-6 3 3 0 000 6z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1.08-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1.08 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Trip Home's shared shell (2026-09-xx "Trip overview — view options"): one
 * header — trip name, settings gear, Add element/Participants, the view
 * pills — persists across all four ways of looking at the same element
 * list, which is fetched and pre-computed (tier, schedule) exactly once by
 * the server page and just handed here. Switching views is local state, not
 * navigation — every view's data is already in hand, so there's nothing to
 * refetch.
 */
export function TripOverview({
  tripId,
  tripName,
  subheader,
  canManage,
  addElementModal,
  elements,
  tripDates,
  destinationName,
}: {
  tripId: string;
  tripName: string;
  subheader: string | null;
  canManage: boolean;
  addElementModal: ReactNode;
  elements: OverviewElement[];
  tripDates: { start: string; end: string } | null;
  destinationName: string | null;
}) {
  const [view, setView] = useState<ViewKey>("table");

  return (
    <div className="flex w-full max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-foreground">
              {tripName}
              {canManage && (
                <Link
                  href={`/trips/${tripId}/settings`}
                  aria-label="Trip settings"
                  title="Trip settings"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-brand-line text-brand-muted transition-colors hover:border-brand-teal-deep hover:bg-brand-teal-wash hover:text-brand-teal-deep"
                >
                  <SettingsGearIcon />
                </Link>
              )}
            </h1>
            {subheader && <p className="mt-1 text-sm text-brand-muted">{subheader}</p>}
          </div>
          <div className="flex gap-4 text-xs font-medium">
            {addElementModal}
            <Link
              href={`/trips/${tripId}/participants`}
              className="text-zinc-600 hover:text-black dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              Participants
            </Link>
          </div>
        </div>

        {elements.length > 0 && (
          <div className="flex w-fit gap-1 rounded-full border border-brand-line bg-black/[.02] p-1 dark:bg-white/[.03]">
            {VIEWS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setView(key)}
                className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors ${
                  view === key
                    ? "bg-foreground text-background"
                    : "text-brand-muted hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {elements.length === 0 ? (
        <p className="rounded-lg border border-brand-line p-6 text-center text-sm text-brand-muted">
          Nothing here yet — add the first element.
        </p>
      ) : view === "table" ? (
        <ViewTable elements={elements} />
      ) : view === "itinerary" ? (
        <ViewItinerary elements={elements} tripDates={tripDates} destinationName={destinationName} />
      ) : view === "calendar" ? (
        <ViewCalendar elements={elements} tripDates={tripDates} destinationName={destinationName} />
      ) : (
        <ViewKanban elements={elements} />
      )}
    </div>
  );
}
