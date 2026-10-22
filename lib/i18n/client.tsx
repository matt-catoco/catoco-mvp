"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Locale } from "./config";
import { dictionaries, type Dictionary } from "./dictionaries";

// Server components pass the resolved locale down once; client components
// read the dictionary from here instead of prop-drilling strings.
const I18nContext = createContext<Locale>("en");

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <I18nContext.Provider value={locale}>{children}</I18nContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(I18nContext);
}

export function useT(): Dictionary {
  return dictionaries[useContext(I18nContext)];
}
