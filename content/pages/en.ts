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

export const site = {
  name: "Catoco",
  tagline: "Plan it together. Vote together. Fund it together. Go.",
  contactEmail: "support@catoco.co",
  nav: [
    { href: "/tutorials", label: "How it works" },
    { href: "/faq", label: "Help" },
    { href: "/contact", label: "Contact" },
  ],
  footer: {
    product: "Product",
    company: "Company",
    legal: "Legal",
    links: {
      product: [
        { href: "/tutorials", label: "Video tutorials" },
        { href: "/faq", label: "Help and FAQ" },
        { href: "/sign-in", label: "Sign in" },
      ],
      company: [
        { href: "/contact", label: "Contact" },
        { href: "/company", label: "Company details" },
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
    "Catoco turns your group chat's next trip idea into a real, funded, booked trip.",
  eyebrow: "About",
  title: "Group trips shouldn't live in a group chat",
  lede:
    "Catoco is where a group plans a trip together: everyone votes on the details, everyone chips in, and nobody gets stuck holding the bill.",
  sections: [
    {
      heading: "The problem",
      body: [
        "Someone says \"we should all go to Porto.\" Forty messages later there are three half-decided Airbnbs, a spreadsheet nobody updates, and one person quietly fronting the deposit.",
      ],
    },
    {
      heading: "How Catoco works",
      body: [
        "A trip is made of elements. Each element is one small decision with its own status: a place to stay, a dinner, an airport transfer. Instead of one giant plan nobody can track, the group sees exactly where every piece stands.",
        "Everyone ranks the options, the top choice locks in, the cost is split across the people it is for, and the element moves to booked.",
      ],
    },
    {
      heading: "What we believe",
      body: [
        "Planning should feel like progress, not admin.",
        "Nobody should pay more than their share, or chase anyone for it.",
        "A trip is only real once it is funded and booked, so that is where Catoco is headed.",
      ],
    },
    {
      heading: "Meet the founder",
      body: [
        "Matt Savit, founder of Catoco.",
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
        "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.",
      ],
    },
  ] as Section[],
  cta: { label: "See how it works", href: "/tutorials" },
  ctaSecondary: { label: "Talk to us", href: "/contact" },
};

export const contact = {
  metaTitle: "Contact",
  metaDescription: "Get in touch with the Catoco team.",
  eyebrow: "Contact",
  title: "Talk to a human",
  lede:
    "Questions, feedback, a bug, or just curious? Write to us and a real person will answer.",
  cards: [
    {
      title: "General and support",
      body: "For anything about using Catoco, your trip or your account.",
      action: "Email us",
    },
    {
      title: "Partnerships and press",
      body: "For partnerships, press and anything else that does not fit above.",
      action: "Email us",
    },
    {
      title: "Privacy requests",
      body: "To see, correct or delete your data. More in the privacy policy.",
      action: "Email us",
    },
  ],
  responseTime: "[[Typical response time, for example: we reply within two working days.]]",
  helpLine: "Looking for a quick answer first?",
  helpLink: { label: "Check the Help page", href: "/faq" },
  languageNote: "[[Languages you offer support in, for example English and Dutch.]]",
};

export const faq = {
  metaTitle: "Help and FAQ",
  metaDescription: "Answers to common questions about planning and funding trips on Catoco.",
  eyebrow: "Help",
  title: "Help and frequently asked questions",
  lede: "The basics of how Catoco works, from your first Trip to your final payment. Can't find your answer? Contact us.",
  groups: [
    {
      heading: "The basics",
      items: [
        { q: "What is Catoco?", a: "Catoco is a place for a group to plan a trip together. Everyone votes on the details, the cost is split across the people it is for, and each piece of the trip gets a clear status from open to booked." },
        { q: "Who is Catoco for?", a: "Friends, families and any group trying to get a trip out of the group chat and into reality. One person usually sets the Trip up and invites everyone else." },
        { q: "What is a Trip?", a: "A Trip is the shared home for your group's plans: the dates, the people and all the elements being decided." },
        { q: "What is an element?", a: "An element is one decision within your Trip, such as where to stay, where to eat or how to get from the airport. Each element has its own options, its own vote and its own status." },
        { q: "Is Catoco free to use?", a: "[[Confirm pricing and fees, including whether the beta is free.]]" },
        { q: "Is Catoco available yet?", a: "Catoco is in beta. You can join the beta from the homepage. [[Confirm current access and countries.]]" },
        { q: "Which languages and currencies are supported?", a: "[[Confirm supported languages (English now, Dutch planned) and currencies.]]" },
      ],
    },
    {
      heading: "Your account",
      items: [
        { q: "How do I sign in?", a: "Enter your email and we send you a sign-in link. There is no password to remember." },
        { q: "I did not get my sign-in email. What now?", a: "Check your spam or promotions folder, make sure you typed the address correctly and request a new link. Each link works once. If it still does not arrive, contact support@catoco.co." },
        { q: "My sign-in link says it has expired or was already used.", a: "Sign-in links are single use and time limited. Go back to the sign-in page and request a fresh one." },
        { q: "Can I change my email address?", a: "[[Confirm whether and how a user can change their email.]]" },
        { q: "How do I delete my account and data?", a: "Email support@catoco.co and ask. See the privacy policy for what we keep and why. [[Confirm the deletion process.]]" },
      ],
    },
    {
      heading: "Creating a Trip",
      items: [
        { q: "How do I create a Trip?", a: "Sign in, choose to create a new Trip, then give it a name and dates. You can add elements straight away." },
        { q: "How do I add elements?", a: "Open your Trip and add an element such as a stay, a meal or a transfer. Then add the options the group will choose between." },
        { q: "Can I search for places and options?", a: "Yes. Some elements let you search for options. [[Confirm which element types support search and where results come from.]]" },
        { q: "Can I change the dates or details later?", a: "[[Confirm what organizers can edit after creation and after funding starts.]]" },
        { q: "How many people can join a Trip?", a: "[[Confirm group size limits.]]" },
      ],
    },
    {
      heading: "Inviting your group",
      items: [
        { q: "How do I invite people?", a: "Open your Trip, go to Participants and copy the invite link. Share it in your group chat." },
        { q: "Does everyone need an account?", a: "[[Confirm: can people view a Trip before signing in, and what requires an account?]]" },
        { q: "Who can see my Trip?", a: "People you invite can see it. [[Confirm visibility rules for people who are not members.]]" },
        { q: "Can I remove someone from a Trip?", a: "[[Confirm organizer controls for removing participants.]]" },
        { q: "What can participants do?", a: "[[Confirm default permissions and how an organizer changes them.]]" },
      ],
    },
    {
      heading: "Voting and deciding",
      items: [
        { q: "How does voting work?", a: "Each person ranks the options from favourite to least favourite and saves their ranking. Catoco tallies the group's pick automatically." },
        { q: "Can I change my vote?", a: "[[Confirm whether votes can be changed while voting is open.]]" },
        { q: "When does voting end?", a: "[[Confirm: deadline, organizer closes it, or when everyone has voted.]]" },
        { q: "What happens if there is a tie?", a: "[[Confirm tie-break rule.]]" },
        { q: "Who can lock in a choice?", a: "[[Confirm who can lock an element: organizer only, or the group by default.]]" },
        { q: "What do the statuses mean?", a: "An element is open for voting, locked in, being funded, or booked and ready to go. The status is the same for everyone on the Trip." },
      ],
    },
    {
      heading: "Paying and funding",
      items: [
        { q: "How does splitting the cost work?", a: "Once an element is locked, its cost is split across the people it is for. Each person commits their own share, and a bar shows how much of the total is funded." },
        { q: "What does Commit do?", a: "Commit is how you confirm and pay your share of an element. [[Confirm exactly when the card is charged and what the person sees.]]" },
        { q: "Can an element be for only some of the group?", a: "Yes. The cost is split across the people the element is for, not necessarily the whole Trip." },
        { q: "Which payment methods can I use?", a: "[[Confirm supported methods and currencies.]]" },
        { q: "Is my card information safe?", a: "[[Confirm: card details are handled by the payment provider and are not stored by Catoco.]]" },
        { q: "Does Catoco charge a fee?", a: "[[Fee model to be confirmed. State clearly what, if anything, Catoco charges.]]" },
        { q: "What if someone does not pay?", a: "[[Non-payment policy to be confirmed and reviewed legally before launch.]]" },
        { q: "Can I get a refund?", a: "[[Refund policy to be confirmed and reviewed legally before launch.]]" },
        { q: "What happens if the funding target is not reached?", a: "[[Confirm what happens to committed money if an element is not fully funded.]]" },
      ],
    },
    {
      heading: "Booking",
      items: [
        { q: "Who books the trip?", a: "[[Clarify: does Catoco book for you, or does the organizer book and mark the element as booked?]]" },
        { q: "What does Booked mean?", a: "Booked means the element has been confirmed and is ready to go. Everyone on the Trip sees the same status." },
        { q: "What if a booking changes or is cancelled?", a: "[[Confirm how changes and cancellations are handled and communicated.]]" },
      ],
    },
    {
      heading: "Privacy and security",
      items: [
        { q: "What data does Catoco collect?", a: "Your email address, the Trips you create or join, and the details you add to them. See the privacy policy for the full picture." },
        { q: "Do you sell my data?", a: "[[Confirm statement for the privacy policy.]]" },
        { q: "How do I ask for my data or have it deleted?", a: "Email support@catoco.co. [[Confirm response time.]]" },
      ],
    },
    {
      heading: "Troubleshooting",
      items: [
        { q: "A page looks out of date or a panel is missing.", a: "Reload the page. If something still looks wrong, tell us what you saw at support@catoco.co and include your Trip name." },
        { q: "I am not getting notification emails.", a: "Check your spam folder first. [[Confirm how to manage or unsubscribe from notifications.]]" },
        { q: "Which browsers are supported?", a: "[[Confirm supported browsers and mobile support.]]" },
        { q: "I found a bug or have an idea.", a: "We would love to hear it. Write to support@catoco.co." },
      ],
    },
  ] as { heading: string; items: Faq[] }[],
  stillStuck: "Still stuck?",
  stillStuckLink: { label: "Contact us", href: "/contact" },
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

export const company = {
  metaTitle: "Company details",
  metaDescription: "Legal and registration details for Catoco.",
  eyebrow: "Company",
  title: "Company details",
  lede: "The legal information you are entitled to know about who runs Catoco.",
  rows: [
    { label: "Trading name", value: "Catoco" },
    { label: "Legal entity", value: "Catalyst to Commit B.V." },
    { label: "Chamber of Commerce (KVK) number", value: "[[KVK number]]" },
    { label: "VAT (BTW) number", value: "[[VAT / BTW number]]" },
    { label: "Email", value: "support@catoco.co" },
    { label: "Managing director", value: "Matt Savit" },
  ],
  note: "Details will be completed once the company is registered.",
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
      body: ["These terms apply to your use of Catoco, run by Catalyst to Commit B.V. (KVK [[KVK number]]) (\"Catoco\", \"we\"). By using Catoco you agree to them."],
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
        "Basic technical data such as device and usage information. [[Confirm what analytics, if any, are used.]]",
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
      body: ["[[Which cookies are used (sign-in session, language) and whether a consent banner is needed.]]"],
    },
    {
      heading: "8. Changes",
      body: ["[[How we notify you of changes to this policy.]]"],
    },
  ] as Section[],
};
