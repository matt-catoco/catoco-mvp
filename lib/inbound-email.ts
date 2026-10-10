import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractBooking, type ExtractedBooking } from "@/lib/booking-extract";
import { CONFIRMATION_BUCKET, CONFIRMATION_MAX_BYTES, CONFIRMATION_MIME_TYPES } from "@/lib/booking-confirmation";

/**
 * Forward-to-us booking confirmations (Resend Inbound, verified against
 * their docs 2026-10-10): mail to any address on our receiving subdomain
 * (INBOUND_EMAIL_DOMAIN, its own MX — the root domain's Google Workspace MX
 * is never touched) triggers an `email.received` webhook carrying metadata
 * only; the body and attachments are fetched from Resend's API. The
 * per-element token lives in the local part: booking-<token>@<domain>.
 */
export const INBOUND_BUCKET = "booking-inbound";
const RESEND = "https://api.resend.com";
const TOLERANCE_S = 5 * 60;

/** Svix-format signature check (what Resend webhooks use). */
export function verifyResendSignature(rawBody: string, headers: Headers, secret: string): boolean {
  const id = headers.get("svix-id");
  const ts = headers.get("svix-timestamp");
  const sigHeader = headers.get("svix-signature");
  if (!id || !ts || !sigHeader) return false;
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > TOLERANCE_S) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${rawBody}`).digest();
  return sigHeader.split(" ").some((part) => {
    const [, sig] = part.split(",");
    if (!sig) return false;
    const got = Buffer.from(sig, "base64");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

export function tokenFromAddresses(to: string[], domain: string): string | null {
  for (const addr of to) {
    const m = addr.toLowerCase().match(/booking-([a-z0-9]{20,64})@([a-z0-9.-]+)/);
    if (m && m[2] === domain.toLowerCase()) return m[1];
  }
  return null;
}

function bareAddress(from: string): string {
  return (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
}

/** name+tag@domain and name@domain are the same mailbox — compare without the tag. */
function mailbox(addr: string): string {
  const [local, domain] = addr.toLowerCase().split("@");
  return `${(local ?? "").split("+")[0]}@${domain ?? ""}`;
}

async function resendGet<T>(path: string): Promise<T | null> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  const res = await fetch(`${RESEND}${path}`, { headers: { Authorization: `Bearer ${key}` } });
  return res.ok ? ((await res.json()) as T) : null;
}

type ReceivedEmail = {
  id: string;
  from: string;
  subject: string;
  text?: string | null;
  html?: string | null;
  raw?: { download_url?: string };
  authentication?: { spf?: { result?: string }; dkim?: { result?: string } | { result?: string }[] };
};
type AttachmentMeta = { id: string; filename: string; content_type: string; size?: number; download_url?: string };

/** Who may send confirmations for this element: the purchaser of its live
 * funding request; with no funding request, the organizer and the creator. */
async function allowedSenders(service: SupabaseClient, elementId: string): Promise<string[]> {
  const { data: el } = await service.from("trip_elements").select("trip_id, created_by").eq("id", elementId).maybeSingle();
  if (!el) return [];
  const { data: frs } = await service
    .from("funding_request_elements")
    .select("funding_requests!inner(purchaser_id, status, created_at)")
    .eq("element_id", elementId);
  const live = ((frs ?? []) as unknown as { funding_requests: { purchaser_id: string | null; status: string; created_at: string } }[])
    .map((r) => r.funding_requests)
    .filter((f) => f.status !== "superseded")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  let ids: string[];
  if (live?.purchaser_id) ids = [live.purchaser_id];
  else {
    const { data: trip } = await service.from("trips").select("organizer_id").eq("id", el.trip_id).maybeSingle();
    ids = [trip?.organizer_id, el.created_by].filter((x): x is string => Boolean(x));
  }
  const emails: string[] = [];
  for (const id of ids) {
    const { data } = await service.rpc("get_user_email", { p_user_id: id });
    if (typeof data === "string") emails.push(data.toLowerCase());
  }
  return emails;
}

function authFailed(a: ReceivedEmail["authentication"]): boolean {
  if (!a) return false;
  const dkim = Array.isArray(a.dkim) ? a.dkim : a.dkim ? [a.dkim] : [];
  const spf = a.spf?.result?.toLowerCase();
  const dkimPass = dkim.some((d) => d.result?.toLowerCase() === "pass");
  // Only treat an explicit failure of both as spoofed.
  return !dkimPass && spf === "fail";
}

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/pdf": "pdf" };

/**
 * Handle one received email end to end. Never throws on bad input — an
 * unknown token or failed fetch just records/quietly drops it.
 */
export async function processInboundEmail(
  service: SupabaseClient,
  data: { email_id: string; from: string; to: string[]; subject?: string },
): Promise<{ status: string }> {
  const domain = process.env.INBOUND_EMAIL_DOMAIN;
  if (!domain) return { status: "not_configured" };
  const token = tokenFromAddresses(data.to ?? [], domain);
  if (!token) return { status: "no_token" };

  const { data: dup } = await service.from("inbound_booking_emails").select("id").eq("resend_email_id", data.email_id).maybeSingle();
  if (dup) return { status: "duplicate" };

  const { data: el } = await service.from("trip_elements").select("id, trip_id").eq("inbound_token", token).maybeSingle();
  const email = await resendGet<ReceivedEmail>(`/emails/receiving/${encodeURIComponent(data.email_id)}`);
  const from = bareAddress(email?.from ?? data.from ?? "");

  if (!el) {
    // Unknown token: keep a record (no element), store nothing else.
    await service.from("inbound_booking_emails").insert({
      token, resend_email_id: data.email_id, from_address: from, subject: (data.subject ?? "").slice(0, 300), status: "rejected",
    });
    return { status: "unknown_token" };
  }

  const allowed = await allowedSenders(service, el.id);
  const verified = allowed.some((a) => mailbox(a) === mailbox(from)) && !authFailed(email?.authentication);
  const prefix = `${el.trip_id}/${el.id}`;

  // Original message → private storage (both verified and quarantined).
  let rawPath: string | null = null;
  if (email?.raw?.download_url) {
    const raw = await fetch(email.raw.download_url).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
    if (raw) {
      rawPath = `${prefix}/${data.email_id}.eml`;
      const up = await service.storage.from(INBOUND_BUCKET).upload(rawPath, raw, { contentType: "message/rfc822", upsert: true });
      if (up.error) rawPath = null;
    }
  }

  // Attachments → private storage; for verified mail, PDFs/images also go
  // where booking documents live so one can be the record's document.
  const stored: { filename: string; content_type: string; path: string; document_path?: string }[] = [];
  const list = await resendGet<{ data: AttachmentMeta[] }>(`/emails/receiving/${encodeURIComponent(data.email_id)}/attachments`);
  for (const a of (list?.data ?? []).slice(0, 10)) {
    if (!a.download_url || (a.size ?? 0) > CONFIRMATION_MAX_BYTES) continue;
    const buf = await fetch(a.download_url).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
    if (!buf) continue;
    const path = `${prefix}/${data.email_id}-${randomUUID()}`;
    const up = await service.storage.from(INBOUND_BUCKET).upload(path, buf, { contentType: a.content_type, upsert: false });
    if (up.error) continue;
    const entry: (typeof stored)[number] = { filename: a.filename.slice(0, 200), content_type: a.content_type, path };
    if (verified && CONFIRMATION_MIME_TYPES.includes(a.content_type)) {
      const docPath = `${prefix}/${randomUUID()}.${EXT[a.content_type]}`;
      const dup2 = await service.storage.from(CONFIRMATION_BUCKET).upload(docPath, buf, { contentType: a.content_type });
      if (!dup2.error) entry.document_path = docPath;
    }
    stored.push(entry);
  }

  const extracted: ExtractedBooking | null = verified
    ? extractBooking({ subject: email?.subject ?? data.subject ?? "", text: email?.text, html: email?.html })
    : null;

  await service.from("inbound_booking_emails").insert({
    element_id: el.id,
    token,
    resend_email_id: data.email_id,
    from_address: from,
    subject: (email?.subject ?? data.subject ?? "").slice(0, 300),
    sender_verified: verified,
    raw_message_path: rawPath,
    attachments: stored,
    extracted,
    status: verified ? "parsed" : "quarantined",
  });

  if (!verified || !extracted) return { status: verified ? "parsed" : "quarantined" };

  // Draft the booking record: fill only EMPTY fields, mark them extracted,
  // never confirm. A record that's already confirmed is left alone.
  const { data: existing } = await service.from("element_bookings").select("*").eq("element_id", el.id).maybeSingle();
  if (existing?.confirmed_at) return { status: "parsed_record_already_confirmed" };
  const patch: Record<string, unknown> = {};
  const provenance: Record<string, string> = { ...(existing?.field_provenance ?? {}) };
  for (const [k, v] of Object.entries(extracted)) {
    if (v && !(existing as Record<string, unknown> | null)?.[k]) {
      patch[k] = v;
      provenance[k] = "extracted";
    }
  }
  const doc = stored.find((s) => s.document_path)?.document_path;
  if (doc && !existing?.document_path) patch.document_path = doc;
  Object.assign(patch, {
    source: "email",
    extracted_raw: extracted,
    field_provenance: provenance,
    updated_at: new Date().toISOString(),
  });
  if (existing) await service.from("element_bookings").update(patch).eq("element_id", el.id);
  else await service.from("element_bookings").insert({ element_id: el.id, ...patch });
  return { status: "parsed" };
}
