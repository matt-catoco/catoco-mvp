Prompt: `/for-suppliers` early-list page
Draft 2026-10-23. Standalone version of item 4 of the info-pages prompt (`website-stripe-review-copy.md`), pulled out so it can go to product dev on its own.

**Status (2026-10-23):** built on staging (commit 39aa95b); migration `20261023060000_supplier_interest` applied to staging AND production (2026-10-23). Copy final in English: Matt confirmed "You pay Catoco nothing" (no supplier fee or commission in the marketplace mode) "Paid directly by the group" was then removed (the marketplace may collect into Catoco's account as the group's commercial agent; prompt 3). partnerships@catoco.co exists. Open: Dutch text (later), and the code release to production.

Read first
`AGENTS.md` and the Next.js docs in `node_modules/next/dist/docs/` (breaking changes: routes, server actions and metadata conventions may differ from what you know). Copy lives in `content/pages/en.ts`; layout in `app/(info)/layout.tsx`; visibility rule in `components/info/visibility.ts`; email in `lib/email.ts` (`sendEmail`, suppressed outside production unless `EMAIL_SENDING_ENABLED`). Follow the editing guide at the top of `en.ts` (`[[...]]` renders highlighted).

Sequence (Matt, 2026-10-23)

1. Build this page with general details and the submission option. 2. Then build the demo from `bid-marketplace-demo-spec.md`. 3. Then add the link to the page where outreach needs it. Outreach emails and supplier selection criteria are not part of this task and come later.

Context
Catoco is preparing a reverse marketplace where groups ask providers for offers. Nothing of it is built or open. This page is only a place for providers (first targets: Amsterdam hotels, apartments, restaurants, venues) to leave their details after Matt's outreach. It must not promise a live marketplace, fees, or payment mechanics beyond the copy below.

Build

1. Route `/for-suppliers`. No login. Not in the header, footer, sitemap or any internal link. `robots: noindex, nofollow`. Reachable on production (it is for outreach) and on staging. It follows the info-page layout but must NOT show the draft banner on production once the copy is final; until then the same `[[...]]` highlighting applies.
2. Copy (English; Dutch required before outreach, see item 7):
Suppliers: get requests from groups that have already decided. Catoco helps friend groups choose and commit to a trip. Soon, groups will be able to ask providers like you for an offer: dates, number of people, budget, must-haves. You reply with your best price and terms.
   * You pay Catoco nothing. [[Confirm: no commission or fee from suppliers.]]
   * You set the price and terms. Groups compare real offers and choose.
   * If a group accepts, you are paid directly by the group. [[Confirm payment mechanics before publishing this line.]]
   * Catoco works for the group, not for you, so we don't take commission from suppliers. Be among the first. Tell us what you offer and where. [form] [button: Join the early list] We'll only use this to contact you about group requests. See our [privacy policy].
3. Form fields: business name (required), contact name (required), email (required), city (required, default text Amsterdam), what you offer (select: hotel, apartment, restaurant, venue, transport, activity, other; required), typical group size (optional number or range), website (optional URL), note (optional, max 1,000 characters). A consent line with the privacy link; submitting counts as agreeing to be contacted about group requests.
4. Storage. New migration with table `supplier_interest` (id, created_at, business_name, contact_name, email, city, offering, group_size, website, note, status default `new` with a check constraint for `new, contacted, onboarded, declined`, source text, user_agent_hash). RLS enabled with no public policies; writes only through a server action using the service client; revoke public execute on any function (see `supabase/migrations/20261013000000_revoke_public_execute.sql`). Validate and trim all fields server side; reject URLs without http(s); limit lengths.
5. Abuse protection. Honeypot field, rate limit per IP (for example 5 per hour), duplicate email within 24 hours returns the same confirmation without a second row.
6. Notification. After a successful submit, email partnerships@catoco.co with the submitted details through `sendEmail`. Matt confirms the mailbox exists before production; until then read the address from one config constant. No confirmation email to the submitter in this task. Nothing is sent from staging unless the allowlist and `EMAIL_SENDING_ENABLED` allow it.
7. Localization. Put every string in the content catalog in EN and NL (the catalog rule is EN plus NL complete; the first outreach targets Amsterdam providers, so NL matters here). Matt supplies or approves the Dutch text; do not machine-translate it. Keep "Catoco" untranslated per `claude/i18n-glossary.md`.
8. Confirmation state. After submit show a short thank-you ("Thanks, we'll be in touch when group requests open in your area."), no redirect, no account creation.
9. Analytics. PostHog `supplier_interest_viewed` and `supplier_interest_submitted` (no personal data in properties).
10. Founder admin. Matt reads rows in the Supabase dashboard for now; no admin UI in this task.

Done when

* `/for-suppliers` renders signed out on staging and production, is absent from nav, footer and sitemap, and returns `noindex`.
* A valid submission stores one row and notifies partnerships@catoco.co; invalid, honeypot and rate-limited submissions store nothing and show the right message.
* RLS blocks public reads and writes (verify with an anonymous client).
* EN and NL strings complete (NL awaiting Matt's text is flagged, not guessed). Typecheck, lint and tests pass.

Do not

* Mention fees, commission rates, payment mechanics or launch dates beyond the copy above, or describe the marketplace as live.
* Link the page from anywhere, or build the marketplace itself (see prompt 3 in `three-prong-build-prompts.md`).
* Use any AI service on submitted text.
