import type { Metadata } from "next";
import { SampleTrip } from "./sample-trip";

// Public sample trip (founder, 2026-10-23): a pre-filled trip anyone can step
// through without an account. Everything runs in the browser on example data;
// nothing is saved and a reload starts over. Live on production and indexable.
export const metadata: Metadata = {
  title: "Sample trip",
  description:
    "Step through a sample Catoco trip: plan the pieces, vote on the options, pledge your share and book. No account needed.",
  robots: { index: true, follow: true },
};

export default function SampleTripPage() {
  return <SampleTrip />;
}
