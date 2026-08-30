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
```

- `NEXT_PUBLIC_SUPABASE_URL` — Supabase → Project Settings → API → Project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase → Project Settings → API → Project API keys →
  the **publishable** key (`sb_publishable_…`). Safe to expose to the browser.

The same two variables must also be set in **Vercel** (see §7).

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

Verify afterwards: `profiles` and `trips` exist, and completing a sign-in creates
a matching `profiles` row automatically.

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
| `/trips` | "My Trips" — authed empty state. |
| `/trips/[tripId]` | Stub trip landing (does not query `trips` — no RLS policy yet). |
| `/trip/[tripId]/join` | Invite entry point, redirect-only. |
| `proxy.ts` | Refreshes the Supabase session cookie on every request. |

`invited_via_trip_id` is set exactly once, at account creation, by the
`handle_new_user` trigger reading `raw_user_meta_data`. Re-invites never change it.

## 10. Gotchas hit during setup

- **Next.js 16:** `middleware.ts` is renamed to `proxy.ts` (`export function proxy`).
- New Supabase projects don't auto-grant table privileges — see §4 option B step 2.
- Corporate/Workspace email link scanners pre-open magic links and consume the
  single-use token. Use a non-scanned inbox for testing, or click immediately.
- `next dev` rewrites the agent block in `AGENTS.md` / `CLAUDE.md`; commit it with
  your work to keep the tree clean.
