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

Verify afterwards: `profiles` and `trips` exist, `trips` has the new columns,
`trip_elements` / `element_options` / `element_participants` / `votes` exist, and
completing a sign-in creates a matching `profiles` row automatically.

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

## 9a. Trip creation flow (as of flow #2)

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

## 10. Gotchas hit during setup

- **Next.js 16:** `middleware.ts` is renamed to `proxy.ts` (`export function proxy`).
- New Supabase projects don't auto-grant table privileges — see §4 option B step 2.
- Corporate/Workspace email link scanners pre-open magic links and consume the
  single-use token. Use a non-scanned inbox for testing, or click immediately.
- `next dev` rewrites the agent block in `AGENTS.md` / `CLAUDE.md`; commit it with
  your work to keep the tree clean.
