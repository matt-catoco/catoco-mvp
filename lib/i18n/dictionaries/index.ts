import type { Locale } from "../config";
import { en } from "./en";
import { nl } from "./nl";

/** Same shape as English, every leaf a string. */
type Strings<T> = { [K in keyof T]: T[K] extends string ? string : Strings<T[K]> };
export type Dictionary = Strings<typeof en>;

export const dictionaries: Record<Locale, Dictionary> = { en, nl };

/**
 * Legal and money wording ("needs_review"): no machine translation, and a
 * Dutch reviewer (plus the lawyer where it's terms) signs these off before
 * production relies on them. Dotted key paths.
 */
export const NEEDS_REVIEW: readonly string[] = [
  "collection.modes.peer_pledge.risk",
  "collection.modes.catoco_psp.cost",
  "collection.modes.catoco_psp.risk",
  // The pledge terms are the conditional contract members accept.
  "pledge.termsShare",
  "pledge.termsFixed",
  "pledge.termsPayNow",
  "pledge.termsWindow",
  "pledge.termsPayLater",
  "pledge.termsDropout",
  "pledge.termsMoney",
  "pledge.agree",
  "pledgeOrg.gapCoverConfirm",
  "booking.payPledge",
  "booking.shortfall",
];
