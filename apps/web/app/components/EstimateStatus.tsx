"use client";
import { useState } from "react";
import { SectionLabel, card, btnPrimary, btnSecondary, btnDanger, money, fmtWhen, fmtDay } from "./ui";

export interface InvoiceInfo { kind: "deposit" | "balance"; status: string; totalCents: number; payLink: string | null; error: string | null; updatedAt?: string; paidAt?: string | null }
export interface InstallInfo { date: string; earliest: string; status: string; materials: string; error: string | null; crew: string | null }
export interface StatusData {
  sentForReal?: boolean; acceptedAt?: string | null; sentAt?: string | null; invoices?: InvoiceInfo[]; install?: InstallInfo | null;
  estimate?: { customer?: { name?: string; phone?: string; job_address?: string }; service_date?: string; delivery?: string } | null;
  computed?: { totalCents?: number } | null;
  status: string; signInOpen?: boolean; error: string | null; cloverEstimateNumber: string | null; screenshots: string[];
}

const firstName = (d: StatusData) => d.estimate?.customer?.name?.replace(/^test\s+/i, "").split(" ")[0] || "The customer";
const isDry = (d: StatusData) => d.status === "sent" && (d.error ?? "").startsWith("dry run");
/** Only the "Clicked Send" error happens after Clover's Send button. Everything else stops before it. */
const mayHaveSent = (err: string | null) => /clicked send/i.test(err ?? "");
const NOTHING_SENT = /\s*Nothing was sent to the customer, so it's safe to tap Try again\.?\s*$/;

/** Name, address, start date and total, at the top of every estimate screen. */
export function StatusSummary({ data }: { data: StatusData }) {
  const c = data.estimate?.customer;
  const sub = [c?.job_address?.split(",")[0], data.estimate?.service_date && `starts ${fmtDay(data.estimate.service_date)}`].filter(Boolean).join(" · ");
  return (
    <section className={`${card} flex items-center justify-between gap-3 p-[18px]`}>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="truncate font-display text-xl font-bold">{c?.name ?? "Estimate"}</p>
        {sub && <p className="text-[13px] text-muted">{sub}</p>}
      </div>
      {data.computed?.totalCents != null && <p className="shrink-0 font-display text-[22px] font-bold tabular-nums">{money(data.computed.totalCents)}</p>}
    </section>
  );
}

function Step({ state, title, sub, children }: { state: "done" | "now" | "todo" | "bad"; title: string; sub?: string; children?: React.ReactNode }) {
  const ring = { done: "bg-brand border-brand", now: "bg-warn border-warn", bad: "bg-bad border-bad", todo: "bg-white border-[#B9B4A7]" }[state];
  return (
    <div className="flex gap-3.5">
      <div className="flex flex-col items-center">
        <span className={`flex h-[26px] w-[26px] items-center justify-center rounded-full border-2 ${ring}`}>
          {state === "done" && <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-10" /></svg>}
        </span>
        <span className="min-h-[18px] w-0.5 flex-1 bg-line" />
      </div>
      <div className="flex flex-1 flex-col gap-1 pb-[18px]">
        <p className={`text-[15px] font-semibold ${state === "todo" ? "text-muted" : state === "bad" ? "text-bad" : "text-ink"}`}>{title}</p>
        {sub && <p className="text-[13px] text-muted">{sub}</p>}
        {children}
      </div>
    </div>
  );
}

function invoiceStep(inv: InvoiceInfo, accepted: boolean, name: string | undefined, phone: string | undefined) {
  const label = `${inv.kind === "deposit" ? "Deposit" : "Balance"} ${money(inv.totalCents)}`;
  const sms = phone && inv.payLink
    ? `sms:${phone.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(`Hi ${name?.split(" ")[0] ?? ""}, here's your ${inv.kind} invoice: ${inv.payLink}`)}`
    : null;
  const link = sms && <a href={sms} className="mt-1 text-sm font-semibold text-brand underline">Text the pay link</a>;
  switch (inv.status) {
    case "sent": return <Step key={inv.kind} state="now" title={`${label} · waiting for payment`} sub={`Invoice emailed${inv.updatedAt ? ` ${fmtWhen(inv.updatedAt)}` : ""}`}>{link}</Step>;
    case "paid_in_person": return <Step key={inv.kind} state="done" title={`${label} · paid in person`} />;
    case "paid": return <Step key={inv.kind} state="done" title={`${label} · paid`} sub={inv.paidAt ? `Clover shows it paid · ${fmtWhen(inv.paidAt)}` : "Clover shows it paid"} />;
    case "approved": case "sending": return <Step key={inv.kind} state="now" title={label} sub="Putting the invoice into Clover…" />;
    case "failed": return <Step key={inv.kind} state="bad" title={`${label} · didn't go through`} sub={inv.error ?? "Clover didn't take it. Nothing was sent. Tap Try again below."} />;
    default: return <Step key={inv.kind} state="todo" title={label}
      sub={inv.kind === "deposit" ? (accepted ? "Ready to send" : "Send now, or once they accept") : "Send it when the job is done"} />;
  }
}

function InstallStep({ id, i }: { id: string; i: InstallInfo }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [moving, setMoving] = useState(false);
  const when = `${fmtDay(i.date)}${i.crew ? ` · ${i.crew}` : ""}`;
  const mat = i.materials === "ordered" ? "waiting on materials" : i.materials === "delayed" ? "materials delayed" : i.materials === "arrived" ? "materials in" : "";
  const testRun = (i.error ?? "").startsWith("Test run");
  async function act(action: "arrived" | "delayed" | "retry", date?: string) {
    setBusy(true); setMsg("");
    const r = await fetch(`/api/estimates/${id}/install`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, date }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false); setMoving(false);
    setMsg(r.ok ? (action === "arrived" ? "Install confirmed." : action === "delayed" ? "New date saved." : "Trying again…") : j.error ?? "That didn't work.");
  }
  const actions = (
    <div className="mt-1.5 flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {i.materials !== "arrived" && i.materials !== "none" && (
          <button disabled={busy} onClick={() => act("arrived")} className="h-10 rounded-[10px] bg-brand px-3 text-[13px] font-semibold text-white disabled:opacity-50">Materials in</button>
        )}
        <button disabled={busy} onClick={() => setMoving((v) => !v)} className="h-10 rounded-[10px] border border-edge bg-white px-3 text-[13px] font-semibold">
          {i.materials === "arrived" || i.materials === "none" ? "Change date" : "Delayed"}
        </button>
      </div>
      {moving && (
        <label className="flex items-center gap-2 text-[13px] font-semibold">New date
          <input type="date" min={new Date().toISOString().slice(0, 10)} className="h-10 rounded-[10px] border border-edge px-2"
            onChange={(e) => e.target.value && act("delayed", e.target.value)} />
        </label>
      )}
      {msg && <p className="text-[13px] text-muted">{msg}</p>}
    </div>
  );
  switch (i.status) {
    case "confirmed": return <Step state="done" title={`Install confirmed · ${when}`} sub={mat ? `Materials ${mat.replace("materials ", "")}` : undefined}>{actions}</Step>;
    case "done": return <Step state="done" title={`Installed · ${when}`} />;
    case "cancelled": return null;
    case "failed":
      return (
        <Step state="bad" title={`Install not booked · ${when}`} sub={i.error ?? "Clover didn't take the appointment. Nothing was booked."}>
          <button disabled={busy} onClick={() => act("retry")} className="mt-1.5 h-10 self-start rounded-[10px] bg-bad px-3 text-[13px] font-semibold text-white disabled:opacity-50">Try again</button>
          {msg && <p className="text-[13px] text-muted">{msg}</p>}
        </Step>
      );
    case "to_reschedule":
      return <Step state="now" title={`Install moved to ${when}`} sub="Saved here. Move the appointment in Clover's calendar too (the app can't edit Clover appointments yet).">{actions}</Step>;
    case "tentative": case "to_confirm":
      return (
        <Step state="now" title={`Install penciled in · ${when}`}
          sub={testRun ? `Tentative, ${mat || "planned"}. ${i.error}` : `Tentative, ${mat || "planned"}. In Clover's calendar; the customer got the date by email.`}>
          {actions}
        </Step>
      );
    default:
      return <Step state="now" title={`Install planned · ${when}`} sub="Earliest date after the materials wait. Booking it in Clover…" />;
  }
}

/** Main area for an estimate that has been approved (in progress, failed, test run or sent). */
export function StatusBody({ id, data }: { id: string; data: StatusData }) {
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const last = data.screenshots[data.screenshots.length - 1];
  const shot = last && <a href={last} target="_blank" className="text-sm font-semibold text-brand underline">See what Clover showed</a>;

  if (data.status === "needs_login" || (data.status === "approved" && data.signInOpen))
    return (
      <section className={`${card} flex flex-col gap-3 p-[18px]`}>
        <p className="text-[17px] font-bold text-warn">Waiting for a Clover sign-in</p>
        <p className="text-sm leading-relaxed">Your estimate is saved. It goes into Clover as soon as you sign in. Nothing has been sent yet.</p>
        <a href="/clover" className={btnPrimary}>Sign in to Clover</a>
      </section>
    );

  if (data.status === "approved" || data.status === "sending")
    return (
      <section className={`${card} flex items-center gap-3 p-[18px]`}>
        <span aria-hidden="true" className="h-6 w-6 shrink-0 animate-spin rounded-full border-[3px] border-brand-soft border-t-brand" />
        <div>
          <p className="text-[15px] font-semibold">Putting it into Clover</p>
          <p className="text-[13px] text-muted">About a minute. You can leave this screen.</p>
        </div>
      </section>
    );

  if (data.status === "needs_code")
    return (
      <section className={`${card} flex flex-col gap-3 p-[18px]`}>
        <p className="text-[17px] font-bold text-warn">Clover sent a verification code</p>
        <p className="text-sm">Check the email or phone on the Clover login and type it here.</p>
        {codeSent ? <p className="text-sm">Got it, continuing…</p> : (
          <div className="flex gap-2">
            <label htmlFor="code" className="sr-only">Code</label>
            <input id="code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code"
              className="h-[52px] min-w-0 flex-1 rounded-[14px] border border-edge px-3 text-lg tracking-widest" />
            <button className="h-[52px] rounded-[14px] bg-brand px-5 font-semibold text-white" onClick={async () => {
              const r = await fetch(`/api/estimates/${id}/code`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
              if (r.ok) setCodeSent(true);
            }}>Send</button>
          </div>
        )}
      </section>
    );

  if (data.status === "failed") {
    const maybe = mayHaveSent(data.error);
    const why = (data.error ?? "Clover didn't take it.").replace(NOTHING_SENT, "");
    return (
      <section className="flex flex-col gap-3.5 rounded-[18px] border border-[#F1C9C3] bg-bad-soft p-[18px]">
        <div className="flex items-start gap-3">
          <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#A3261B" strokeWidth="2" strokeLinecap="round" className="mt-0.5 shrink-0"><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5v.01" /></svg>
          <div className="flex flex-col gap-1.5">
            <p className="text-[17px] font-bold text-bad">{maybe ? "It may have gone out. Check Clover first." : `Not sent. ${firstName(data)} got nothing.`}</p>
            <p className="text-sm leading-relaxed">{why}</p>
          </div>
        </div>
        <div className="flex flex-col gap-1 rounded-xl bg-white px-3.5 py-3">
          <SectionLabel>What to do</SectionLabel>
          <p className="text-sm leading-snug">
            {maybe
              ? "Open the Estimates tab in Clover. If the estimate is there, don't try again: it already went out."
              : "Tap Try again below. It's safe: nothing was sent to the customer."}
          </p>
        </div>
        {shot}
      </section>
    );
  }

  if (isDry(data))
    return (
      <section className={`${card} flex flex-col gap-2 p-[18px]`}>
        <p className="text-[15px] font-semibold">Test run done. Nothing went to the customer.</p>
        {data.error?.includes("test lock") && <p className="text-[13px] text-muted">The test lock is on: only your own test contacts get real estimates.</p>}
        {shot}
      </section>
    );

  if (data.status === "sent") {
    const c = data.estimate?.customer;
    const how = data.estimate?.delivery === "both" ? "email and text" : data.estimate?.delivery === "sms" ? "text" : "email";
    const note = data.error && !data.error.startsWith("dry run") ? data.error : null;
    const invoices = data.invoices ?? [];
    return (
      <section className={`${card} px-[18px] pb-0.5 pt-[18px]`}>
        <Step state="done" title={`Estimate sent${data.cloverEstimateNumber ? ` · #${data.cloverEstimateNumber}` : ""}`}
          sub={`${data.sentAt ? `${fmtWhen(data.sentAt)} · ` : ""}by ${how}`}>
          {note && <p className="text-[13px] text-warn">{note}</p>}
        </Step>
        {data.acceptedAt
          ? <Step state="done" title="Customer accepted" sub={fmtWhen(data.acceptedAt)} />
          : <Step state="now" title="Waiting for the customer to accept" sub="Checked every few minutes" />}
        {invoices.map((inv) => (
          <div key={inv.kind}>
            {invoiceStep(inv, !!data.acceptedAt, c?.name, c?.phone)}
            {inv.kind === "deposit" && data.install && <InstallStep id={id} i={data.install} />}
          </div>
        ))}
        {invoices.length > 0 && invoices.every((i) => i.status === "paid_in_person" || i.status === "paid") && <Step state="done" title="All paid" />}
      </section>
    );
  }
  return null;
}

/** The invoice the merchant would act on next: deposit first, then balance. */
export function nextInvoice(data: StatusData): InvoiceInfo | null {
  if (data.status !== "sent" || isDry(data)) return null;
  return (data.invoices ?? []).find((i) => i.status === "waiting" || i.status === "failed") ?? null;
}

/** Bottom bar for an approved estimate: Try again, or the next invoice's Paid in person / Send. */
export function StatusActions({ id, data, onRetry }: { id: string; data: StatusData; onRetry: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  if (data.status === "failed")
    return <button onClick={onRetry} className={mayHaveSent(data.error) ? btnSecondary : btnDanger}>Try again</button>;
  const inv = nextInvoice(data);
  if (!inv) return null;
  async function act(action: "send" | "in_person") {
    if (!inv) return;
    if (action === "in_person" && !confirm(`Mark the ${money(inv.totalCents)} ${inv.kind} as collected in person? No invoice will be sent.`)) return;
    setBusy(true); setMsg("");
    const r = await fetch(`/api/estimates/${id}/invoices`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: inv.kind, action }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    setMsg(r.ok ? (action === "send" ? "On its way…" : "Marked as paid in person.") : j.error ?? "That didn't work. Try again.");
  }
  const sendLabel = inv.status === "failed" ? "Try again"
    : inv.kind === "deposit" ? (data.acceptedAt ? "Send deposit" : "Send deposit now") : "Send balance";
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2.5">
        <button disabled={busy} onClick={() => act("in_person")} className={btnSecondary}>Paid in person</button>
        <button disabled={busy} onClick={() => act("send")} className={btnPrimary}>{busy ? "Working…" : sendLabel}</button>
      </div>
      {msg && <p className="text-center text-[13px] text-muted">{msg}</p>}
    </div>
  );
}
