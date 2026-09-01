# catoco-mvp — Setup

Everything needed to run this project locally or stand it up in a fresh environment.

The **code** (Next.js app + `supabase/migrations/`) is in this repo. The **service
configuration** below (Supabase Auth settings, Resend, Vercel env vars) lives in
those dashboards and is **not** tracked in git — this file is the record of it.

> When this grows to multiple Supabase environments or a larger team, move the
> Auth config into `supabase/config.toml` (Supabase CLI) instead of this checklist.

---

## 1. Prerequisites

- **Node.js** 20 LTS or newer (built with 24.x)
- **npm** 10+
- A **Supabase** project
- A **Resend** account (transactional email)
- A **Vercel** project (hosting)

## 2. Local install

```bash
git clone https://github.com/matt-catoco/catoco-mvp.git
cd catoco-mvp
npm install
```

## 3. Environment variables

Create `.env.local` in the repo root (it is gitignored — never commit it):

```
NEXT_PUBLIC_SUPABASE_URL=https://gxdpphgqdmdjwvnhvgsa.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_xxxxxxxxxxxxxxxxxxxxxxxx
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxx
```

- `NEXT_PUBLIC_SUPABASE_URL` — Supabase → Project Settings → API → Project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase → Project Settings → API → Project API keys →
  the **publishable** key (`sb_publishable_…`). Safe to expose to the browser.
- `RESEND_API_KEY` — Resend → API Keys. Used server-side only (never exposed to
  the browser) for the flow #3 tie/empty-options notification emails — see §6.

The same variables must also be set in **Vercel** (see §7).

## 4. Database

Migrations live in `supabase/migrations/`. Apply them in order.

**Option A — Supabase CLI**

```bash
supabase link --project-ref gxdpphgqdmdjwvnhvgsa
supabase db push
```

**Option B — dashboard**

Supabase → SQL Editor → paste each file's contents and run, oldest first:

1. `20260829120000_profiles_and_auth.sql` — `trips` stub + `profiles` tables, RLS
   policies, and the `handle_new_user` trigger that creates a `profiles` row on
   signup. Run once (the `create policy` lines are not idempotent).
2. `20260829130000_profiles_grants.sql` — `grant select, update on public.profiles
   to authenticated`. Required: new Supabase projects do **not** auto-grant table
   privileges, and RLS policies alone leave the client with
   "permission denied for table profiles".
3. `20260830000000_trip_elements.sql` — promotes the `trips` stub (adds `icon`,
   `organizer_id`, `status`) and adds `trip_elements`, `element_options`,
   `element_participants`, `votes`; organizer-scoped RLS + grants on the first
   three; `create_trip(jsonb)` RPC for atomic trip creation; storage policies for
   the `trip-icons` bucket. Deletes any pre-existing organizer-less `trips` rows
   (flow-1 test data). Run once.
   - If the `storage.objects` policy statements at the end fail with *"must be
     owner of table objects"*, delete those four statements and instead add the
     equivalent policies from **Storage → Policies** on the `trip-icons` bucket:
     public `SELECT`, and `INSERT`/`UPDATE`/`DELETE` for `authenticated` where
     `(storage.foldername(name))[1] = auth.uid()::text`.
4. `20260831000000_option_cost.sql` — `create or replace` of
   `validate_option_value()` to allow an optional numeric `cost` on
   travel / accommodation / experience / dining options. Safe to re-run.
5. `20260831120000_element_schema_updates.sql` through `20260902000000_flow3_batch2.sql`
   — the periodic-table model's dates/budget/participants shape updates,
   collaboration RLS, and voting/auto-lock mechanics. See §9a/§9b (now
   historical — the element model these describe was replaced, §9d).
6. `20260903000000_element_model_redesign.sql` — **destructive**: `delete from
   public.trips` (cascades everything) before reshaping the schema — only
   safe because no real trip data exists yet (confirmed pre-launch). Retires
   `create_trip(jsonb)`, `validate_option_value()`, and the fixed
   Budget/Participants element types; adds `trip_participants`,
   multi-instance elements, `create_element()`, `is_element_member()`,
   `get_trip_roster()`. See §9d for the full picture. Run once.

Verify afterwards: `profiles` and `trips` exist, `trips` has the new columns,
`trip_elements` / `element_options` / `trip_participants` / `element_participants`
/ `votes` exist, `trip_elements.type` no longer allows `budget`/`participants`,
and completing a sign-in creates a matching `profiles` row automatically.

### Storage bucket (for trip icons)

Dashboard → **Storage → New bucket**:
- Name: `trip-icons`
- **Public** bucket: on
- File size limit: `2 MB`
- Allowed MIME types: `image/png, image/jpeg, image/webp, image/svg+xml`

The access policies come from migration 3 (or the Storage → Policies fallback
above). `NEXT_PUBLIC_SUPABASE_URL` is also used to build the public icon URL, and
its host is allowlisted in `next.config.ts` under `images.remotePatterns` — update
that host if the Supabase project ref ever changes.

## 5. Supabase Auth configuration

Dashboard → **Authentication**.

### Providers → Email
- Email provider **enabled**
- **Confirm email** ON (new users confirm by clicking the magic link)
- Password is unused — the app is magic-link (OTP) only

### URL Configuration
- **Site URL:** `https://catoco-mvp.vercel.app`
- **Redirect URLs** (allow-list):
  - `http://localhost:3000/**`
  - `https://catoco-mvp.vercel.app/**`

  Without the localhost entry, local magic links fall back to the Site URL
  (production) instead of hitting `http://localhost:3000/auth/callback`.

### Rate Limits
- Raise **"Rate limit for sending emails"** to ~30–100/hour. The default (paired
  with the built-in email sender) is ~2/hour and is too low even for testing.
  Requires custom SMTP (below) to take effect.

## 6. Email — Resend + custom SMTP

1. **Resend → Domains → Add Domain:** `catoco.co`. Add the DKIM/SPF DNS records
   Resend provides and wait for verification. Until verified, Resend only sends
   from `onboarding@resend.dev` to your own account address.
2. **Resend → API Keys → Create API Key** (permission: Sending access). Copy the
   `re_…` value — shown once.
3. **Supabase → Authentication → SMTP Settings → enable custom SMTP:**

   | Field | Value |
   |---|---|
   | Host | `smtp.resend.com` |
   | Port | `465` |
   | Username | `resend` |
   | Password | your `re_…` API key |
   | Sender email | `noreply@catoco.co` |
   | Sender name | `catoco` |

   Note: the host is `smtp.resend.com` (not "respond") and the port is `465`
   (not `45`).

4. **App-triggered emails (separate from the SMTP above)** — flow #3's tie/
   empty-options notifications call Resend's REST API directly from app code
   (`lib/email.ts`), not through Supabase. Add the same `re_…` API key from
   step 2 (or a new one — either works, both are on the verified `catoco.co`
   domain) as `RESEND_API_KEY` in `.env.local` and in Vercel → Project →
   Settings → Environment Variables. Without it, those two notification
   emails silently no-op (logged as an error, doesn't break the page).

## 7. Vercel

- Import `matt-catoco/catoco-mvp`. Framework auto-detects as Next.js; leave build
  settings default.
- **Settings → Environment Variables:** add the two from §3 for all environments.
- Every push to `main` triggers a deploy. Production: `https://catoco-mvp.vercel.app`.

## 8. Run locally

```bash
npm run dev
```

http://localhost:3000

Other scripts: `npm run build`, `npm start`, `npm run lint`.

## 9. Auth flow (as of the auth ticket)

| Route | Purpose |
|---|---|
| `/sign-in` | Email-only magic-link request. Reads `trip_id` + `next` from query. |
| `/sign-in/check-email` | "Check your email" confirmation. |
| `/auth/callback` | Exchanges the `?code=` for a session; routes to onboarding or `next`. |
| `/onboarding/profile` | Display-name capture, first login only. |
| `/trips` | "My Trips" — lists the caller's trips; entry to the create wizard. |
| `/trips/[tripId]` | Stub trip landing. |
| `/trip/[tripId]/join` | Invite entry point, redirect-only. |
| `proxy.ts` | Refreshes the Supabase session cookie on every request. |

`invited_via_trip_id` is set exactly once, at account creation, by the
`handle_new_user` trigger reading `raw_user_meta_data`. Re-invites never change it.

## 9a. Trip creation flow (as of flow #2) — superseded, see §9d

`/trips/new` is a 5-step client wizard (start → name+icon → macro → micro →
review). Nothing is written until **Create trip**, which calls the `createTrip`
server action → `create_trip(jsonb)` RPC (one transaction).

- Elements are **Skip** (no row), **Lock** (one fixed `element_options` row), or
  **Open** (0+ seeded options, optional voting `deadline`).
- `trip_elements.status` is stamped at creation: locked → `settled`,
  open+options → `add`, open+empty → `null`. Later stages (`vote`, `collecting`,
  …) are future tickets.
- `trips.status` is always `planning` on create — a coarse 3-stage field
  (`planning`/`financing`/`going`), not a rollup.
- Wizard progress is mirrored to `sessionStorage` (`catoco:new-trip-draft:v1`)
  so a refresh doesn't lose it; cleared on successful create.
- `element_options.value` shapes are defined in `lib/trip-elements.ts` and
  re-validated in SQL by `validate_option_value()`.
- `votes` and `element_participants` exist but are inert (no policies, no UI).

## 9b. Collaboration flow (as of flow #3, batches 1–2)

`/trips/[tripId]` is the shared trip page for organizer and participants —
`trips`/`trip_elements`/`element_options` RLS was widened in batch 1 so any
trip member (not just the organizer) can read this data and propose
candidate options on `open` elements before `options_deadline`
(`is_trip_member()` helper, additive RLS policies).

Batch 2 adds actual voting:
- Tap-to-rank up to 3 options per element (`app/trips/[tripId]/voting-section.tsx`
  → `castVotes` → `cast_votes(element_id, option_ids[])` RPC, full
  replace-semantics so editing a ranking is just resubmitting it). Editable
  anytime up to `voting_deadline`.
- Borda scoring (`borda_scores()` SQL function — 1st=3pts/2nd=2pts/3rd=1pt) is
  the single source of truth for the live leaderboard, auto-lock resolution,
  and the runner-up lookup.
- **Auto-lock is lazy, not scheduled** — no cron/pg_cron. `resolve_due_elements()`
  runs on every visit to `/trips/[tripId]`, by anyone, and resolves any `open`
  element whose `voting_deadline` has passed: single option → locks with no
  vote; a clear Borda winner → locks; a tie at the top → stays open, flagged
  once. A trip nobody visits after its deadline stays unresolved until someone
  does — accepted tradeoff, no new infra.
- Tie / zero-options-at-deadline sends the organizer a real email (`lib/email.ts`
  → Resend REST API, needs `RESEND_API_KEY` — see §3/§6) exactly once per
  element (`trip_elements.tie_notified`/`empty_notified` flags), plus an
  in-app banner that persists on the trip page from those same flags.
- `get_runner_up_option(element_id)` exists and is correct (returns the next-
  best Borda score excluding the current `locked_option_id`, null for an
  organizer-locked element) but nothing calls it yet — reserved for flow #4
  when a booked option falls through.
- No UI yet for an organizer to break a tie or rescue a zero-options element —
  detection + notification only, per the ticket.

## 9c. Trip Home dashboard (as of flow #3, batch 3) — superseded, see §9d

`/trips/[tripId]` changed from a flat list of every element inline to a tile
grid — one tile per element type (all 8 from `ALL_TYPES`, including a "Not
started" tile for any type skipped at creation), tap a tile to drill into
`/trips/[tripId]/elements/[elementId]` for that element's full detail
(read-only value if locked, the existing voting/submission UI if open). No
migration — this is app code only, reusing the schema and RLS from batches
1–2 unchanged.

- Shared component: `components/trip-home/` (`ElementTile` + `ElementGrid`),
  used both by the real dashboard and the homepage's `#elements` marketing
  section (`app/page.tsx`, static demo data) — one implementation of the
  dashed-outline/solid-fill device instead of two hand-built copies.
- Tile status vocabulary lives in one place: `describeElementTile()` in
  `lib/trip-elements.ts` — Not started / Collecting ideas (including a
  zero-candidates case, worded "No ideas yet" rather than a 0) / Settled /
  the four Participants-specific labels (`computeParticipantsStatus`,
  unchanged from batch 2), gated on the element actually being locked — an
  organizer can leave Participants "open" (voted on) instead of a fixed
  range, in which case it's treated like any other open element instead.
- The invite-link + opted-in-count card (organizer-only, shipped in the auth
  flow — §9) moved from the flat trip page into the Participants drill-in
  page; nothing about it changed functionally.
- The lazy auto-lock trigger (`resolve_due_elements`, §9b) now fires from
  both the dashboard and the drill-in page (`resolve-elements.ts`, shared),
  since either can be the first page visited after a deadline passes.

## 9d. Element model redesign (as of flow #3, 2026-09-01) — current

Overturns §9a/§9c's fixed-8/organizer-only/trip-wide model. Migration:
`20260903000000_element_model_redesign.sql` (destructive — see §4 item 6).

- **Multi-instance, participant-created elements.** `trip_elements` no longer
  has a `unique (trip_id, type)` constraint — any trip member can add any
  number of instances of a type, any time, via `create_element()` (security
  definer RPC), not just the organizer at creation. `/trips/new` is now a
  bare one-field form (name + optional icon, `app/trips/new/new-trip-form.tsx`)
  — the 5-step wizard and `create_trip()` are retired.
- **Types**: `dates | destination | travel | accommodation | experience |
  dining` — Budget is gone as its own type (folded into the existing
  optional `price` field on cost-bearing option values); Participants is
  gone as an element entirely (see below). `ELEMENT_TYPES` in
  `lib/trip-elements.ts` replaces the old `MACRO_TYPES`/`MICRO_TYPES` split.
- **Flexible metadata, TS-only.** `trip_elements.metadata` is freeform
  `jsonb` — a per-type field list (`ELEMENT_METADATA_FIELDS`, e.g. Dining's
  date + meal type) drives a generic form (`components/element-metadata-fields.tsx`)
  and is validated in TypeScript only. The SQL-side `validate_option_value()`
  mirror and its trigger are dropped entirely — `lib/trip-elements.ts` is now
  the sole validator for `element_options.value` too.
- **Scoped elements, personalized Trip Home.** `element_participants` is
  repurposed: a row now means "in scope for this element" (not the old
  "opted into the trip via a fake Participants element"). A creator picks
  "everyone" or a hand-picked subset of the roster when adding an element
  (`app/trips/[tripId]/add-element-form.tsx`). `is_element_member()`
  replaces trip-wide `is_trip_member()` for element/option/vote RLS, so
  `/trips/[tripId]` (rebuilt as a personalized feed, not one tile per fixed
  type) naturally shows the organizer everything and a regular participant
  only what they're scoped into — no client-side filtering, it's what the
  query returns.
- **Locking permission.** `create_element()` only honors a requested
  `state = 'locked'` when the caller is the organizer, or the scope is
  exactly `{caller}` (their own solo item, e.g. self-booked flights) —
  otherwise it's silently forced to `open` regardless of what was
  requested, so a client can't bypass the rule.
- **Participants is its own surface**, not an element: `trip_participants`
  is the real roster table (`join_trip()` now inserts here, not into a fake
  element), `trips.invites_sent` replaces the old element-level flag, and
  `/trips/[tripId]/participants` (roster + the existing `InviteLink`,
  organizer-only for generating it) replaces the old Participants tile.
  `get_trip_roster()` (security definer) supplies display names for the
  roster page and the add-element scope picker, since `profiles` RLS only
  lets a user read their own row.
- Everything else from §9b (Borda voting, lazy auto-lock, tie/empty
  notification) is unchanged in mechanics — just scoped by element
  membership instead of trip-wide membership.

## 10. Gotchas hit during setup

- **Next.js 16:** `middleware.ts` is renamed to `proxy.ts` (`export function proxy`).
- New Supabase projects don't auto-grant table privileges — see §4 option B step 2.
- Corporate/Workspace email link scanners pre-open magic links and consume the
  single-use token. Use a non-scanned inbox for testing, or click immediately.
- `next dev` rewrites the agent block in `AGENTS.md` / `CLAUDE.md`; commit it with
  your work to keep the tree clean.
