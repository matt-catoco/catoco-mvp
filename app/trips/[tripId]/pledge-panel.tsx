"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/trip-elements";
import { epcQrPayload, formatIban, gapAmount, payWindowClosesAt } from "@/lib/pledge";
import { fmt } from "@/lib/i18n/config";
import { useLocale, useT } from "@/lib/i18n/client";
import { btnCommit, btnPrimary, btnSecondary, fieldClass, labelClass } from "@/lib/ui";
import { cushionCap, cushionOptions, type CushionChoice } from "@/lib/cushion";
import {
  acceptPledge,
  addPayoutMethod,
  confirmPledgePayments,
  openPayWindow,
  proceedWithShortfall,
  removePayoutMethod,
  removeUnpaidAndRecalculate,
  reportPledgePaid,
  setPledgeSettings,
  setPledgeStatusVisibility,
  undoPledgePayment,
  withdrawPledge,
} from "./pledge-actions";
import { useTravelerGate } from "./traveler-details";

export type PledgeRow = {
  participantId: string;
  displayName: string;
  status: "pledged" | "reported_paid" | "confirmed";
  paid: number;
  reference: string;
  /** share + the member's price cushion, as pledged */
  capAmount: number;
};

export type PayoutMethodView = {
  id: string;
  kind: "iban" | "link" | "qr";
  label: string | null;
  accountName: string | null;
  iban: string | null;
  url: string | null;
  /** short-lived signed URL for an uploaded QR image */
  qrUrl: string | null;
};

export type PledgePanelProps = {
  tripId: string;
  elementId: string;
  fundingRequestId: string;
  currentUserId: string;
  currency: string;
  share: number;
  required: number;
  /** immediate: each person pays as soon as they pledge */
  payTiming: "immediate" | "after_all";
  /** null = no deadline */
  windowHours: number | null;
  windowOpenedAt: string | null;
  /** the pay window has closed (decided server-side at render) */
  windowClosed: boolean;
  canManage: boolean;
  /** the person collecting (the funding request's purchaser) */
  collectorId: string | null;
  collectorName: string;
  population: number;
  pledges: PledgeRow[];
  /** organizers: people in the element who haven't pledged */
  notPledged: { userId: string; displayName: string }[];
  /** members can see who has pledged and paid (organizer's switch, per element) */
  showStatus: boolean;
  /** the trip lets people add a price cushion */
  cushionAllowed: boolean;
  recommendedCushion: CushionChoice | null;
  myInElement: boolean;
  mySpotsFull: boolean;
  payoutMethods: PayoutMethodView[];
};

const focusRing = "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent";
const box = "flex flex-col gap-2 rounded-xl border border-brand-line p-3.5";
const field = `h-9 ${fieldClass}`;

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function run(fn: () => Promise<{ error?: string }>, after?: () => void) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.error) {
        setError(res.error);
        return;
      }
      after?.();
      router.refresh();
    });
  }
  return { pending, error, run };
}

function CopyText({ value, label }: { value: string; label: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="text-brand-muted">{label}</span>
      <code className="select-all rounded bg-black/[.04] px-1.5 py-0.5 font-mono text-[12.5px] text-foreground dark:bg-white/[.06]">{value}</code>
      <button
        type="button"
        className={`text-[11.5px] font-semibold text-brand-accent ${focusRing}`}
        onClick={() => {
          navigator.clipboard
            .writeText(value)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
            .catch(() => {});
        }}
      >
        {copied ? t.pledge.copied : t.pledge.copy}
      </button>
    </span>
  );
}

/** SEPA payment QR with name, IBAN, amount and reference prefilled (EUR only). */
function EpcQr({ payload, alt }: { payload: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(payload, { errorCorrectionLevel: "M", margin: 1, width: 176 })
      .then((d) => {
        if (live) setSrc(d);
      })
      .catch(() => setSrc(null));
    return () => {
      live = false;
    };
  }, [payload]);
  // eslint-disable-next-line @next/next/no-img-element -- generated data URL
  return src ? <img src={src} alt={alt} width={176} height={176} className="rounded-lg border border-brand-line bg-white p-1" /> : null;
}

/** What a member sees: the payment request (amount, reference, how to pay). */
function PaymentRequest({ p, owed, reference }: { p: PledgePanelProps; owed: number; reference: string }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3">
      <span className="text-[12.5px]">
        <CopyText label={t.pledge.reference} value={reference} />
        <span className="mt-1 block text-[12px] text-brand-muted">{fmt(t.pledge.referenceHint, { ref: reference })}</span>
      </span>
      {p.payoutMethods.length === 0 && (
        <p className="text-[12.5px] text-brand-muted">{fmt(t.pledge.methodsNone, { organizer: p.collectorName })}</p>
      )}
      {p.payoutMethods.map((m) => {
        if (m.kind === "iban" && m.iban && m.accountName) {
          const payload = epcQrPayload({ name: m.accountName, iban: m.iban, amount: owed, currency: p.currency, reference });
          return (
            <div key={m.id} className="flex flex-wrap items-start gap-3 text-[12.5px]">
              <div className="flex min-w-0 flex-col gap-1">
                <b className="font-semibold text-foreground">{t.pledge.bankTransfer}</b>
                <span>
                  <span className="text-brand-muted">{t.pledge.to} </span>
                  {m.accountName}
                </span>
                <CopyText label={t.pledge.iban} value={formatIban(m.iban)} />
                {payload && <span className="text-[12px] text-brand-muted">{t.pledge.qrHint}</span>}
              </div>
              {payload && <EpcQr payload={payload} alt={t.pledge.qrHint} />}
            </div>
          );
        }
        if (m.kind === "link" && m.url) {
          return (
            <a
              key={m.id}
              href={m.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`w-fit px-3 py-1.5 text-xs ${btnSecondary}`}
            >
              {t.pledge.paymentLink}: {m.label ?? m.url} ↗
            </a>
          );
        }
        if (m.kind === "qr" && m.qrUrl) {
          return (
            // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
            <img
              key={m.id}
              src={m.qrUrl}
              alt={fmt(t.pledge.qrImage, { organizer: p.collectorName })}
              className="h-44 w-44 rounded-lg border border-brand-line bg-white object-contain p-1"
            />
          );
        }
        return null;
      })}
    </div>
  );
}

function MemberView(p: PledgePanelProps) {
  const t = useT();
  const locale = useLocale();
  const a = useAction();
  // Same as the card path: traveler / lead-guest details first, then pledge.
  const travelerGate = useTravelerGate();
  const [agreed, setAgreed] = useState(false);
  // Price cushion, framed exactly like a card commitment's (mandate-panel).
  const options = cushionOptions(p.recommendedCushion, (n) => formatCurrency(n, p.currency));
  const [cushionKey, setCushionKey] = useState<string>((options.find((o) => o.recommended) ?? options[0]).key);
  const [customAmount, setCustomAmount] = useState("");
  const cushion: CushionChoice = !p.cushionAllowed
    ? { kind: "none" }
    : cushionKey === "custom"
      ? Number(customAmount) > 0
        ? { kind: "amount", value: Number(customAmount) }
        : { kind: "none" }
      : (options.find((o) => o.key === cushionKey)?.choice ?? { kind: "none" });
  const cap = cushionCap(p.share, cushion);
  const me = p.pledges.find((x) => x.participantId === p.currentUserId);
  const money = (n: number) => formatCurrency(n, p.currency);
  const closes = payWindowClosesAt(p.windowOpenedAt, p.windowHours);
  const dateText = closes?.toLocaleString(locale === "nl" ? "nl-NL" : "en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  if (!p.myInElement) return null;

  if (!me) {
    if (p.mySpotsFull) return <p className="text-[12.5px] text-brand-muted">{t.pledge.waitlisted}</p>;
    return (
      <div className={box}>
        <b className="font-[family-name:var(--font-display)] text-[15px] font-bold text-foreground">{t.pledge.termsHeading}</b>
        <ul className="ml-4 list-disc text-[12.5px] leading-relaxed text-brand-muted">
          <li className="text-foreground">{fmt(t.pledge.termsShare, { amount: money(p.share) })}</li>
          <li className="text-foreground">
            {cap > p.share
              ? fmt(t.pledge.termsCushion, { amount: money(p.share), cap: money(cap) })
              : fmt(t.pledge.termsNoCushion, { amount: money(p.share) })}
          </li>
          <li>{t.pledge.termsOutside}</li>
          <li>
            {p.payTiming === "immediate"
              ? fmt(t.pledge.termsPayNow, { organizer: p.collectorName })
              : p.windowHours != null
                ? fmt(t.pledge.termsWindow, { hours: p.windowHours })
                : fmt(t.pledge.termsPayLater, { organizer: p.collectorName })}
          </li>
          <li>{t.pledge.termsDropout}</li>
          <li>{fmt(t.pledge.termsMoney, { organizer: p.collectorName })}</li>
        </ul>
        {p.cushionAllowed && (
          <fieldset className="flex flex-col gap-2 rounded-xl border border-brand-line px-3 py-2.5">
            <legend className="sr-only">{t.pledge.cushionHeading}</legend>
            <b aria-hidden className="text-[13px] font-semibold text-foreground">{t.pledge.cushionHeading}</b>
            <span className="text-[12px] leading-relaxed text-brand-muted">{t.pledge.cushionHint}</span>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t.pledge.cushionHeading}>
              {[...options, { key: "custom", label: t.pledge.cushionCustom, choice: { kind: "none" } as CushionChoice, recommended: false }].map((o) => (
                <button
                  key={o.key}
                  type="button"
                  role="radio"
                  aria-checked={cushionKey === o.key}
                  onClick={() => setCushionKey(o.key)}
                  className={`flex min-h-[36px] min-w-[64px] flex-1 flex-col items-center justify-center rounded-xl border-[1.5px] px-2 py-1 text-[13px] font-semibold transition-colors ${focusRing} ${
                    cushionKey === o.key ? "border-brand-accent bg-brand-teal-wash text-brand-accent" : "border-brand-line text-foreground hover:border-brand-accent"
                  }`}
                >
                  {o.key === "none" ? t.pledge.cushionNone : o.label}
                  {o.recommended && <span className="text-[10.5px] font-medium text-brand-accent">{t.pledge.cushionRecommended}</span>}
                </button>
              ))}
            </div>
            {cushionKey === "custom" && (
              <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-foreground">
                {fmt(t.pledge.cushionCustomLabel, { currency: p.currency })}
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={p.share}
                  step="1"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  className={field}
                />
              </label>
            )}
          </fieldset>
        )}
        <label className="flex items-center gap-2 text-[12.5px] text-foreground">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="accent-[var(--brand-accent)]" />
          {t.pledge.agree}
        </label>
        <button
          type="button"
          disabled={!agreed || a.pending}
          onClick={() => travelerGate.gate(() => a.run(() => acceptPledge(p.tripId, p.elementId, p.fundingRequestId, cushion)))}
          className={`self-start px-4 py-2 text-sm ${btnCommit}`}
        >
          {a.pending ? t.common.saving : fmt(t.pledge.pledgeButton, { amount: money(p.share) })}
        </button>
        {a.error && <p role="alert" className="text-[12.5px] text-red-500">{a.error}</p>}
      </div>
    );
  }

  const owed = Math.max(0, Math.round((p.share - me.paid) * 100) / 100);
  if (me.status === "confirmed" && owed === 0) {
    return <p className="rounded-xl border border-brand-line px-3.5 py-2.5 text-[13px] font-semibold text-foreground">✓ {fmt(t.pledge.confirmed, { organizer: p.collectorName })}</p>;
  }

  const windowOpen = Boolean(p.windowOpenedAt);
  return (
    <div className={box}>
      {!windowOpen ? (
        <>
          <span className="text-[13px] text-foreground">{fmt(t.pledge.pledged, { amount: money(me.paid > 0 ? owed : p.share) })}</span>
          {me.capAmount > p.share && (
            <span className="text-[12.5px] text-brand-muted">{fmt(t.pledge.pledgedCap, { cap: money(me.capAmount) })}</span>
          )}
          <span className="text-[12.5px] text-brand-muted">
            {p.showStatus || p.canManage
              ? fmt(t.pledge.waitingForGroup, { n: p.pledges.length, m: p.population, organizer: p.collectorName })
              : fmt(t.pledge.waitingNoStatus, { organizer: p.collectorName })}
          </span>
        </>
      ) : (
        <>
          <b className="font-[family-name:var(--font-display)] text-[15px] font-bold text-foreground">
            {fmt(t.pledge.payHeading, { organizer: p.collectorName, amount: money(owed) })}
          </b>
          {me.paid > 0 && <span className="text-[12.5px] text-brand-muted">{fmt(t.pledge.owesMore, { amount: money(owed) })}</span>}
          {dateText && <span className="text-[12.5px] text-brand-muted">{fmt(t.pledge.payBy, { date: dateText })}</span>}
          <PaymentRequest p={p} owed={owed} reference={me.reference} />
        </>
      )}
      {me.status === "reported_paid" ? (
        <span className="text-[12.5px] text-brand-muted">{fmt(t.pledge.reported, { organizer: p.collectorName })}</span>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {windowOpen && (
            <button
              type="button"
              disabled={a.pending}
              onClick={() => a.run(() => reportPledgePaid(p.tripId, p.elementId, p.fundingRequestId))}
              className={`px-3 py-1.5 text-xs ${btnPrimary}`}
            >
              {t.pledge.iPaid}
            </button>
          )}
          {me.paid === 0 && (
            <button
              type="button"
              disabled={a.pending}
              onClick={() => a.run(() => withdrawPledge(p.tripId, p.elementId, p.fundingRequestId))}
              className={`text-xs text-brand-muted underline ${focusRing}`}
            >
              {t.pledge.withdraw}
            </button>
          )}
        </div>
      )}
      {a.error && <p role="alert" className="text-[12.5px] text-red-500">{a.error}</p>}
    </div>
  );
}

/** Organizer who collects: where people should pay them. */
function PayoutSetup(p: PledgePanelProps) {
  const t = useT();
  const a = useAction();
  const [kind, setKind] = useState<"iban" | "link" | "qr">("iban");
  const [accountName, setAccountName] = useState("");
  const [iban, setIban] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);

  async function add(): Promise<{ error?: string }> {
    if (kind === "iban") return addPayoutMethod(p.tripId, p.elementId, { kind, accountName, iban });
    if (kind === "link") return addPayoutMethod(p.tripId, p.elementId, { kind, url });
    if (!file) return { error: t.pledgeOrg.addQr };
    const ext = (file.name.split(".").pop() ?? "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
    const path = `${p.currentUserId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await createClient().storage.from("payout-qr").upload(path, file, { contentType: file.type || "image/png" });
    if (error) return { error: error.message };
    return addPayoutMethod(p.tripId, p.elementId, { kind: "qr", qrPath: path });
  }

  return (
    <div className={box}>
      <b className="text-[13px] font-semibold text-foreground">{t.pledgeOrg.setupHeading}</b>
      <span className="text-[12px] text-brand-muted">{t.pledgeOrg.setupHint}</span>
      {p.payoutMethods.length > 0 && (
        <ul className="flex flex-col gap-1.5 text-[12.5px]">
          {p.payoutMethods.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 truncate">
                {m.kind === "iban" ? `${m.accountName} · ${formatIban(m.iban ?? "")}` : m.kind === "link" ? (m.label ?? m.url) : t.pledgeOrg.addQr}
              </span>
              <button
                type="button"
                disabled={a.pending}
                onClick={() => a.run(() => removePayoutMethod(p.tripId, p.elementId, m.id))}
                className={`text-[11.5px] text-brand-muted underline ${focusRing}`}
              >
                {t.pledgeOrg.remove}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div role="group" className="flex flex-wrap gap-1.5">
        {(["iban", "link", "qr"] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
            className={`rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium ${focusRing} ${
              kind === k ? "border-brand-accent bg-brand-teal-wash text-brand-accent" : "border-brand-line text-brand-muted"
            }`}
          >
            {k === "iban" ? t.pledgeOrg.addIban : k === "link" ? t.pledgeOrg.addLink : t.pledgeOrg.addQr}
          </button>
        ))}
      </div>
      {kind === "iban" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={labelClass}>{t.pledgeOrg.accountName}</span>
            <input id="payout-name" className={field} value={accountName} onChange={(e) => setAccountName(e.target.value)} autoComplete="name" />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>{t.pledgeOrg.ibanField}</span>
            <input id="payout-iban" className={field} value={iban} onChange={(e) => setIban(e.target.value)} placeholder="NL91 ABNA 0417 1643 00" />
          </label>
        </div>
      )}
      {kind === "link" && (
        <input id="payout-link" className={field} value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t.pledgeOrg.linkPlaceholder} inputMode="url" />
      )}
      {kind === "qr" && (
        <input id="payout-qr" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-[12px]" />
      )}
      <button type="button" disabled={a.pending} onClick={() => a.run(add, () => { setIban(""); setUrl(""); setFile(null); })} className={`self-start px-3 py-1.5 text-xs ${btnPrimary}`}>
        {a.pending ? t.common.saving : t.pledgeOrg.add}
      </button>
      {a.error && <p role="alert" className="text-[12.5px] text-red-500">{a.error}</p>}
    </div>
  );
}

function OrganizerView(p: PledgePanelProps) {
  const t = useT();
  const locale = useLocale();
  const a = useAction();
  const [selected, setSelected] = useState<string[]>([]);
  // One choice: "now" (pay right away), "none" (after everyone, no deadline) or hours.
  const timingValue = (timing: string, h: number | null) => (timing === "immediate" ? "now" : h == null ? "none" : String(h));
  const [timing, setTiming] = useState(timingValue(p.payTiming, p.windowHours));
  const [confirmGap, setConfirmGap] = useState(false);
  const money = (n: number) => formatCurrency(n, p.currency);
  const closes = payWindowClosesAt(p.windowOpenedAt, p.windowHours);
  const closed = p.windowClosed;
  const dateText = closes?.toLocaleString(locale === "nl" ? "nl-NL" : "en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const gap = gapAmount(p.required, p.pledges.map((x) => x.paid));
  const statusLabel = (s: PledgeRow["status"]) =>
    s === "confirmed" ? t.pledgeOrg.stConfirmed : s === "reported_paid" ? t.pledgeOrg.stReported : t.pledgeOrg.stPledged;

  return (
    <div className="flex flex-col gap-3">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-brand-muted">{t.pledgeOrg.organizerOnly}</span>
      {p.collectorId === p.currentUserId && <PayoutSetup {...p} />}

      <div className={box}>
        <b className="text-[13px] font-semibold text-foreground">{t.pledgeOrg.settingsHeading}</b>
        <div className="flex flex-wrap items-end gap-3 text-[12.5px]">
          <label className="flex flex-col gap-1">
            <span className={labelClass}>{t.pledgeOrg.timingLabel}</span>
            <select id="pledge-timing" className={`${field} w-72 max-w-full`} value={timing} disabled={p.pledges.length > 0} onChange={(e) => setTiming(e.target.value)}>
              <option value="now">{t.pledgeOrg.timingImmediate}</option>
              <option value="none">{t.pledgeOrg.timingNoDeadline}</option>
              {[24, 48, 72].map((v) => (
                <option key={v} value={String(v)}>
                  {fmt(t.pledgeOrg.timingHours, { n: v })}
                </option>
              ))}
            </select>
          </label>
          {timing !== timingValue(p.payTiming, p.windowHours) && (
            <button
              type="button"
              disabled={a.pending}
              onClick={() =>
                a.run(() =>
                  setPledgeSettings(
                    p.tripId,
                    p.elementId,
                    p.fundingRequestId,
                    timing === "now" ? "immediate" : "after_all",
                    timing === "now" || timing === "none" ? null : Number(timing),
                  ),
                )
              }
              className={`h-9 px-3 text-xs ${btnPrimary}`}
            >
              {t.pledgeOrg.saveSettings}
            </button>
          )}
        </div>
        <label className="flex items-center gap-2 text-[12.5px] text-foreground">
          <input
            type="checkbox"
            checked={p.showStatus}
            disabled={a.pending}
            onChange={(e) => {
              const show = e.target.checked;
              a.run(() => setPledgeStatusVisibility(p.tripId, p.elementId, p.fundingRequestId, show));
            }}
            className="accent-[var(--brand-accent)]"
          />
          {t.pledgeOrg.showStatus}
        </label>
        <span className="text-[12px] text-brand-muted">{t.pledgeOrg.sharesFixed}</span>
        {p.pledges.length > 0 && <span className="text-[12px] text-brand-muted">{t.pledgeOrg.settingsLocked}</span>}
      </div>

      <div className={box}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <b className="text-[13px] font-semibold text-foreground">{t.pledgeOrg.rosterHeading}</b>
          {!p.windowOpenedAt ? (
            <button
              type="button"
              disabled={a.pending || p.pledges.length === 0}
              onClick={() => a.run(() => openPayWindow(p.tripId, p.elementId, p.fundingRequestId))}
              className={`px-3 py-1.5 text-xs ${btnSecondary}`}
            >
              {t.pledgeOrg.openWindow}
            </button>
          ) : (
            <span className="text-[12px] text-brand-muted">{closed ? t.pledgeOrg.windowClosed : dateText ? fmt(t.pledgeOrg.windowOpen, { date: dateText }) : t.pledgeOrg.windowOpenNoDeadline}</span>
          )}
        </div>
        <ul className="flex flex-col divide-y divide-brand-line text-[12.5px]">
          {p.pledges.map((x) => {
            const owes = x.paid < p.share;
            return (
              <li key={x.participantId} className="flex flex-wrap items-center gap-2 py-1.5">
                {owes && (
                  <input
                    type="checkbox"
                    aria-label={x.displayName}
                    checked={selected.includes(x.participantId)}
                    onChange={(e) =>
                      setSelected((s) => (e.target.checked ? [...s, x.participantId] : s.filter((id) => id !== x.participantId)))
                    }
                    className="accent-[var(--brand-accent)]"
                  />
                )}
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">{x.displayName}</span>
                <code className="font-mono text-[11.5px] text-brand-muted">{x.reference}</code>
                <span className={x.status === "reported_paid" ? "font-semibold text-amber-700 dark:text-amber-400" : "text-brand-muted"}>
                  {owes && x.paid > 0 ? fmt(t.pledge.owesMore, { amount: money(p.share - x.paid) }) : statusLabel(x.status)}
                </span>
                {owes ? (
                  <button
                    type="button"
                    disabled={a.pending}
                    onClick={() => a.run(() => confirmPledgePayments(p.tripId, p.elementId, p.fundingRequestId, [x.participantId]))}
                    className={`px-2.5 py-1 text-[11.5px] ${btnPrimary}`}
                  >
                    {t.pledgeOrg.markPaid}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={a.pending}
                    onClick={() => a.run(() => undoPledgePayment(p.tripId, p.elementId, p.fundingRequestId, x.participantId))}
                    className={`text-[11.5px] text-brand-muted underline ${focusRing}`}
                  >
                    {t.pledgeOrg.undo}
                  </button>
                )}
              </li>
            );
          })}
          {p.notPledged.map((x) => (
            <li key={x.userId} className="flex items-center gap-2 py-1.5 text-brand-muted">
              <span className="min-w-0 flex-1 truncate">{x.displayName}</span>
              <span>{t.pledgeOrg.notPledged}</span>
            </li>
          ))}
        </ul>
        {selected.length > 1 && (
          <button
            type="button"
            disabled={a.pending}
            onClick={() => a.run(() => confirmPledgePayments(p.tripId, p.elementId, p.fundingRequestId, selected), () => setSelected([]))}
            className={`self-start px-3 py-1.5 text-xs ${btnPrimary}`}
          >
            {t.pledgeOrg.markSelected} ({selected.length})
          </button>
        )}
      </div>

      {/* With no deadline the organizer can settle the gap whenever they decide to. */}
      {p.windowOpenedAt && (closed || p.windowHours == null) && gap > 0 && (
        <div className={`${box} border-amber-500/40 bg-amber-500/10`}>
          <b className="text-[13px] font-semibold text-foreground">{fmt(t.pledgeOrg.gapHeading, { gap: money(gap) })}</b>
          {confirmGap ? (
            <>
              <span className="text-[12.5px] text-foreground">{fmt(t.pledgeOrg.gapCoverConfirm, { gap: money(gap) })}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={a.pending}
                  onClick={() => a.run(() => proceedWithShortfall(p.tripId, p.elementId, p.fundingRequestId))}
                  className={`px-3 py-1.5 text-xs ${btnPrimary}`}
                >
                  {t.pledgeOrg.continue}
                </button>
                <button type="button" onClick={() => setConfirmGap(false)} className={`px-3 py-1.5 text-xs ${btnSecondary}`}>
                  {t.pledgeOrg.cancel}
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setConfirmGap(true)} className={`px-3 py-1.5 text-xs ${btnPrimary}`}>
                {t.pledgeOrg.gapCover}
              </button>
              {p.pledges.some((x) => x.paid < p.share) && (
                <button
                  type="button"
                  disabled={a.pending}
                  onClick={() => a.run(() => removeUnpaidAndRecalculate(p.tripId, p.elementId, p.fundingRequestId))}
                  className={`px-3 py-1.5 text-xs ${btnSecondary}`}
                >
                  {t.pledgeOrg.gapRecalc}
                </button>
              )}
            </div>
          )}
          <span className="text-[12px] text-brand-muted">{t.pledgeOrg.gapRecalcHint}</span>
        </div>
      )}
      {a.error && <p role="alert" className="text-[12.5px] text-red-500">{a.error}</p>}
    </div>
  );
}

/**
 * Pledge-only funding (three-prong Prompt 1): members pledge under stated
 * terms and pay the organizer directly; the organizer confirms payments
 * here. Catoco never touches the money.
 */
/** Members (not organizers, who get the full roster): who has pledged and paid, when shown. */
function GroupStatus(p: PledgePanelProps) {
  const t = useT();
  if (!p.myInElement || p.pledges.length + p.notPledged.length === 0) return null;
  const label = (s: PledgeRow["status"]) =>
    s === "confirmed" ? t.pledgeOrg.stConfirmed : s === "reported_paid" ? t.pledgeOrg.stReported : t.pledgeOrg.stPledged;
  return (
    <div className={box}>
      <b className="text-[13px] font-semibold text-foreground">{t.pledge.groupHeading}</b>
      <ul className="flex flex-col divide-y divide-brand-line text-[12.5px]">
        {p.pledges.map((x) => (
          <li key={x.participantId} className="flex items-center gap-2 py-1.5">
            <span className="min-w-0 flex-1 truncate font-medium text-foreground">{x.displayName}</span>
            <span className="text-brand-muted">{label(x.status)}</span>
          </li>
        ))}
        {p.notPledged.map((x) => (
          <li key={x.userId} className="flex items-center gap-2 py-1.5 text-brand-muted">
            <span className="min-w-0 flex-1 truncate">{x.displayName}</span>
            <span>{t.pledgeOrg.notPledged}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PledgePanel(props: PledgePanelProps) {
  return (
    <div className="flex flex-col gap-3">
      <MemberView {...props} />
      {props.showStatus && !props.canManage && <GroupStatus {...props} />}
      {props.canManage && <OrganizerView {...props} />}
    </div>
  );
}
