# Cataco — Brand Toolkit

Single source of truth for Cataco's visual identity — colors, type, logo usage, voice, and the design rules behind the homepage — so anyone (or Canva, or a future deck) can build on-brand without re-deriving the decisions each time.

Canonical reference implementation: the homepage HTML (`cataco-homepage.html`). When in doubt about how a rule looks in practice, that file is the source of truth over this page.

---

## Brand direction

Cataco sits at a deliberate midpoint between two references used to calibrate it: **KLM** (institutional trust — restraint, whitespace, one confident color, clarity) as the base for anything money- or commitment-adjacent, and **Mikkeller**-style playfulness (dialed down from full craft-beer irreverence to "warm and a little cheeky") for the parts of the product that are genuinely social and low-stakes. The closer practical calibration point is **Monzo / Wise** — brands that carry real financial trust *and* real personality at the same time, because the personality lives in tone and specific moments, not in undermining clarity where money is involved.

**Rule of thumb:** the closer a screen or piece of content is to money changing hands (escrow, payments, the trip-lock moment), the more it should lean KLM-restrained. The closer it is to planning, voting, and social coordination, the more room there is for warmth and personality.

---

## Color palette

All hex values sourced directly from the logo SVG or extended from it — nothing here is arbitrary.

| Name | Hex | Use for | Notes |
|---|---|---|---|
| Ink | `#0D2020` | Primary text, dark section backgrounds, logo line art | Warm near-black, not true black — pulled straight from the logo |
| Paper | `#FAFAF7` | Primary background | Same warm off-white already used in the product wireframes — keeps marketing and product feeling like one company |
| Teal (primary) | `#2DD4BF` | Brand color, primary CTAs, logo fill | Sits in the same family as Wise/Robinhood-style fintech brand color — reinforces the trust register |
| Teal Deep | `#0F8C7E` | Hover states, links, secondary emphasis text | Use for anything interactive that needs more contrast than the primary teal on light backgrounds |
| Teal Wash | `#E4F8F5` | Soft section backgrounds, pill/badge fills | Never use as a text color — background only |
| Amber | `#F2A63C` | Sparse warm accent — notes, callouts, the one "spark" moment | Deliberately rare. If amber shows up more than once or twice on a page, pull it back |
| Line | `#DEDCD1` | Borders, dividers, dashed-outline strokes | Warm gray-beige, not a cold gray — keeps borders feeling like part of the paper, not a UI kit default |

> ⚠️ **Avoid on sight:** warm cream + high-contrast serif + terracotta/clay (`#D97757`-ish) is the single most common "AI-generated" tell in 2026 design work. It's close to tempting given our warm palette — don't drift there. Teal is the anchor, not terracotta.

---

## Typography

| Role | Typeface | Weight | Use for |
|---|---|---|---|
| Display | Bricolage Grotesque | 600–700 | Headlines, taglines, brand moments. A sans with flared, characterful letterforms at large sizes — carries the "warm but not corny" personality without going full editorial serif (the other AI-tell we're avoiding) |
| Body / UI | Inter | 400–600 | Body copy, product UI, forms. Already the font used throughout the Figma wireframes — kept for continuity |

Both are free on Google Fonts. Load via `@import` or `<link>` — see the homepage HTML `<head>` for the exact embed.

---

## The signature device: dashed vs. solid

This is the one deliberate, ownable visual idea everything else should stay quiet around. It comes directly from the logo's dashed inner ring, and it maps onto the product's actual mechanic — so it's not decoration, it's information.

> ◇ **Dashed outline = open, still being decided.**
> **Solid fill = locked in by the group.**
>
> Use this consistently anywhere the product shows an "element" (a trip attribute) or an option that's still being voted on vs. one that's been chosen. It's used on the homepage in the hero tile preview and the elements grid section.

Don't invent a second visual system for the same concept elsewhere (no separate progress bars, checkmarks, etc. for the same open/locked idea) — one language, used everywhere it applies.

---

## Logo

**Current mark ("Element Tile"), finalized Aug 2026:** a dashed rounded square (the open trip) holding one solid rotated diamond (the locked choice) — the actual in-product tile pattern, used as the mark itself. Replaces the earlier map-pin logo, which read "location" but not "group" or "convergence."

Files: `cataco-mark.svg` (teal, light contexts) · `cataco-mark-dark.svg` (ink, dark contexts) · `cataco-mark-mono.svg` (single-color, transparent, for arbitrary backgrounds/merch/print) · `cataco-wordmark.svg` (horizontal lockup with wordmark) · plus PNG exports at 512px (app icon) and 32px/16px (favicon).

- **Why this one, of the five explored:** it's the only concept of the three finalists that stays legible all the way down to a 16–20px favicon — the others (radiating-node and overlapping-circle concepts) blur into noise at that size. A logo has to work as a tiny browser-tab icon as often as it works as a big hero mark.
- Minimum clear space: leave space equal to the diamond's width on all sides.
- Never recolor outside the two brand colors (or the single mono color for one-color use).
- Works on paper, ink, or teal-wash backgrounds. Avoid busy photography behind it.
- The dashed-square-to-solid-diamond relationship *is* the "dashed vs. solid" signature device described above, expressed as the logo itself — the two are now the same idea, not just thematically related.

---

## Voice & copy bank

Plain, active, human. No "unlock," no arrow-suffixed links ("Learn more →"), no all-caps eyebrow labels, no corporate SaaS-speak. Say what happens, not what it enables.

**Lines already in use** (don't duplicate a line in more than one place on the same surface):

| Line | Where it's used |
|---|---|
| "From 'we should go' to 'we went.'" | Homepage hero headline |
| "...has nowhere to turn into 'it's booked.'" | Homepage problem section |
| "From intent to itinerary" | Homepage how-it-works headline (the original deck tagline — reserved for this one placement) |
| "No chasing. No heroes. No awkwardness." | Homepage how-it-works subhead |
| "Coordination is where you start. Commitment is where you end." | Homepage pull-quote section |

**Available for future use** (from the original pitch deck, not yet deployed):
- "Not a planner, a booking engine, or a payment pool."
- "A system to go from 'we should do this' to 'it's booked.'"

> 📊 **Reframe note from the alpha survey** (130 responses, Aug 2026): 87% of group trips in the dataset actually happened — only ~4% fell apart outright. The sharper, more defensible claim isn't "trips die," it's that **45% of people have delayed committing to a group trip out of fear of being financially responsible if others drop out**, and a third of trips that do happen carry real friction along the way. Worth softening "trips die in chats" language before it reaches a real audience — see the alpha discovery script for the full data.

**Deliberately not using:** the chemistry/"catalyst" metaphor language from the original deck (accelerants, activation energy, etc.) — that was written for the product's old name (Catalyst) before the rename to Cataco, so it's retired unless a specific reason comes up to revive it.

---

## Building decks & marketing materials

For anyone (or Canva) building a slide deck, social post, or other collateral:

- **Background:** paper (`#FAFAF7`) by default. Ink (`#0D2020`) for a contrast/divider section — don't use both on the same slide/panel.
- **Headers:** Bricolage Grotesque, sentence case. Never all-caps, never a tracked-out eyebrow label above the headline.
- **Accent color:** teal does the work. Amber is a rare spark, not a secondary brand color — if a deck has amber on more than one slide, that's too much.
- **Iconography:** if showing trip elements/categories, use the tile pattern (dashed outline = open, solid fill = locked) rather than generic icon sets or stock imagery.
- **What to avoid:** the old deck's chrome/metallic/navy "enterprise pitch deck" look — that's retired along with the old name. Also avoid: uniform rounded SaaS-card kits with identical drop shadows on everything, and centered-hero-with-gradient as a default layout — vary it per piece.

Once a Canva Brand Kit exists for this workspace, build it from this page directly so `generate-design` calls can reference it via `brand_kit_id`.
