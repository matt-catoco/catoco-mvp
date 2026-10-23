# App readiness build prompts (iOS and Android)

Draft 2026-10-23. Five prompts (A to E; E is Android and Google Play specifics) for product dev, plus Matt's own actions. Grounded in the repo as of 2026-10-23 (since then: Next.js is on 16.4.2).

**Status (2026-10-23):** Prompt A built on staging (commit 7bd8778): `app/manifest.ts`, icons from `scripts/generate-app-icons.mjs`, viewport-fit cover and safe areas, `public/offline.html` (also `/offline`) and a minimal `public/sw.js`. B to E not started; B waits for the app id and Capacitor confirmation; iOS builds need a Mac. Push server side is Prompt 4 in `claude/three-prong-build-prompts.md`.

Launch scope stands (production shows all three routes, only prong 1 live, no API booking); these prompts do not change it.

## Decisions this plan assumes (Matt to confirm or change)
1. **Wrapper: Capacitor**, as the register leans. PWABuilder cannot give the native shell, push and camera access that the stores' review expects.
2. **The app loads the live site** (`server.url` pointing at the production site), not a static export. The product needs a server (auth, server actions, webhooks), so static export is not an option. Consequence: Apple will read this as a wrapped website unless native features are real (Guideline 4.2), so prompt C is part of passing review, not decoration.
3. **Auth stays email magic link**, plus a code option inside the app (see prompt B). No social login, so Sign in with Apple is not required (Guideline 4.8, verify current text).
4. **No in-app purchase.** Trip money pays for real-world travel services consumed outside the app (Guideline 3.1.3(e), verify). Catoco's own fee is the grey area: confirm with the lawyer or Apple's guideline text before store submission whether a fee on a real-world service needs IAP. Do not build IAP.
5. **Two app identities:** a staging app (`co.catoco.app.staging`, points at the staging site) and the production app (`co.catoco.app`). Bundle and package ids are Matt's call; confirm before enrolling.

## Order
A (web baseline) first, then B (shell), then C (native features, with prompt 4's server side for push), then D (store compliance). A and D's in-app deletion can start in parallel.

---

# Prompt A: Web baseline for an installable app

Read `AGENTS.md` and the Next.js docs in `node_modules/next/dist/docs/` first (this Next.js has breaking changes; metadata, manifest and viewport conventions may differ from what you know).

## Build
1. `app/manifest.ts`: name Catoco, short name Catoco, `display: standalone`, `start_url: /`, `theme_color #0D2020`, `background_color #FAFAF7` (from `app/page.module.css` tokens), icons 192, 512 and a 512 maskable with safe-zone padding. Source art: `public/brand/catoco-icon-512.png`. The maskable variant needs actual image work; do not just copy the file.
2. `app/icon.png` (real convention name), `public/icon-192.png`. Resolve `app/icon1.png` and `app/icon2.png`: rename if they are the right art, otherwise delete, and tell me which.
3. `app/layout.tsx`: `manifest`, `icons`, `appleWebApp { capable: true, statusBarStyle: "default", title: "Catoco" }`, and a `viewport` export with `themeColor` and `viewportFit: "cover"`.
4. **Safe areas.** Add `env(safe-area-inset-*)` padding to the top bar, bottom bars and any fixed buttons so nothing sits under a notch or the home indicator. Fix 100vh usage with `dvh`.
5. **App-like behaviour.** Disable text-size auto-adjust and rubber-band overscroll on the document where it feels broken; ensure tap targets are at least 44 px; no hover-only controls on touch.
6. **Offline page.** A branded static offline page shown when the network is down (`app/offline`), no service worker caching of authenticated pages. A minimal service worker is allowed only to serve this page; no push in this prompt.
7. Do not change routes, auth or payments.

## Done when
- Chrome DevTools shows a valid manifest, no errors, and an install affordance; an Android phone installs it as a standalone icon, not a bookmark; iOS Add to Home Screen still works and shows the right icon and title.
- Every fixed element clears the notch and home indicator on an iPhone with a notch (simulator is fine).
- Offline page renders with the network off.
- Typecheck, lint, tests pass.

---

# Prompt B: Capacitor shell for iOS and Android

Read `AGENTS.md`, the Next.js docs, and Capacitor's current docs (verify versions on capacitorjs.com; do not rely on memory). Depends on prompt A. Do not enable anything in production.

## Build
1. **Project.** Add Capacitor with `ios` and `android` platforms in a separate `app-shell/` folder or a repo-level `capacitor.config.ts`, whichever keeps the Next build untouched. Two build flavors: staging (`co.catoco.app.staging`, loads the staging site) and production (`co.catoco.app`, loads production). App id and display name are placeholders until Matt confirms.
2. **Remote content.** `server.url` points at the site; restrict `allowNavigation` to the Catoco domains and Stripe's required domains (Checkout/3-D Secure/iDEAL bank redirects must open and return correctly). External links (suppliers, affiliate links) open in the in-app browser or system browser, never replace the app view.
3. **Auth in the app.** Today sign-in is an emailed single-use link. Build both: (a) universal links (iOS) and app links (Android) so a sign-in or invite link opens in the app, with `apple-app-site-association` and `assetlinks.json` served from the site; (b) a short numeric code option on the sign-in screen so a user on a phone without the link opening in the app can still finish. Magic-link emails must still work on web unchanged. Invite links (`/trip/...`) open straight to the right Trip in the app when installed.
4. **Native navigation.** A persistent native-feeling bottom navigation (Trips, Notifications, Profile) that is not a web hamburger menu, driven by the web routes. No duplication of business logic.
5. **Splash and icons.** Branded native splash and app icons for both platforms from the existing brand art; adaptive icon for Android.
6. **Offline screen.** Native fallback that shows the prompt A offline page when the remote URL fails to load, with a retry button.
7. **Back button and gestures.** Android hardware back and iOS swipe-back navigate within the web history before exiting.
8. **Build and test.** Scripts to build a debug app for each flavor; document how to run on a simulator, an Android emulator, and a real device. No store signing keys in the repo.
9. **Stripe in the web view.** Test card entry, 3-D Secure, and iDEAL end to end inside the shell on both platforms in Stripe test mode; list anything that fails (Apple Pay and Google Pay inside a web view behave differently from Safari and Chrome) and report it, do not work around it silently.

## Done when
- Both flavors build and run; a Trip created on staging web opens in the staging app; a sign-in link and an invite link both open in the app; the code sign-in works.
- Stripe test payments (card with 3-D Secure, iDEAL) complete inside the shell; failures are listed.
- Back, offline and external-link behaviour verified on a real iPhone and a real Android phone.

## Do not
- Add social login, in-app purchase, or any production keys. Do not submit anything to a store.

---

# Prompt C: Native device features (needed for review, and for push)

Read `AGENTS.md`, the Next.js docs and Capacitor's plugin docs. Depends on prompt B. Push delivery logic lives in `claude/three-prong-build-prompts.md` prompt 4 (device table, channel preferences, dispatch); this prompt is the client side and the other features.

## Build
1. **Push registration (client).** Use the Capacitor push-notifications plugin with APNs (iOS) and FCM (Android). Pre-prompt screen explaining why, then the system permission request at a sensible moment (after the user joins or creates their first Trip, not on first launch). Send the token to the endpoint built in prompt 4; refresh on token change; unregister on sign-out. Tapping a notification deep-links to the Trip or element.
2. **Native share.** The "Invite your group" button opens the system share sheet with the invite link (Capacitor Share), falling back to copy link on web.
3. **Photo and camera access** for the organizer's payment QR image in prong 1: choose from the library or take a photo (Capacitor Camera), upload through the existing flow. This and the share sheet are the real device integrations that answer Guideline 4.2.
4. **Haptics and status bar.** Light haptic on Commit and on vote saved; status bar style matching the theme. Keep it small.
5. **Permission strings.** Add clear Info.plist usage descriptions (camera, photo library, notifications) and Android permissions; ask for nothing else (no location, contacts, tracking).
6. **Web fallbacks.** Every feature degrades gracefully in the browser; no feature requires the app.

## Done when
- On a real iPhone and Android phone: push permission flow works, a test push opens the right screen, the share sheet shares an invite link, the QR image can come from the camera or library.
- Only the permissions listed above are requested. EN and NL strings for the pre-prompts. Staging push goes only to allowlisted test devices.

## Do not
- Add location, contacts, ad tracking or analytics SDKs beyond what is already installed.

---

# Prompt D: Store compliance and review readiness

Read `AGENTS.md` and the Next.js docs. Can start in parallel with A. This prompt is code and content only; enrollment and form-filling are Matt's actions below.

## Build
1. **In-app account deletion.** Apple requires deletion to be initiated inside the app (Guideline 5.1.1(v), verify). Add Profile, Delete account: confirmation step, explains what happens to Trips and funding commitments (block deletion while the user has an active commitment or open funding, with a clear message), deletes or anonymizes personal data per the privacy policy, signs out, and sends a confirmation email. Replaces "email support to delete".
2. **Privacy and data inventory.** Produce `docs/data-inventory.md` listing every piece of data the app collects (email, trip content, payment tokens held by Stripe, push token, PostHog analytics, photos the user uploads), why, where it is stored and who it is shared with (Supabase, Stripe, Resend, PostHog, Vercel). This feeds Apple's App Privacy labels and Google's Data Safety form; do not fill those forms.
3. **Privacy policy.** Replace placeholder text with the real text Matt supplies after legal review; add links from the app's settings screen and the sign-in screen. Do not invent legal wording.
4. **Review accommodations.** Apple and Google reviewers cannot receive a magic link easily. Add a review demo account path: a fixed test email with a fixed code that only works in the review environment and only when a server flag is on, with a sample Trip preloaded. Document it for the review notes. Never active in production for real users.
5. **Permissions and age.** Confirm the app asks only for permissions it uses; draft an answer set for age rating and content questionnaires (travel and social planning, no user-generated public content, no gambling).
6. **Payments disclosure.** Add a short "How payments work" line on the funding screen naming Stripe and stating that payments are for travel arranged outside the app (final wording needs legal review).
7. **Support and contact.** Show one support route inside the app (matches the site's contact page).

## Done when
- Account deletion works end to end on staging and blocks correctly when a commitment is open.
- `docs/data-inventory.md` is complete and matches the code (grep the SDKs and API calls to verify, do not rely on memory).
- Review demo account works only with the flag on; nothing about it is reachable in production.

---

# Matt's actions (not engineering)

1. **Enroll as Organization** with the D-U-N-S number: Apple Developer Program (about 99 USD a year, verify) and Google Play Console (Organization, not convertible later). Use legal name, address and registration details exactly as on the KvK extract and the D-U-N-S record; mismatches are the usual cause of delays. Verification can take days to weeks, so start now.
2. **Confirm** app id and display name; wrapper decision (Capacitor); the IAP position on Catoco's fee (lawyer).
3. **Fill** Apple's App Privacy labels and Google's Data Safety form from `docs/data-inventory.md` once prompt D delivers it.
4. **Provide** the final privacy policy and terms, the support email (the site currently shows hello@catoco.co), screenshots, and store descriptions. I can draft those when you want.
5. **Needs from Apple and Google:** push keys (APNs auth key, Firebase project), signing certificates; these live in your accounts, never in the repo.
6. **Dependencies on other work:** Stripe review, lawyer answers and the Nov 3 Stripe KYC are unaffected by the app, but the store listing's payment wording must match what Stripe approved.

## Risks to watch
- **Guideline 4.2** (repackaged website) is the main rejection risk; prompts B and C exist to answer it. Do not submit until native navigation, push, share and camera are real and visible in the review video.
- **Magic-link sign-in** is the other likely friction point for reviewers; prompt D item 4 handles it.
- **Stripe web-view behavior** (Apple Pay, bank redirects) can differ per platform; prompt B item 9 reports instead of hiding it.
- Review times and fees change; verify at enrollment.

---

# Prompt E: Android and Google Play additions

Added 2026-10-23. Everything in prompts A to D applies to Android too. This prompt covers what differs. Verify each Google requirement against the current Play Console and policy pages before acting; they change yearly.

## Build
1. **App links use Google's signing key.** With Play App Signing, Google re-signs the app, so `assetlinks.json` needs the SHA-256 fingerprint of the Play App Signing certificate (from Play Console, App integrity), not only the upload key. Serve fingerprints for debug, upload and Play signing so links work in every build. Staging flavor has its own package name and entry.
2. **Android 13+ notification permission.** Request `POST_NOTIFICATIONS` at runtime through the push plugin, create a notification channel (one per kind group: trip activity, payment reminders), and set the small icon and accent color.
3. **Photo picker, not broad media access.** For the organizer's QR image use the system photo picker or camera intent. Do not declare `READ_MEDIA_IMAGES` or storage permissions; Google restricts them. Manifest should declare only internet, notifications, and camera if the camera plugin needs it.
4. **Build format and targets.** Produce a signed Android App Bundle (`.aab`) with the upload key (kept in Matt's account and CI secrets, never in the repo), `targetSdk` at the level Play currently requires for new apps, and 64-bit. Package name is permanent once published; confirm with Matt before the first upload.
5. **Account deletion web URL.** Besides in-app deletion (prompt D), Play requires a public web page where a user can request account and data deletion. Add `/account-deletion` (no login needed) explaining the steps and offering a request form or mailbox, and link it in the Data safety form.
6. **Data safety inventory.** Extend `docs/data-inventory.md` with Google's categories (data collected, shared, optional, encrypted in transit, deletion available) so Matt can fill the Data safety form from it.
7. **Declarations.** Draft answers for: target audience (adults, not for children), content rating questionnaire, ads (none), app access (review demo account from prompt D, with instructions), and the Financial features declaration. Catoco coordinates group payments through Stripe; answer exactly what is true and flag it to Matt and the lawyer, do not guess.
8. **Testing tracks.** Internal testing first; closed or open testing only if the account type requires it (Organization accounts normally skip the mandatory tester period, verify at enrollment).
9. **Web view behavior.** Test Stripe card, 3-D Secure, iDEAL and Google Pay inside the Android web view, and the hardware back button.

## Done when
- A signed `.aab` for both flavors installs from internal testing on a real Android phone; app links open the app; push arrives and opens the right screen; the QR image is chosen without any storage permission.
- `/account-deletion` is public and linked. Data inventory covers Google's categories. Declaration answers drafted and flagged.

## Do not
- Commit keystores or Play credentials. Do not submit for production review.
