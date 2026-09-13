"use client";

import { useState } from "react";
import { TripCard, type TripCardData } from "./trip-card";

const TABS = [
  { key: "upcoming", label: "Upcoming" },
  { key: "past", label: "Past" },
] as const;
type Tab = (typeof TABS)[number]["key"];

export function MyTripsGrid({
  upcoming,
  past,
}: {
  upcoming: TripCardData[];
  past: TripCardData[];
}) {
  const [tab, setTab] = useState<Tab>("upcoming");
  const trips = tab === "upcoming" ? upcoming : past;
  const counts = { upcoming: upcoming.length, past: past.length };

  return (
    <div className="mt-8 flex flex-col gap-6">
      <div className="flex w-fit gap-1 rounded-full border border-brand-line bg-black/[.02] p-1 dark:bg-white/[.03]">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors ${
              tab === key ? "bg-foreground text-background" : "text-brand-muted hover:text-foreground"
            }`}
          >
            {label} ({counts[key]})
          </button>
        ))}
      </div>

      {trips.length === 0 ? (
        <p className="rounded-lg border border-brand-line p-6 text-center text-sm text-brand-muted">
          {tab === "upcoming" ? "No upcoming trips." : "No past trips yet."}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 min-[760px]:grid-cols-2">
          {trips.map((trip) => (
            <TripCard key={trip.id} trip={trip} />
          ))}
        </div>
      )}
    </div>
  );
}
