"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/html";
import { SUPPLIER_INTEREST_NOTIFY, validateSupplierInterest, type ValidationError } from "@/lib/supplier-interest";

export type SupplierInterestState =
  | { status: "idle" }
  | { status: "ok" }
  | { status: "error"; error: ValidationError | "rateLimited" | "generic" };

const RATE_LIMIT_PER_HOUR = 5;
const hash = (s: string) => createHash("sha256").update(`catoco-supplier-interest:${s}`).digest("hex");

/**
 * Stores a supplier early-list sign-up (service role; the table has no public
 * access) and emails partnerships@. Honeypot hits, duplicates within 24 hours
 * and rate-limited sends store nothing; the first two still look like success.
 */
export async function submitSupplierInterest(_prev: SupplierInterestState, form: FormData): Promise<SupplierInterestState> {
  // Honeypot: a field people never see. Bots that fill it get a quiet "thanks".
  if (String(form.get("company_website") ?? "").trim()) return { status: "ok" };

  const v = validateSupplierInterest({
    businessName: String(form.get("businessName") ?? ""),
    contactName: String(form.get("contactName") ?? ""),
    email: String(form.get("email") ?? ""),
    city: String(form.get("city") ?? ""),
    offering: String(form.get("offering") ?? ""),
    groupSize: String(form.get("groupSize") ?? ""),
    website: String(form.get("website") ?? ""),
    note: String(form.get("note") ?? ""),
    source: String(form.get("source") ?? ""),
  });
  if (!v.ok) return { status: "error", error: v.error };

  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
  const ipHash = hash(ip);
  const userAgentHash = hash(h.get("user-agent") ?? "");

  try {
    const supabase = createServiceClient();
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { count: recentFromIp } = await supabase
      .from("supplier_interest")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", hourAgo);
    if ((recentFromIp ?? 0) >= RATE_LIMIT_PER_HOUR) return { status: "error", error: "rateLimited" };

    // Same email in the last day: same confirmation, no second row or email.
    const { count: recentForEmail } = await supabase
      .from("supplier_interest")
      .select("id", { count: "exact", head: true })
      .eq("email", v.row.email)
      .gte("created_at", dayAgo);
    if ((recentForEmail ?? 0) > 0) return { status: "ok" };

    const { error } = await supabase
      .from("supplier_interest")
      .insert({ ...v.row, ip_hash: ipHash, user_agent_hash: userAgentHash });
    if (error) {
      console.error("[for-suppliers] insert failed:", error.message);
      return { status: "error", error: "generic" };
    }

    const r = v.row;
    const rows: [string, string | null][] = [
      ["Business", r.business_name],
      ["Contact", r.contact_name],
      ["Email", r.email],
      ["City", r.city],
      ["Offers", r.offering],
      ["Typical group size", r.group_size],
      ["Website", r.website],
      ["Note", r.note],
      ["Source", r.source],
    ];
    const sent = await sendEmail({
      to: SUPPLIER_INTEREST_NOTIFY,
      subject: `Supplier early list: ${r.business_name} (${r.offering}, ${r.city})`,
      html: `<p>A new supplier joined the early list on /for-suppliers.</p><table>${rows
        .filter(([, val]) => val)
        .map(([k, val]) => `<tr><td style="padding:2px 12px 2px 0;color:#6b6b64">${k}</td><td>${escapeHtml(val!).replace(/\n/g, "<br>")}</td></tr>`)
        .join("")}</table>`,
    });
    if (sent.error) console.error("[for-suppliers] notify email failed:", sent.error);

    return { status: "ok" };
  } catch (err) {
    console.error("[for-suppliers] failed:", err);
    return { status: "error", error: "generic" };
  }
}
