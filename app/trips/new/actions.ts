"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  categoryOf,
  normalizeOptionValue,
  validateOptionValue,
  type ElementType,
} from "@/lib/trip-elements";
import { ALL_TYPES } from "@/lib/trip-elements";
import type { WizardDraft } from "./types";

export type CreateTripResult = { error: string };

/**
 * Builds the RPC payload from the wizard draft, re-validates server-side, and
 * calls public.create_trip (one transaction). On success it redirects to the new
 * trip; on failure it returns an error string for the review screen.
 */
export async function createTrip(
  draft: WizardDraft,
): Promise<CreateTripResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const name = (draft?.name ?? "").trim();
  if (!name) return { error: "Give the trip a name." };

  const elements: Array<{
    category: "macro" | "micro";
    type: ElementType;
    state: "locked" | "open";
    deadline: string | null;
    options: Array<{ value: unknown }>;
  }> = [];

  for (const type of ALL_TYPES) {
    const el = draft.elements?.[type];
    if (!el || el.choice === "skip") continue;

    const rawOptions = el.options ?? [];

    if (el.choice === "locked") {
      if (rawOptions.length !== 1) {
        return { error: `Set a value for ${type}, or skip it.` };
      }
    }

    for (const opt of rawOptions) {
      const err = validateOptionValue(type, opt.value);
      if (err) return { error: `${type}: ${err}` };
    }

    elements.push({
      category: categoryOf(type),
      type,
      state: el.choice,
      deadline:
        el.choice === "open" && el.deadline ? el.deadline : null,
      options: rawOptions.map((o) => ({
        value: normalizeOptionValue(type, o.value),
      })),
    });
  }

  const { data, error } = await supabase.rpc("create_trip", {
    payload: { name, icon: draft.icon ?? null, elements },
  });

  if (error) return { error: error.message };

  redirect(`/trips/${data as string}`);
}
