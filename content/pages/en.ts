/**
 * English copy for the public info pages (About, Contact, Help/FAQ, Terms,
 * Privacy, Company, Tutorials) and the homepage showcase.
 *
 * EDITING GUIDE
 * - Everything a visitor reads lives in this one file, so you can edit copy
 *   here without touching any page code.
 * - Anything wrapped in double square brackets, like [[your KVK number]], is a
 *   placeholder. It renders highlighted on the page so it can't be missed.
 *   Replace it with the real text (and remove the brackets) before launch.
 * - Shape is flat and typed so it can move into messages/en.json when the
 *   next-intl scaffold ships. Keep strings free of all-caps (use CSS) and keep
 *   "Catoco", "Catalyst" and "Trip" untranslated (see the i18n glossary).
 */

export type Section = { heading: string; body: string[] };
export type Faq = { q: string; a: string };

import { COMPANY } from "../company";

export const site = {
  name: "Catoco",
  // The one tagline: the home hero, page title and every footer read this (founder, 2026-10-22).
  tagline: "Plan it together. Fund it together. Go.",
  contactEmail: "support@catoco.co",
  nav: [
    { href: "/#how", label: "How it works" },
    { href: "/about", label: "About" },
    { href: "/faq", label: "Help" },
    { href: "/contact", label: "Contact" },
  ],
  linkedin: { href: "https://www.linkedin.com/in/mattsavit/", label: "LinkedIn" },
  footer: {
    product: "Product",
    company: "Company",
    legal: "Legal",
    links: {
      product: [
        { href: "/sample-trip", label: "Try a sample trip" },
        { href: "/faq", label: "Help and FAQ" },
        { href: "/sign-in", label: "Sign in" },
      ],
      company: [
        { href: "/about", label: "About" },
        { href: "/contact", label: "Contact" },
        { href: "https://www.linkedin.com/in/mattsavit/", label: "LinkedIn", external: true },
        { href: "mailto:hello@catoco.co", label: "hello@catoco.co" },
        // Staging only (hidden on catoco.co with the other draft pages).
        { href: "/site-map", label: "Site map" },
      ],
      legal: [
        { href: "/terms", label: "Terms of service" },
        { href: "/privacy", label: "Privacy policy" },
      ],
    },
    rights: "Catoco. All rights reserved.",
  },
  draftBanner:
    "Draft. This page is a first version for review and is not final.",
  legalDraftBanner:
    "Draft pending legal review. Do not publish as final until reviewed.",
};

export const showcase = {
  eyebrow: "See it live",
  title: "This is the real product, not a mockup",
  intro:
    "Four short clips, recorded on a brand-new account with nothing pre-filled. Here is how a group goes from a loose idea to a booked trip.",
  cta: "Watch all four tutorials",
  chapters: [
    {
      id: "organizer",
      number: 1,
      title: "One person sets up the trip",
      blurb:
        "Name the trip, set the dates and add the pieces that need deciding: where to stay, where to eat, how everyone gets there.",
      video: "/videos/chapter1-organizer.mp4",
      poster: "/videos/chapter1-poster.png",
      length: "58 sec",
    },
    {
      id: "participant",
      number: 2,
      title: "The group joins and votes",
      blurb:
        "Open the invite link, see what is being planned and rank your favourite options. The top choice is tallied automatically.",
      video: "/videos/chapter2-participant.mp4",
      poster: "/videos/chapter2-poster.jpg",
      length: "34 sec",
    },
    {
      id: "funding",
      number: 3,
      title: "Everyone chips in",
      blurb:
        "Once an element is locked, the cost is split across the people it is for, with a live bar showing how much is funded.",
      video: "/videos/chapter3-funding.mp4",
      poster: "/videos/chapter3-poster.jpg",
      length: "10 sec",
    },
    {
      id: "ready",
      number: 4,
      title: "Booked and ready to go",
      blurb:
        "Every piece of the trip has one clear status, visible to the whole group, from open for voting to booked.",
      video: "/videos/chapter4-ready.mp4",
      poster: "/videos/chapter4-poster.jpg",
      length: "7 sec",
    },
  ],
  note: "Recorded on our staging environment with demo accounts and sample data.",
};

export const about = {
  metaTitle: "About Catoco",
  metaDescription:
    "Catoco is a group travel platform where friends plan a trip together, vote on the choices and fund them together.",
  eyebrow: "About",
  title: "About us",
  lede: "Catoco started where most group trips start: in a group chat, with a trip that is always about to happen.",
  // The story (founder, 2026-10-19): the pain of organizing, waiting on
  // others, the money friction, and how differently everyone travels. Same
  // section layout the earlier draft used; the founder bio is still to come.
  sections: [
    {
      heading: "We have been the organizer",
      body: [
        "Someone says \"we should all go to Porto,\" and everyone loves the idea. Then the work lands on one or two people: finding the options, keeping track of who said what, and trying to turn forty messages into an actual plan. We have been those people, more than once.",
      ],
    },
    {
      heading: "Waiting on everyone",
      body: [
        "The hardest part is rarely the planning. It is the waiting. Waiting to hear which dates work, which place people prefer, whether they are really in. Prices climb while the poll sits half answered, and the organizer carries the quiet anxiety of a trip that might not happen at all.",
      ],
    },
    {
      heading: "The money conversation",
      body: [
        "Then comes the money. One person fronts the deposit and spends weeks politely chasing everyone else for their share. When plans change or someone drops out, it gets harder: who covers the gap, who gets a refund, and how do you ask without it feeling personal? Friendships should not have to absorb that.",
      ],
    },
    {
      heading: "Everyone travels differently",
      body: [
        "Every group is a mix. One friend wants the cheapest option, another wants comfort, someone only cares about the food. Those differences are what make a trip with friends worth taking, but without a fair way to decide, the loudest voice or the most patient organizer ends up choosing for everyone.",
      ],
    },
    {
      heading: "So we built Catoco",
      body: [
        "On Catoco every decision gets its own place. The group puts options forward, votes, and locks in what most people want. Nobody fronts the money: everyone commits their share, and it is only charged once the whole group is in. If someone drops out, the plan adjusts in the open, not in awkward messages.",
        "The trip goes from \"we should\" to \"we went,\" and the organizer gets to enjoy it too.",
      ],
    },
  ] as Section[],
  // The team, after the story (founder, 2026-10-23). Company details live in
  // the footer legal line only. Dutch copy comes with the i18n pass. To grow
  // it: add paragraphs to `bio`, more people to `people`, or advisers to
  // `advisers` (the advisers list only renders when it isn't empty).
  team: {
    people: [
      {
        name: "Matt Savit",
        role: "Founder",
        photo: { src: "/team/matt-savit.png", alt: "Matt Savit", width: 640, height: 800 },
        linkedin: { href: "https://www.linkedin.com/in/mattsavit/", label: "Matt Savit on LinkedIn" },
        bio: [
          "Matt enjoys planning, perhaps too much. His idea of spontaneity is swapping one pasta shape for another, and he's the type to start planning next year's holiday before this year's trip is over. Not everyone shares his enthusiasm, but he wanted his friends to be as invested in the plan as he was. So he built Catoco.",
        ],
      },
    ],
    advisersHeading: "Advisers",
    advisers: [] as { name: string; role: string; href?: string }[],
  },
};

export const contact = {
  metaTitle: "Contact",
  metaDescription: "Get in touch with the Catoco team.",
  eyebrow: "Contact",
  title: "Talk to a human",
  lede:
    "Questions, feedback, a bug, or just curious? Write to us and a real person will answer.",
  // One route (founder, 2026-10-23): a single address for everything, plus
  // the registered address. Never show info@, finance@, legal@, billing@ or
  // notifications@ publicly.
  email: COMPANY.email,
  emailLabel: "Email us",
  emailNote: "Questions, feedback or anything else about Catoco.",
  addressHeading: "Address",
  address: COMPANY.address,
  responseTime: "We'll reply just as soon as we can!",
  helpLine: "Looking for a quick answer first?",
  helpLink: { label: "Check the Help page", href: "/faq" },
};

// /for-suppliers early list (founder, 2026-10-23). Unlinked, noindex: reached
// only from Matt's outreach. Must not promise a live marketplace, fees or
// payment mechanics beyond this copy. Dutch: content/pages/nl.ts.
export const suppliers = {
  metaTitle: "For suppliers",
  eyebrow: "For suppliers",
  title: "Get requests from groups that have already decided.",
  intro:
    "Catoco helps friend groups choose and commit to a trip. Soon, groups will be able to ask providers like you for an offer: dates, number of people, budget, must-haves. You reply with your best price and terms.",
  points: [
    "You pay Catoco nothing. [[Confirm: no commission or fee from suppliers.]]",
    "You set the price and terms. Groups compare real offers and choose.",
    "If a group accepts, you are paid directly by the group. [[Confirm payment mechanics before publishing this line.]]",
    "Catoco works for the group, not for you, so we don't take commission from suppliers.",
  ],
  formHeading: "Be among the first.",
  formIntro: "Tell us what you offer and where.",
  fields: {
    businessName: "Business name",
    contactName: "Contact name",
    email: "Email",
    city: "City",
    cityDefault: "Amsterdam",
    offering: "What you offer",
    offeringPlaceholder: "Choose one",
    groupSize: "Typical group size (optional)",
    groupSizeHint: "A number or a range, like 8 or 6-20",
    website: "Website (optional)",
    note: "Anything else (optional)",
  },
  offerings: {
    hotel: "Hotel",
    apartment: "Apartment",
    restaurant: "Restaurant",
    venue: "Venue",
    transport: "Transport",
    activity: "Activity",
    other: "Other",
  },
  submit: "Join the early list",
  submitting: "Sending…",
  consent: "We'll only use this to contact you about group requests.",
  privacyLead: "See our",
  privacyLink: "privacy policy",
  privacyFallback: "Questions about your data: privacy@catoco.co",
  thanks: "Thanks, we'll be in touch when group requests open in your area.",
  errors: {
    required: "Please fill in the required fields.",
    email: "That email address doesn't look right.",
    website: "Websites need to start with http:// or https://.",
    groupSize: "Group size should be a number or a range, like 8 or 6-20.",
    tooLong: "One of the answers is too long.",
    rateLimited: "Too many submissions from here. Please try again in an hour.",
    generic: "Something went wrong. Please try again, or write to hello@catoco.co.",
  },
};

export const faq = {
  metaTitle: "Help and FAQ",
  metaDescription: "Answers to common questions about planning and funding trips on Catoco.",
  eyebrow: "Help",
  title: "Help and frequently asked questions",
  lede: "The basics of how Catoco works, from your first Trip to your final payment. Can't find your answer?",
  ledeLink: { label: "Contact us", href: "/contact" },
  groups: [
    {
      heading: "The basics",
      items: [
        { q: "What is Catoco?", a: "Catoco is a place for a group to plan a trip together. Everyone votes on the details, the cost is split across the people it is for, and each piece of the trip gets a clear status from open to booked." },
        { q: "Who is Catoco for?", a: "Friends, families and any group trying to get a trip out of the group chat and into reality. One person usually sets the Trip up and invites everyone else." },
        { q: "What is a Trip?", a: "A Trip is the shared home for your group's plans: the dates, the people and all the elements being decided." },
        { q: "What is an element?", a: "An element is one decision within your Trip, such as where to stay, where to eat or how to get from the airport. Each element has its own options, its own vote and its own status." },
        { q: "Can I try it without an account?", a: "Yes. Open the sample trip from the homepage to step through planning, voting, funding and booking with example data. Nothing you do there is saved." },
        { q: "Is Catoco free to use?", a: "Yes, Catoco is free during the beta. When your group pays the organizer directly, Catoco charges no fee." },
        { q: "Is Catoco available yet?", a: "Catoco is in an invite-only beta. Join the beta from the homepage and we will let you know when your group's spot is ready. If someone invites you to their Trip, you can sign in straight away." },
        { q: "Which languages and currencies are supported?", a: "Catoco is in English today, with Dutch on the way. Prices are shown in the currency of each option, most often euros." },
      ],
    },
    {
      heading: "Your account",
      items: [
        { q: "How do I sign in?", a: "Enter your email and we send you a sign-in link. There is no password to remember." },
        { q: "I did not get my sign-in email. What now?", a: "Check your spam or promotions folder, make sure you typed the address correctly and request a new link. Each link works once. If it still does not arrive, write to support@catoco.co." },
        { q: "My sign-in link says it has expired or was already used.", a: "Sign-in links are single use and time limited. Some email apps open links to scan them, which uses them up. Go back to the sign-in page and request a fresh one." },
        { q: "Can I change my email address?", a: "Not from the app yet. Write to support@catoco.co from your current address and we will change it for you." },
        { q: "How do I delete my account and data?", a: "Write to privacy@catoco.co from the address you sign in with. We will confirm once your account and data are deleted, and always within one month." },
      ],
    },
    {
      heading: "Creating a Trip",
      items: [
        { q: "How do I create a Trip?", a: "Sign in, choose to create a new Trip, then give it a name and dates. You can add elements straight away." },
        { q: "How do I add elements?", a: "Open your Trip and add an element such as a stay, a meal or a transfer. Then add the options the group will choose between, or lock one in straight away if it is already decided." },
        { q: "Can I search for places and options?", a: "Yes. Flights, stays and activities can be searched from our travel partners right inside the element. For anything else, paste a link or add the details yourself." },
        { q: "Can I change the dates or details later?", a: "Yes. Organizers can edit the Trip and its elements at any time. Once people have pledged money to an element, a higher price only applies to someone if it fits within the price cushion they chose; otherwise they are asked to pledge again." },
        { q: "How many people can join a Trip?", a: "There is no fixed limit. Organizers can set a minimum and maximum number of travellers, and each element can have its own number of spots." },
      ],
    },
    {
      heading: "Inviting your group",
      items: [
        { q: "How do I invite people?", a: "Open your Trip, go to Participants and copy the invite link, or invite people by email. Share the link in your group chat." },
        { q: "Does everyone need an account?", a: "Yes, to join a Trip. Opening the invite link and entering an email address is all it takes. Anyone can look around the sample trip without one." },
        { q: "Who can see my Trip?", a: "Only the people on it. The organizer decides whether everyone can see the full guest list and who is on each element." },
        { q: "Can I remove someone from a Trip?", a: "Yes. Organizers and co-organizers can remove people from Participants, as long as that person has no money in play on an element." },
        { q: "What can participants do?", a: "Participants vote, suggest options and pledge their share. Organizers choose in the Trip settings whether participants can also add elements, set up smaller groups or invite others." },
      ],
    },
    {
      heading: "Voting and deciding",
      items: [
        { q: "How does voting work?", a: "Each person ranks the options from favourite to least favourite. The ranking saves as you go and Catoco tallies the group's pick automatically." },
        { q: "Can I change my vote?", a: "Yes, as often as you like until voting closes." },
        { q: "When does voting end?", a: "When the element's voting deadline passes. The top choice then locks in automatically, or the organizer can lock it sooner." },
        { q: "What happens if there is a tie?", a: "The organizer is told and picks between the tied options." },
        { q: "Who can lock in a choice?", a: "The vote locks it when the deadline passes. Organizers and co-organizers can lock a choice at any time." },
        { q: "What do the statuses mean?", a: "An element is open for voting, locked in, being funded, or booked and ready to go. The status is the same for everyone on the Trip." },
      ],
    },
    {
      heading: "Paying and funding",
      items: [
        { q: "How does splitting the cost work?", a: "Once an element is locked, its cost is split across the people it is for. Each person pledges their own share, and a bar shows how much of the total is in." },
        { q: "What does pledging do?", a: "A pledge is your promise to pay your share. Nobody pays until everyone on the element has pledged. Then you get a payment request from the person collecting the money." },
        { q: "Can an element be for only some of the group?", a: "Yes. The cost is split across the people the element is for, not necessarily the whole Trip." },
        { q: "How do I pay?", a: "During the beta you pay the person collecting for the element directly, by bank transfer, payment link or QR code. They confirm your payment in Catoco so everyone can see where things stand." },
        { q: "Is my card information safe?", a: "Catoco does not take card payments in the beta, so your card details never pass through us." },
        { q: "Does Catoco charge a fee?", a: "No. When your group pays the organizer directly, Catoco charges nothing." },
        { q: "What is a price cushion?", a: "Prices can move before booking. When you pledge you can add a cushion, for example 10%, so your pledge still covers a small price rise. If the price goes above your cushion, your pledge is released and you choose whether to pledge again." },
        { q: "What if someone does not pay or drops out?", a: "The organizer can remove anyone who has not paid and recalculate the shares. Anyone whose new share is above their price cushion is asked to pledge again, and what they already paid still counts." },
        { q: "Can I get a refund?", a: "If you have paid and the price rises above your cushion, you can ask for a refund instead of pledging again. The person who collected your money refunds you directly and marks it in Catoco." },
        { q: "What happens if the deadline passes before everyone is in?", a: "Nobody pays, and any unpaid pledges are released. The organizer either sets a new deadline, and everyone is asked to pledge again, or moves to the group's next choice." },
      ],
    },
    {
      heading: "Booking",
      items: [
        { q: "Who books the trip?", a: "The person collecting for an element books it once everyone has paid, using the booking link on the element, and marks it as booked." },
        { q: "What does Booked mean?", a: "Booked means the element has been confirmed and is ready to go. Everyone on the Trip sees the same status." },
        { q: "What if a booking changes or is cancelled?", a: "The person who booked deals with the provider and updates the element in Catoco, so the group sees the change." },
      ],
    },
    {
      heading: "Privacy and security",
      items: [
        { q: "What data does Catoco collect?", a: "Your email address, the Trips you create or join, and the details you add to them. Traveler details needed for a booking are encrypted and deleted 90 days after the trip ends." },
        { q: "Do you sell my data?", a: "No. We never sell your personal data." },
        { q: "How do I ask for my data or have it deleted?", a: "Write to privacy@catoco.co. We reply within one month, and usually much sooner." },
      ],
    },
    {
      heading: "Troubleshooting",
      items: [
        { q: "A page looks out of date or a panel is missing.", a: "Reload the page. If something still looks wrong, tell us what you saw at support@catoco.co and include your Trip name." },
        { q: "I am not getting notification emails.", a: "Check your spam folder first. Every email has an unsubscribe link at the bottom; if you used it by mistake, write to us and we will turn emails back on." },
        { q: "Which browsers are supported?", a: "The latest versions of Chrome, Safari, Firefox and Edge, on desktop and on phones." },
        { q: "I found a bug or have an idea.", a: "We would love to hear it. Write to support@catoco.co." },
      ],
    },
  ] as { heading: string; items: Faq[] }[],
  stillStuck: "Still stuck? Email",
  supportEmail: "support@catoco.co",
  stillStuckLink: { label: "contact us", href: "/contact" },
};

export const tutorials = {
  metaTitle: "Video tutorials",
  metaDescription:
    "Four short videos showing how a group plans, votes on and funds a trip with Catoco.",
  eyebrow: "How it works",
  title: "Video tutorials",
  lede:
    "Four short chapters, recorded live on a brand-new account. Watch them in order or jump to the part you need.",
  watch: "Watch",
  transcriptLabel: "What you will see",
  narration: {
    organizer: [
      "Jordan creates a Trip called Porto Crew Trip, sets the dates, and starts adding the pieces that need deciding.",
      "Each one is an element: its own small decision with its own status.",
      "Once the shape of the Trip is there, Jordan copies a single invite link to bring the group in.",
    ],
    participant: [
      "Riley opens the invite link, joins the Trip and sees exactly what Jordan set up.",
      "For Stay in Porto there are two real options. Riley ranks them and the ranking is saved instantly.",
      "The group page shows who is in, and the top choice locks in once voting closes.",
    ],
    funding: [
      "Once an element locks, Catoco splits the cost across the people it is for.",
      "A live bar shows how much is funded, with a Commit button for each person's share.",
    ],
    ready: [
      "Zoom out and every piece of the Trip has one real status.",
      "The stay and the dinner are booked, and the airport transfer is still being funded.",
    ],
  } as Record<string, string[]>,
  footnote:
    "Videos were recorded on our staging environment with demo accounts and sample data.",
  cta: { label: "Have a question?", href: "/faq" },
};

export const terms = {
  metaTitle: "Terms of service",
  metaDescription: "The terms that apply when you use Catoco.",
  eyebrow: "Legal",
  title: "Terms of service",
  effective: "Effective date: [[date]]",
  sections: [
    {
      heading: "1. Who we are",
      body: [`These terms apply to your use of Catoco, run by ${COMPANY.entity} (${COMPANY.address}, KvK ${COMPANY.kvk}) ("Catoco", "we"). By using Catoco you agree to them.`],
    },
    {
      heading: "2. What Catoco does",
      body: [
        "Catoco helps groups plan a trip together: proposing options, voting, splitting costs and tracking what is booked.",
        "[[Clarify Catoco's role in payments and bookings: does Catoco book on your behalf, or only coordinate and collect? This needs legal review.]]",
      ],
    },
    {
      heading: "3. Your account",
      body: [
        "You sign in with your email address. You are responsible for activity on your account.",
        "[[Minimum age and eligibility.]]",
      ],
    },
    {
      heading: "4. Trips, groups and content",
      body: [
        "People you invite can see and take part in your Trip. You are responsible for what you add to it.",
        "[[Content rules and what we may remove.]]",
      ],
    },
    {
      heading: "5. Payments and fees",
      body: [
        "[[How payments are collected and by which payment provider.]]",
        "[[Catoco fees, if any.]]",
        "[[Cancellations, refunds and what happens if someone does not pay. Needs legal review.]]",
      ],
    },
    {
      heading: "6. Acceptable use",
      body: ["[[What you may not do: misuse, fraud, harassment, automated access.]]"],
    },
    {
      heading: "7. Availability and changes",
      body: ["[[Beta status, availability, changes to the service and to these terms.]]"],
    },
    {
      heading: "8. Liability",
      body: ["[[Limitation of liability. Needs legal review.]]"],
    },
    {
      heading: "9. Governing law",
      body: ["[[Dutch law and competent court, to be confirmed.]]"],
    },
    {
      heading: "10. Contact",
      body: ["Questions about these terms? Contact us through the contact page."],
    },
  ] as Section[],
};

export const privacy = {
  metaTitle: "Privacy policy",
  metaDescription: "How Catoco collects, uses and protects your personal data.",
  eyebrow: "Legal",
  title: "Privacy policy",
  effective: "Effective date: [[date]]",
  sections: [
    {
      heading: "1. Who is responsible",
      body: ["[[Legal entity, address and contact for privacy questions (data controller).]]"],
    },
    {
      heading: "2. What we collect",
      body: [
        "Your email address, used to sign you in.",
        "The Trips you create or join, including the options, votes and funding details you add.",
        "Payment information needed to collect your share. [[Confirm: card details are handled by the payment provider and not stored by Catoco.]]",
        "Basic technical and usage data from analytics (PostHog, hosted in the EU) — the pages you visit and the buttons and links you click — but only if you accept analytics cookies when asked. See Cookies below.",
      ],
    },
    {
      heading: "3. Why we use it",
      body: ["[[Purposes and legal basis for each, as required by the GDPR.]]"],
    },
    {
      heading: "4. Who we share it with",
      body: [
        "People on your Trip can see what you add to it.",
        "We use service providers to run Catoco, for example for hosting, our database, payments and email. [[List providers and where data is processed.]]",
      ],
    },
    {
      heading: "5. How long we keep it",
      body: ["[[Retention periods.]]"],
    },
    {
      heading: "6. Your rights",
      body: [
        "You can ask to access, correct, export or delete your personal data, and to object to or restrict how we use it. Contact us and we will respond. [[Confirm response time.]]",
        "You can also complain to the Dutch Data Protection Authority (Autoriteit Persoonsgegevens).",
      ],
    },
    {
      heading: "7. Cookies",
      body: [
        "A sign-in session cookie that keeps you logged in. This is required for Catoco to work and is not optional.",
        "Analytics cookies from PostHog (hosted in the EU), used to understand how Catoco is used — which pages people visit and which buttons and links they click. Web addresses are recorded without anything after the page path (no search terms, links' codes or tokens). These are only set if you accept them when asked; if you decline, no analytics cookies are set and no analytics data is collected from your visit.",
        "If you pay through Catoco, Stripe may set a small number of its own cookies to help prevent fraud. These are set by Stripe as part of processing your payment, not for advertising.",
        "[[Confirm how long analytics data is kept once collected.]]",
      ],
    },
    {
      heading: "8. Changes",
      body: ["[[How we notify you of changes to this policy.]]"],
    },
  ] as Section[],
};
