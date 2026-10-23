# Three-prong build prompts (product dev)

Written 2026-10-22. The organizer chooses, per funding request: (1) pledge only, (2) collect and hold via Stripe Connect Custom, (3) marketplace bid with vendors on Connect Standard. Prompts 0 to 5 below are separate hand-offs. Specs and Done-when criteria live in the Notion Deliverables database (five pages, linked from Trello Backlog cards); the partner API review is in `partner-booking-api-review.md`.

Gates before production: Stripe review of the restricted-category model, lawyer answers (register sections D to F), and the one-sided fee rule. Flags stay off until then.

**Launch scope amendment (added 2026-10-22):** production will show all three collection-mode options, but only prong 1 (pledge-only) ships live at launch, and without API bookings. Full amendment: `launch-scope-build-prompt.md` (delivered to the founder), with matching entries in `claude/build-log.md` and `claude/open-questions-register.md` §G. It supersedes Prompt 0 §3's "a disabled mode is never shown" rule and narrows Prompt 1 §5/§6's booking-route scope — read it alongside Prompt 0 and Prompt 1 below before building either.

# Prompt 0: Collection mode foundation and organizer choice

Status: draft for product dev, 2026-10-22. Build this first; prompts 1 to 4 depend on it.

## Read first
- `AGENTS.md` and the relevant guides in `node_modules/next/dist/docs/` before writing routes or server actions (this Next.js has breaking changes).
- Existing money model: `supabase/migrations/20260909000000_funding.sql`, `20260929000000_stripe_mandates.sql`, `20261010010000_collect_before_booking.sql`, `20261011000000_payments_tracker.sql`, `lib/stripe/*`, `lib/notifications.ts`.

## Context
Catoco stays a facilitator and technology provider. It is not a merchant of record and not a financial institution. The organizer chooses, per funding request, how the group's money is handled. Three modes exist (the third is built in prompt 3):

| Mode | `collection_mode` | Who touches money | Catoco revenue |
|---|---|---|---|
| Pledge only | `peer_pledge` | Friends pay the organizer directly (QR, payment link, bank transfer). No processor. | Affiliate/booking kickback only |
| Collect and hold | `catoco_psp` | Stripe Connect Custom account for the organizer; Stripe processes cards/iDEAL | Fee plus affiliate referral |
| Marketplace bid | `vendor_direct` | Group pays vendor's own Stripe Standard account (direct charge) | Fee on the hold, no kickback |

## Build
1. **Migration.** Add `collection_mode text not null default 'peer_pledge' check (collection_mode in ('peer_pledge','catoco_psp','vendor_direct'))` on `funding_requests`. Add `contribution_status` mapping so every mode reports into the existing payments tracker statuses (`committed`, `failed`, `funded`, `ignored`). Document the mapping in a comment in the migration. Revoke public execute on any new function (see `20261013000000_revoke_public_execute.sql`).
2. **Organizer choice UI.** When the organizer opens funding for an element or group of elements, show two cards (a third appears when prompt 3 ships): "Collect it yourself" (pledge, no fees from Catoco, default) and "Let Catoco collect and hold" (card/iDEAL, fee shown up front). Show what each costs and what each risks in plain words. Choice is stored per funding request and locked once any contribution exists.
3. **Feature flags.** `COLLECTION_MODE_PLEDGE_ENABLED` (on), `COLLECTION_MODE_PSP_ENABLED` (off in production until Stripe review and lawyer answers are recorded in the open questions register, sections D to F), `COLLECTION_MODE_VENDOR_ENABLED` (off). A disabled mode is never shown. **Amended 2026-10-22 — see `launch-scope-build-prompt.md`: this "never shown" rule is superseded. All three modes render in production; only the enabled one is selectable.**
4. **Fee rule.** One-sided rule: a Catoco fee is only offered in a mode where Catoco receives no supplier income on that booking route. Encode as a function `feeAllowed(mode, bookingRoute)` with a unit test; the rule is provisional pending the lawyer.
5. **Localization.** Every new string in EN and NL, no hardcoded copy. No machine-translated legal text; mark legal strings `needs_review`.
6. **Analytics.** PostHog events `collection_mode_viewed`, `collection_mode_selected` (property `mode`), no personal data.

## Done when
- Existing funding flows behave exactly as before for `catoco_psp` (set existing rows to that value in the migration).
- New funding requests default to `peer_pledge` and the organizer can switch before the first contribution.
- Disabled modes cannot be selected through the UI or a direct API call (server-side check).
- Typecheck, lint, existing tests and new tests pass; EN and NL strings complete.

## Do not
- Touch live Stripe keys or enable any flag in production.
- Email real suppliers or members from staging (allowlist guard stays).
- Decide Stripe or Issuing questions yourself: ask Matt.


---

# Prompt 1: Prong 1, pledge-only mode (no processor)

Status: draft for product dev, 2026-10-22. Depends on prompt 0.

## Read first
`AGENTS.md` and the Next.js docs in `node_modules/next/dist/docs/`; `lib/notifications.ts`, `lib/email.ts`, `lib/inbound-email.ts`, `lib/booking-extract.ts`, funding migrations listed in prompt 0.

## Concept
Members pledge conditionally to the group. The organizer collects the money outside Catoco, by QR code, payment link or bank transfer. Catoco never holds, routes or processes funds. Catoco records pledges and payments, nudges, gates the Book button, and sends the member or organizer to the supplier through an affiliate link or booking API. Revenue is affiliate or booking kickback only.

## Build
1. **Pledge terms.** Before a member commits, show the terms: share amount, a cap (for example the share can rise by at most X%), pay window length, what happens on dropout or shortfall (use existing rule B9), and that the money goes to the organizer, not Catoco. Store an accepted-terms record (version, timestamp, amount, cap). This is the conditional contract.
2. **Organizer payment details.** Organizer sets one or more payout methods: IBAN with name, a payment link (Tikkie, PayPal.me, Revolut, Wise, Venmo and similar), and an optional QR image upload. Validate IBAN format. Show the member a payment request with: amount, a short reference code unique to the member and funding request, and QR or link. EPC/SEPA QR for IBAN where the amount and reference are prefilled.
3. **Payment confirmation.** Organizer marks each member's payment as received (single tap, bulk tick). Optional member self-report "I have paid" that shows as pending until the organizer confirms. Statuses map to the unified contribution status from prompt 0. Open banking auto-confirmation is future work; keep a clean interface (`confirmPayment(source)`).
4. **Pay window.** After the group commits, a pay window opens (default 48 hours, organizer can set 24 to 72). Reminders go out at the middle and near the end, using existing notification kinds where they fit (`funding_needed`, `funding_deadline_set`, `nudge`). New kinds need Matt's approval, see prompt 4 for the email policy.
5. **Book gate.** The Book button unlocks when confirmed pledges plus organizer top-up cover the total, or the organizer explicitly proceeds with a shortfall (they cover it and accept the risk, recorded). Recheck price and availability at that moment (price drift). Show the booking route tier in use: API with payer card component; affiliate link plus forwarded confirmation; supplier bid; proposed link.
6. **Affiliate and booking links.** Every outbound booking link carries a sub-ID: `<funding_request_id>.<element_id>` so commission can be matched back. Log click events. **Amended 2026-10-22 — see `launch-scope-build-prompt.md`: no `api_booking` route at launch; Prompt 5 is deferred in full for this launch.**
7. **Confirmation loop.** The organizer forwards the supplier confirmation to the element's `booking-<token>@<domain>` address (exists already). Mark the element booked when the inbound email parses. Do not use AI services on email content without a founder and legal decision (rule in `lib/booking-extract.ts`).
8. **Shortfall and dropout.** If the pay window ends with a gap, recalculate shares among the remaining committed members (existing `shares_recalculated` flow) or let the organizer cover or cancel. Never auto-charge anyone.

## Done when
- A staging group can pledge, see QR or link, pay outside the app, have the organizer confirm, and unlock Book, with all statuses visible in the payments tracker.
- Sub-IDs appear on every outbound link and clicks are logged.
- Reminders respect the existing email policy and the staging allowlist.
- EN and NL strings complete; tests cover gate logic, share cap and IBAN validation.

## Do not
- Hold or move money, or label Catoco as a payment provider anywhere in copy.
- Add automatic bank connections in this prompt.


---

# Prompt 2: Prong 2, collect and hold with Stripe Connect Custom (organizer)

Status: draft for product dev, 2026-10-22. Depends on prompt 0. Ships behind `COLLECTION_MODE_PSP_ENABLED`, off in production until Stripe confirms eligibility and the lawyer answers are logged.

## Read first
`AGENTS.md` and Next.js docs in `node_modules/next/dist/docs/`; `lib/stripe/{server,mandates,charges,fees}.ts`; `20260929000000_stripe_mandates.sql`; Stripe Connect docs for Custom accounts, embedded onboarding and payouts (verify current API versions on stripe.com, do not rely on memory).

## Ask Matt before deciding
1. Custom vs Standard for organizers: Custom means Catoco is responsible for requirements collection, negative balances and per-account and payout fees. Matt chose Custom because Catoco then controls payout timing. Confirm the fee schedule with Stripe sales before building payouts.
2. The 1-cent verification charge idea is an assumption (to start payout timing). Verify with Stripe whether it helps, and that the minimum charge is acceptable. Do not ship it unverified.
3. Stripe may refuse this model (restricted categories, peer-to-peer). Build to the flag, expect a possible no.

## Concept
When the organizer picks "Let Catoco collect and hold", create a Connect Custom account for them, only then. Members pay by card or iDEAL through the existing mandate and authorize flow. Funds settle to the organizer's connected account, never to Catoco's balance except the fee. Payout to the organizer's bank is released by Catoco when the group's funding conditions are met. Catoco takes a fee plus any affiliate referral on the booking.

## Build
1. **Account creation.** `accounts.create` type `custom`, country NL by default, capabilities `card_payments` and `transfers`, business type individual, `tos_acceptance` handled through hosted or embedded onboarding (host it to avoid extra cost). Create the account only when the organizer selects this mode. Store `stripe_account_id` on a new `organizer_payment_accounts` table with status fields mirroring `requirements.currently_due`, `charges_enabled`, `payouts_enabled`.
2. **Onboarding.** Collect identity requirements at the time they are needed. Bank account only at the funding stage, just before first payout. Show a progress state and what is blocking. Handle `account.updated` webhooks idempotently.
3. **Payment flow.** Keep the existing SetupIntent mandate and conditional charge logic. Use destination or direct charges per Stripe's guidance for Custom; keep funds off the Catoco balance. Record `application_fee_amount` for the Catoco fee. Fee is shown to members before they commit.
4. **Payout control.** Set payout schedule to manual. Release a payout only when the funding request reaches `funded`. Surface expected arrival dates (first payout for a new account can take about 7 business days; flag this in the UI because it affects booking timing).
5. **Losses and disputes.** Catoco is liable for negative balances and disputes on Custom accounts. Add dispute webhooks and an internal alert. Define a reserve or hold policy as a question for Matt; do not invent one.
6. **Failure paths.** Charge failure, mandate cancellation, KYC failure, and organizer abandoning onboarding all return the group to a clear state, with notifications through existing kinds (`payment_retry_needed`).
7. **Flag and audit.** Every server action checks the flag. Add an admin view listing organizer accounts and their states.

## Done when
- In Stripe test mode, an organizer can choose this mode, complete onboarding, members pay, funds appear on the connected account, a manual payout is released on `funded`, and failures are handled.
- No funds land on the Catoco balance other than fees (assert in a test using Stripe test clocks or fixtures).
- Flag off means the mode is unreachable.
- EN and NL strings complete; staging never emails real people.

## Do not
- Use live keys, enable in production, or promise payout timings in copy beyond what Stripe documents.
- Introduce Stripe Issuing or Treasury without asking Matt.


---

# Prompt 3: Prong 3, reverse marketplace with vendors on Stripe Connect Standard

Status: draft for product dev, 2026-10-22. Depends on prompt 0. Start with the no-money demo (steps 1 to 4); steps 5 to 7 sit behind `COLLECTION_MODE_VENDOR_ENABLED`.

**Sequence amendment (added 2026-10-23, Matt):** this prompt's demo build (step 1 below) does not start first. Matt's build order for the supplier side is: (1) `/for-suppliers`, the early-list intake page — standalone prompt `claude/for-suppliers-page-prompt.md`, build this first; (2) only then this prompt's no-money demo spec (`bid-marketplace-demo-spec.md`); (3) only then link `/for-suppliers` from wherever outreach needs it. Outreach emails and supplier-selection criteria are explicitly out of scope for both prompts and come later, as their own task. Do not start step 1 below until the `/for-suppliers` page has shipped.

**Two separate supplier tables, not to be conflated:** `/for-suppliers` writes to `supplier_interest` (unverified early-list signups from outreach — name, contact, city, what they offer; see `claude/for-suppliers-page-prompt.md`). This prompt's step 2 builds a different table, `suppliers` (the verified directory this demo and the real marketplace actually use, admin-only, Matt-added, with a verification step before any supplier can receive money). Promoting a `supplier_interest` row into a real `suppliers` row is a manual decision Matt makes later, once outreach has run — there is no automatic link between the two tables, and this prompt does not build one.

## Read first
`AGENTS.md` and Next.js docs in `node_modules/next/dist/docs/`; the project doc `bid-marketplace-demo-spec.md` (request emails, reply parsing, web form, tables `suppliers`, `bid_requests`, `bid_request_recipients`, `bid_offers`, option source `supplier_bid`); `claude/for-suppliers-page-prompt.md` (the separate, earlier-sequenced intake page and its `supplier_interest` table); `lib/inbound-email.ts`; Stripe Connect Standard and direct charges docs (verify current behavior on stripe.com).

## Concept
The group posts a request for an element subtype (for example a hotel for 8 people, Amsterdam, 3 nights). Catoco emails relevant vendors. Vendors reply with an offer. The group votes. Only after a vendor wins is the vendor asked to onboard as a Stripe Standard connected account and accept payment directly. Catoco takes a fee on the hold and takes no kickback from the vendor, so it stays on the buyer's side. The vendor benchmark is the public or API price: offers must beat it to be shown as "better than market".

## Build
1. **Build the demo spec** as written (suppliers, bid requests, recipients, offers, deterministic reply parsing, token web form `/offer/<token>`, pending-offer review, add as option with `source = supplier_bid`). Resolve its open questions with Matt first (LLM parsing rule, fee wording, who reviews, domain config). Per the sequence amendment above, this step starts only after `/for-suppliers` has shipped.
2. **Supplier directory.** Supplier categories by element subtype, city, contact email, verified status. Admin-only management. Only Matt adds suppliers for now. Verification step before any supplier can receive money. This is the `suppliers` table, distinct from `supplier_interest` — see the sequence amendment above.
3. **Benchmark.** For each request, fetch the API/market price through existing `lib/vendor-search/*` when available and store it with the request. Mark offers at or below it.
4. **Award.** Organizer accepts an offer, the award email goes to the vendor. No money moves yet.
5. **Vendor onboarding.** On award, send the vendor a Connect Standard onboarding link (Stripe-hosted). Store `stripe_account_id` on `suppliers`. Vendor must finish onboarding before the group is asked to pay.
6. **Group payment.** Direct charges on the vendor's account with manual capture (authorize now, capture when the booking terms are met, authorization windows are limited, about 7 days for cards, so check the offer's validity and the pay window against it). Clone saved payment methods to the connected account for direct charges only after verifying this is supported for the account type; otherwise collect fresh. Catoco fee as a separate charge to the group, not a cut of the vendor's price. No kickback to Catoco.
7. **Failure paths.** Vendor declines, offer expires, authorization expires, group shortfall: each has a defined state and notification.

## Done when
- The demo works end to end on staging with test suppliers (reply by email, by form, and a messy reply routed to review).
- With the flag on in Stripe test mode, an awarded vendor can onboard, the group can authorize, capture happens on confirmation, and the fee posts separately.
- Staging never emails real hotels (test inboxes and allowlist only). EN and NL strings complete.

## Do not
- Add kickback, commission or any supplier income to this mode.
- Send real supplier emails before Matt and the lawyer sign off on wording and the one-sided fee rule.
- Let AI services read supplier replies without the founder and legal decision.
- Start step 1 before `/for-suppliers` (prompt in `claude/for-suppliers-page-prompt.md`) has shipped, per the sequence amendment above.


---

# Prompt 4: Native app notifications

Status: draft for product dev, 2026-10-22. Independent of prompts 1 to 3 except for the payment-related kinds they introduce.

**Built on staging 2026-10-23 (server side):** `push_devices`, `notification_preferences`, `claim_notification()` (migration `20261023070000_push_notifications`); channel rules + quiet hours in `lib/push/channels.ts`; provider interface in `lib/push/provider.ts` (no real provider until APNs/Firebase keys and the app shell exist; `PUSH_PROVIDER=log` for testing); `/api/push/devices` (register/unregister); per-kind settings on Profile, shown only once a device is registered. The three pledge kinds are in the schema but held (`PENDING_APPROVAL_KINDS`) until Matt approves; the marketplace kinds wait for prompt 3. `push_sent` is not sent to PostHog (server side would bypass the consent gate); `notification_log.channels` records it instead.

## Read first
`AGENTS.md` and Next.js docs in `node_modules/next/dist/docs/`; `lib/notifications.ts` (kinds: invited, funding_ready, vote_needed, funding_needed, funding_deadline_set, payment_retry_needed, nudge, shares_recalculated, price_drift; `sendCoreLoopEmail`, `prepare_notification` RPC); `lib/email.ts`.

## Context
The product is going into a native app. The app wrapper is leaning Capacitor (push, camera for KYC). Confirm the wrapper decision with Matt before choosing the push provider. Existing email follows a four-trigger policy: keep it. Push is an additional channel for the same events, not a reason to send more.

## Build
1. **Device registration.** Table `push_devices` (user id, platform, token, app version, locale, created, last seen, revoked). Register after the user grants permission, with a pre-prompt explaining why. Remove on logout and on provider invalid-token responses.
2. **Channel preferences.** Per user and per kind: push, email, both, off. Defaults: same events as email, one channel per event to avoid duplicates (push if a device is registered and recent, else email). Critical payment kinds (`payment_retry_needed`, `funding_needed`) send both.
3. **Dispatch.** Reuse `prepare_notification` for eligibility and dedupe. Add `sendPush(kind, user, payload)` behind an interface so FCM and APNs (or the Capacitor plugin's server side) can be swapped. Payload carries a deep link (`/trips/<id>/elements/<id>`), never personal or payment amounts in the lock-screen text beyond a generic line.
4. **New kinds for prongs 1 to 3** (need Matt's approval before sending anything): `pledge_payment_requested`, `pledge_payment_confirmed`, `pay_window_closing`, `offer_received`, `vendor_award_needed`. Each has an EN and NL string, a deep link, and a quiet-hours rule.
5. **Quiet hours and locale.** Respect the user's locale and a default quiet window (22:00 to 08:00 local) except critical kinds near a deadline.
6. **Staging.** Push goes only to allowlisted test devices. Nothing real from staging.
7. **Analytics.** PostHog `push_permission_prompted/granted/denied`, `push_sent`, `push_opened` (kind only, no message text).

## Done when
- A test device can register, receive each existing kind with a working deep link, opt out per kind, and never receives the same event on two channels except the critical kinds.
- Invalid tokens are pruned. EN and NL strings complete. Tests cover channel selection and dedupe.

## Do not
- Send marketing pushes or any kind not on the approved list.
- Put amounts, names of other members or booking details in the notification text.


---

# Prompt 5: Partner booking integrations

Status: draft for product dev, 2026-10-22. Depends on prompts 0 and 1. Source of truth for what is available: `partner-booking-api-review.md` (project doc). Most of the work here is applications and provider questions by Matt; engineering covers what is already open. **Deferred in full for the initial launch — see `launch-scope-build-prompt.md`, added 2026-10-22: Prompt 1 ships at launch with `affiliate_link`/`proposed_link` routes only, no `api_booking`. Do not start this prompt until that launch has shipped and Matt says to resume it.**

## Read first
`AGENTS.md` and Next.js docs in `node_modules/next/dist/docs/`; `lib/vendor-search/*` (duffel, hotelbeds, liteapi, viator, mock, dispatch); `lib/booking-extract.ts`; the review doc.

## Build (in this order)
1. **Booking route tiers.** Add a `booking_route` field on element options: `api_booking`, `affiliate_link`, `supplier_bid`, `proposed_link`. The UI shows the tier and what it implies (who pays whom, who sends the confirmation).
2. **Duffel flights (api_booking, payer card).** Search and offer already exist. Add order creation in test mode with the traveler's own card (card-payments approval needed from Duffel support; ask Matt to request it). Support hold orders where `requires_instant_payment` is false: store `payment_required_by`, warn before it expires, never auto-pay. Handle `order.airline_initiated_change_detected` and `order.updated` webhooks into notifications. One payer per order: show that in the UI.
3. **LiteAPI hotels (api_booking).** Use prebook then book with the payment SDK so the payer pays by card; set `margin` to zero unless Matt decides otherwise. Confirm payment-SDK merchant-of-record with Nuitee in writing before production.
4. **Affiliate links.** Hotelbeds, RateHawk, Viator (Basic Access), Travelpayouts and Omio widget stay on `affiliate_link`: outbound link with sub-ID `<funding_request_id>.<element_id>`, click log, forwarded-confirmation loop (prompt 1).
5. **Provider adapters stay behind the existing dispatch interface.** Hotelbeds production needs certification (a test booking at least 6 months ahead, cancelled promptly): do not run it without Matt.
6. **Provider question tracker.** A small admin table `provider_questions` (provider, question, asked on, answered on, answer, source). Seed it from the six standard questions and the per-provider questions in the review doc.
7. **No new vendor integration without the review.** Anything marked "not read" or "not found" in the review is not buildable until Matt has answers.

## Matt's actions (not engineering)
- Request Duffel card-payment approval; ask the multi-payer and pre-revenue questions.
- Apply for Viator Full + Booking and ask for criteria and timeline.
- Send the standard questions to LiteAPI, Hotelbeds, RateHawk, Expedia, Booking.com, Agoda.
- Enquire at Trainline, Distribusion, Flix, TheFork, OpenTable.

## Done when
- Each option shows its booking route tier.
- Duffel test-mode order and hold flows work with webhook handling.
- LiteAPI test-mode prebook and book work through the payment SDK.
- Sub-IDs and click logs on every affiliate link; question tracker seeded.
- EN and NL strings complete; staging never emails or books real suppliers.

## Do not
- Have Catoco pay a supplier with money it collected (not part of prong 1, where the organizer pays with their own card).
- Run certification test bookings, use live keys, or sign terms without Matt.
