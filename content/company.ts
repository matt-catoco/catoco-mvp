/**
 * Company identity: the single source for the legal entity, brand name and
 * registration numbers. The footer legal line, the About page and the Terms
 * draft all read from here (founder, 2026-10-19). Never hard-code these
 * elsewhere. The English footer line reads "dba" (founder, 2026-10-23; the About
 * page row still spells out "Doing business as"), never "trading
 * name"); Dutch reads "h.o.d.n." and "BTW".
 */
export const COMPANY = {
  entity: "Catalyst to Commit B.V.",
  brand: "Catoco",
  kvk: "42189338",
  vat: "NL870106004B01",
  managingDirector: "Matthew Savit",
  email: "hello@catoco.co",
  // Registered business address (EU e-commerce rules: a geographic address
  // must be on the site). Founder, 2026-10-22.
  address: "Keizersgracht 699C, 1017 DW Amsterdam, Netherlands",
} as const;

export const legalLine = {
  en: `${COMPANY.entity} dba ${COMPANY.brand} · ${COMPANY.address} · KvK ${COMPANY.kvk} · VAT ${COMPANY.vat}`,
  nl: `${COMPANY.entity} h.o.d.n. ${COMPANY.brand} · ${COMPANY.address} · KvK ${COMPANY.kvk} · BTW ${COMPANY.vat}`,
} as const;
