// Duffel sandbox order check — proves search → select → book works end to
// end against Duffel TEST mode. Deliberately NOT part of the app: every
// element type (flights included) is still booked by the purchaser and
// self-reported via "Mark booked". Whether Flight ever becomes app-driven
// purchasing is a separate founder decision (the planned path is Stripe
// Issuing first) — see the 2026-10-01 vendor-integration prompt.
//
// Usage (from the repo root; reads DUFFEL_API_KEY from .env.local):
//   node scripts/duffel-sandbox-order-check.mjs
//
// Test-mode only: refuses anything but a duffel_test_ key. Pays with
// Duffel's test balance (unlimited in test mode), books Duffel Airways (ZZ)
// — Duffel's fictional test airline — with a clearly fake passenger.
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const key = env.match(/^DUFFEL_API_KEY=(.*)$/m)?.[1]?.trim();
if (!key?.startsWith("duffel_test_")) {
  console.error("Refusing to run: DUFFEL_API_KEY must be a duffel_test_ key.");
  process.exit(1);
}

const BASE = "https://api.duffel.com";
const H = {
  Authorization: `Bearer ${key}`,
  "Duffel-Version": "v2",
  Accept: "application/json",
  "Content-Type": "application/json",
};

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: H, body: body && JSON.stringify({ data: body }) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json.errors ?? json).slice(0, 500)}`);
  return json.data;
}

const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

// 1. Search (same call shape the app's duffelSearch() makes).
const request = await call("POST", "/air/offer_requests?return_offers=true&supplier_timeout=15000", {
  slices: [{ origin: "LHR", destination: "JFK", departure_date: day(60) }],
  passengers: [{ type: "adult" }],
  cabin_class: "economy",
});
const zz = request.offers.filter((o) => o.owner?.iata_code === "ZZ");
const pool = zz.length ? zz : request.offers;
const picked = pool.sort((a, b) => Number(a.total_amount) - Number(b.total_amount))[0];
if (!picked) throw new Error("No offers returned");
console.log(`1. search   ${request.offers.length} offers; picked ${picked.owner?.name} (${picked.owner?.iata_code}) ${picked.total_amount} ${picked.total_currency}`);

// 2. Select — re-fetch the offer for its current price (Duffel's guidance:
//    the price can move between search and booking).
const offer = await call("GET", `/air/offers/${picked.id}`);
console.log(`2. select   confirmed ${offer.total_amount} ${offer.total_currency}, expires ${offer.expires_at}`);

// 3. Book — instant order paid from the test balance. Passenger ids must be
//    the ones Duffel assigned on the offer request.
const order = await call("POST", "/air/orders", {
  type: "instant",
  selected_offers: [offer.id],
  payments: [{ type: "balance", currency: offer.total_currency, amount: offer.total_amount }],
  passengers: [
    {
      id: request.passengers[0].id,
      title: "mr",
      gender: "m",
      given_name: "Test",
      family_name: "Catoco",
      born_on: "1990-01-01",
      email: "test@example.com",
      phone_number: "+442080160508",
    },
  ],
});
console.log(`3. book     order ${order.id} — booking reference ${order.booking_reference}, ${order.total_amount} ${order.total_currency}, live_mode=${order.live_mode}`);
if (order.live_mode !== false) {
  console.error("Unexpected: order is not test-mode.");
  process.exit(1);
}
console.log("OK — sandbox search → select → book completed.");
