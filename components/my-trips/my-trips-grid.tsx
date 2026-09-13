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
      <div className="flex w-fit gap-1 rounded-full bg-brand-teal-wash p-1">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-full px-[18px] py-2 text-[13.5px] font-bold transition-colors ${
              tab === key ? "bg-foreground text-background" : "text-brand-teal-deep"
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
        <div className="grid grid-cols-1 gap-[22px] min-[760px]:grid-cols-2">
          {trips.map((trip) => (
            <TripCard key={trip.id} trip={trip} />
          ))}
        </div>
      )}
    </div>
  );
}
