"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { ALL_TYPES, type ElementType } from "@/lib/trip-elements";
import { createTrip } from "./actions";
import { StartStep } from "./steps/start-step";
import { NameStep } from "./steps/name-step";
import { ElementsStep } from "./steps/elements-step";
import { ReviewStep } from "./steps/review-step";
import type { ElementDraft, WizardDraft, WizardStep } from "./types";

const STORAGE_KEY = "catoco:new-trip-draft:v1";
const NUMBERED: WizardStep[] = ["name", "macro", "micro", "review"];

function emptyElement(): ElementDraft {
  return { choice: "skip", deadline: "", options: [] };
}

function emptyDraft(): WizardDraft {
  return {
    name: "",
    icon: null,
    elements: Object.fromEntries(
      ALL_TYPES.map((t) => [t, emptyElement()]),
    ) as WizardDraft["elements"],
  };
}

function loadDraft(): WizardDraft {
  const base = emptyDraft();
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<WizardDraft>;
    if (!parsed || typeof parsed.name !== "string" || !parsed.elements) return base;
    base.name = parsed.name;
    base.icon = parsed.icon ?? null;
    for (const t of ALL_TYPES) {
      const el = parsed.elements[t];
      if (el && el.choice && Array.isArray(el.options)) {
        base.elements[t] = {
          choice: el.choice,
          deadline: typeof el.deadline === "string" ? el.deadline : "",
          options: el.options,
        };
      }
    }
    return base;
  } catch {
    return base;
  }
}

function persist(draft: WizardDraft) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    /* private mode / storage disabled — fine, just no resume */
  }
}

function clearPersisted() {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function NewTripWizard({ userId }: { userId: string }) {
  const [step, setStep] = useState<WizardStep>("start");
  const [draft, setDraft] = useState<WizardDraft>(emptyDraft);
  const [hydrated, setHydrated] = useState(false);
  const [creating, startCreate] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Restore any in-progress draft after mount (avoids SSR mismatch).
  useEffect(() => {
    setDraft(loadDraft());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) persist(draft);
  }, [draft, hydrated]);

  const setElement = useCallback((type: ElementType, next: ElementDraft) => {
    setDraft((d) => ({ ...d, elements: { ...d.elements, [type]: next } }));
  }, []);

  const go = (s: WizardStep) => {
    setError(null);
    setStep(s);
    window.scrollTo({ top: 0 });
  };

  const onCreate = () => {
    setError(null);
    startCreate(async () => {
      clearPersisted();
      const res = await createTrip(draft);
      if (res?.error) {
        setError(res.error);
        persist(draft); // creation failed — keep the draft for a retry
      }
    });
  };

  const stepIndex = NUMBERED.indexOf(step);

  return (
    <div className="mx-auto w-full max-w-xl px-6 py-12">
      {stepIndex >= 0 && (
        <p className="mb-6 text-xs font-medium uppercase tracking-wide text-zinc-400">
          Step {stepIndex + 1} of {NUMBERED.length}
        </p>
      )}

      {step === "start" && <StartStep onNext={() => go("name")} />}

      {step === "name" && (
        <NameStep
          draft={draft}
          setDraft={setDraft}
          userId={userId}
          onNext={() => go("macro")}
          onBack={() => go("start")}
        />
      )}

      {step === "macro" && (
        <ElementsStep
          category="macro"
          draft={draft}
          setElement={setElement}
          onNext={() => go("micro")}
          onBack={() => go("name")}
        />
      )}

      {step === "micro" && (
        <ElementsStep
          category="micro"
          draft={draft}
          setElement={setElement}
          onNext={() => go("review")}
          onBack={() => go("macro")}
        />
      )}

      {step === "review" && (
        <ReviewStep
          draft={draft}
          onBack={() => go("micro")}
          onCreate={onCreate}
          creating={creating}
          error={error}
        />
      )}
    </div>
  );
}
