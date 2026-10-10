/**
 * Best-effort field extraction from a forwarded booking-confirmation email.
 * Deterministic text heuristics only — no third-party AI/OCR service sees
 * the email (that would be a new data processor; needs a founder/legal call
 * first). Everything extracted is shown to the organizer to confirm or edit
 * and is marked "extracted"; nothing here is ever published unconfirmed.
 */

export type ExtractedBooking = {
  vendor?: string;
  confirmation_ref?: string;
  starts_at?: string; // ISO
  ends_at?: string; // ISO
  address?: string;
  checkin_instructions?: string;
  cancellation_policy?: string;
  cancellation_deadline?: string; // ISO
};

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

/** HTML → readable text (good enough for confirmation emails). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d|table)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

/** "12 Jun 2027", "June 12, 2027", "2027-06-12", "12/06/2027" (+ optional time) → ISO (UTC). */
export function parseDate(s: string): string | undefined {
  const t = s.trim();
  let y: number | undefined, m: number | undefined, d: number | undefined;
  let mm: RegExpMatchArray | null;
  if ((mm = t.match(/(\d{4})-(\d{2})-(\d{2})/))) {
    y = +mm[1]; m = +mm[2] - 1; d = +mm[3];
  } else if ((mm = t.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/))) {
    d = +mm[1]; m = MONTHS[mm[2].slice(0, 4).toLowerCase()] ?? MONTHS[mm[2].slice(0, 3).toLowerCase()]; y = +mm[3];
  } else if ((mm = t.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/))) {
    m = MONTHS[mm[1].slice(0, 4).toLowerCase()] ?? MONTHS[mm[1].slice(0, 3).toLowerCase()]; d = +mm[2]; y = +mm[3];
  } else if ((mm = t.match(/(\d{1,2})[/.](\d{1,2})[/.](\d{4})/))) {
    // Ambiguous: assume day-first (EU/most vendors) unless the first part > 12 can't be a month anyway.
    d = +mm[1]; m = +mm[2] - 1; y = +mm[3];
    if (m > 11) { [d, m] = [m + 1, d - 1]; }
  }
  if (y === undefined || m === undefined || d === undefined || m < 0 || m > 11 || d < 1 || d > 31) return undefined;
  let hh = 0, mi = 0;
  const time = t.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (time) {
    hh = +time[1]; mi = +time[2];
    const ap = time[3]?.toLowerCase();
    if (ap === "pm" && hh < 12) hh += 12;
    if (ap === "am" && hh === 12) hh = 0;
  }
  const iso = new Date(Date.UTC(y, m, d, hh, mi));
  return Number.isFinite(iso.getTime()) ? iso.toISOString() : undefined;
}

/** Lines of the message body, minus a forwarded message's own header block. */
function bodyLines(text: string): string[] {
  const out: string[] = [];
  let inHeader = false;
  for (const raw of text.split("\n")) {
    const l = raw.trim();
    if (/forwarded message|original message/i.test(l)) {
      inHeader = true; // the forwarded header block runs until its last header line
      continue;
    }
    if (inHeader) {
      if (/^(from|date|sent|to|cc|subject):\s/i.test(l)) continue;
      inHeader = false;
    }
    out.push(raw);
  }
  return out;
}

function lineAfter(text: string, label: RegExp): string | undefined {
  for (const line of bodyLines(text)) {
    const m = line.match(label);
    if (m) {
      const rest = line.slice((m.index ?? 0) + m[0].length).replace(/^[\s:–—-]+/, "").trim();
      if (rest) return rest.slice(0, 300);
    }
  }
  return undefined;
}

/** Display name of the vendor: the original sender inside a forwarded message, else the subject. */
function vendorFrom(text: string, subject: string): string | undefined {
  const fwd = text.match(/^From:\s*"?([^"<\n]+?)"?\s*<[^>\n]+>/m);
  if (fwd && !/catoco/i.test(fwd[1])) return fwd[1].trim().slice(0, 120);
  const subj = subject.replace(/^(fwd?|fw)\s*:\s*/i, "");
  const m =
    subj.match(/(?:from|at|with)\s+([A-Z][\w&'.\- ]{2,60})/) ??
    text.match(/(?:booking|booked|reservation|staying)\s+(?:with|at)\s+([A-Z][\w&'.\-]*(?:\s+[A-Z][\w&'.\-]*){0,4})/);
  if (m) return m[1].trim().replace(/[!.,]+$/, "");
  return undefined;
}

const REF_LABEL =
  /\b(?:confirmation|booking|reservation|itinerary|order|reference|ref|PNR|record locator)\s*(?:number|no\.?|#|code|id|ref(?:erence)?)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{4,19})\b/gi;

/** First labelled reference that contains a digit (skips "Booking confirmed"). */
function findRef(...sources: string[]): string | undefined {
  for (const src of sources) {
    for (const m of src.matchAll(REF_LABEL)) {
      if (/\d/.test(m[1])) return m[1].toUpperCase();
    }
  }
  return undefined;
}

export function extractBooking(input: { subject: string; text?: string | null; html?: string | null }): ExtractedBooking {
  const text = (input.text && input.text.trim()) || (input.html ? htmlToText(input.html) : "");
  const subject = input.subject ?? "";
  const out: ExtractedBooking = {};

  const ref = findRef(subject, bodyLines(text).join("\n"));
  if (ref) out.confirmation_ref = ref;

  const vendor = vendorFrom(text, subject);
  if (vendor) out.vendor = vendor;

  // Most specific labels first; a bare "Date:" only as a last resort.
  const start =
    lineAfter(text, /\b(check[- ]?in|arrival|arrive|departure date|depart(?:s|ing)?|date of (?:visit|activity|tour)|start(?:s| date)?|reservation date)\b\s*(?:date)?/i) ??
    lineAfter(text, /\bdate\b/i);
  const end = lineAfter(text, /\b(check[- ]?out|departure|end(?:s| date)?|return)\b\s*(?:date)?/i);
  const s = start ? parseDate(start) : undefined;
  const e = end ? parseDate(end) : undefined;
  if (s) out.starts_at = s;
  if (e && (!s || e >= s)) out.ends_at = e;

  const address = lineAfter(text, /\b(address|meeting point|location|where)\b/i);
  if (address && /\d|street|st\.|road|rd\.|via |rue |avenue|ave\.|plaza|square/i.test(address)) out.address = address;

  const checkin = lineAfter(text, /\b(check[- ]?in (?:time|instructions|from)|how to check in|meeting instructions)\b/i);
  if (checkin) out.checkin_instructions = checkin;

  const cancelLine = bodyLines(text).find((l) => /\b(free cancellation|cancellation|cancel)\b/i.test(l));
  if (cancelLine) {
    out.cancellation_policy = cancelLine.trim().slice(0, 300);
    const dl = parseDate(cancelLine);
    if (dl) out.cancellation_deadline = dl;
  }
  return out;
}
