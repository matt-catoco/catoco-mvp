import type { ElementTier, ElementType } from "@/lib/trip-elements";
import type { ElementSchedule } from "@/lib/element-schedule";
import type { TileAlerts } from "./element-tile";

/** One element, fully pre-computed server-side — every Trip overview view
 * (Table/Itinerary/Calendar/Kanban) renders from this same shape so the
 * status/schedule logic lives in exactly one place (lib/trip-elements.ts,
 * lib/element-schedule.ts), not re-derived per view. */
export type OverviewElement = {
  id: string;
  type: ElementType;
  label: string;
  symbol: string;
  num: string;
  tier: ElementTier;
  statusLabel: string;
  detail?: string;
  href: string;
  schedule: ElementSchedule | null;
  /** Card alerts for the signed-in viewer (deadline clock, not-committed mark, footer). */
  alerts?: TileAlerts;
};

export const TIER_ORDER = { ready: 0, funded: 1, locked: 2, open: 3 } as const;
