/**
 * Company identity: the single source for the legal entity, brand name and
 * registration numbers. The footer legal line, the About page and the Terms
 * draft all read from here (founder, 2026-10-19). Never hard-code these
 * elsewhere. English reads "doing business as" (never "dba" or "trading
 * name"); Dutch reads "h.o.d.n." and "BTW".
 */
export const COMPANY = {
  entity: "Catalyst to Commit B.V.",
  brand: "Catoco",
  kvk: "42189338",
  vat: "NL8701060004",
  managingDirector: "Matt Savit",
  email: "hello@catoco.co",
} as const;

export const legalLine = {
  en: `${COMPANY.entity}, doing business as ${COMPANY.brand} · KvK ${COMPANY.kvk} · VAT ${COMPANY.vat}`,
  nl: `${COMPANY.entity} h.o.d.n. ${COMPANY.brand} · KvK ${COMPANY.kvk} · BTW ${COMPANY.vat}`,
} as const;
