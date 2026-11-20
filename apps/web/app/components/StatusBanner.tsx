"use client";
import { useState } from "react";

export interface InvoiceInfo { kind: "deposit" | "balance"; status: string; totalCents: number; payLink: string | null; error: string | null }
export interface StatusData {
  sentForReal?: boolean; acceptedAt?: string | null; invoices?: InvoiceInfo[];
  estimate?: { customer?: { name?: string; phone?: string } } | null;
  status: string; signInOpen?: boolean; error: string | null; cloverEstimateNumber: string | null; screenshots: string[];
}

export default function StatusBanner({ id, data, onRetry }: { id: string; data: StatusData; onRetry: () => void }) {
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const last = data.screenshots[data.screenshots.length - 1];

  if (data.status === "needs_login" || (data.status === "approved" && data.signInOpen))
    return (
      <div className="rounded-xl bg-amber-50 p-4 text-amber-900">
        <p className="font-semibold">Waiting for you to sign in to Clover</p>
        <p className="text-sm">Your estimate is saved and goes into Clover right after you sign in.</p>
        <a href="/clover" className="mt-2 inline-block rounded-lg bg-amber-700 px-4 py-2 font-semibold text-white">Finish signing in</a>
      </div>
    );

  if (data.status === "approved" || data.status === "sending")
    return <div className="rounded-xl bg-blue-50 p-4 text-blue-900">Putting it into Clover… this takes about a minute.</div>;

  if (data.status === "needs_code")
    return (
      <div className="rounded-xl bg-amber-50 p-4 text-amber-900">
        <p className="font-semibold">Clover sent a verification code</p>
        <p className="text-sm">Check the email or phone on the Clover login and type it here.</p>
        {sent ? <p className="mt-2 text-sm">Got it, continuing…</p> : (
          <div className="mt-2 flex gap-2">
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code"
              className="flex-1 rounded-lg border border-amber-300 bg-white px-3 py-2 text-lg tracking-widest" />
            <button className="rounded-lg bg-amber-700 px-4 font-semibold text-white" onClick={async () => {
              const r = await fetch(`/api/estimates/${id}/code`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
              if (r.ok) setSent(true);
            }}>Send</button>
          </div>
        )}
      </div>
    );

  if (data.status === "sent" && data.sentForReal)
    return (
      <div className="space-y-3">
        <div className="rounded-xl bg-green-50 p-4 text-green-900">
          <p className="font-semibold">Sent ✓{data.cloverEstimateNumber ? ` · Clover estimate #${data.cloverEstimateNumber}` : ""}</p>
          {data.error && <p className="text-sm">{data.error}</p>}
          <p className="mt-1 text-sm">
            {data.acceptedAt
              ? `Accepted by the customer ${new Date(data.acceptedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ✓`
              : "Waiting for the customer to accept (checked every few minutes)."}
          </p>
          {last && <a href={last} target="_blank" className="text-sm underline">See screenshot</a>}
        </div>
        {(data.invoices ?? []).map((inv) => <InvoiceRow key={inv.kind} id={id} inv={inv} accepted={!!data.acceptedAt} phone={data.estimate?.customer?.phone} name={data.estimate?.customer?.name} />)}
      </div>
    );

  if (data.status === "sent")
    return (
      <div className="rounded-xl bg-green-50 p-4 text-green-900">
        <p className="font-semibold">{data.error?.startsWith("dry run") ? "Test run done (not sent to customer)" : "Sent ✓"}</p>
        {data.cloverEstimateNumber && <p className="text-sm">Clover estimate #{data.cloverEstimateNumber}</p>}
        {data.error && !data.error.startsWith("dry run") && <p className="text-sm">{data.error}</p>}
        {data.error?.includes("test lock") && <p className="text-sm">Test lock is on: only your test contacts get real estimates.</p>}
        {last && <a href={last} target="_blank" className="text-sm underline">See screenshot</a>}
      </div>
    );

  if (data.status === "failed")
    return (
      <div className="rounded-xl bg-red-50 p-4 text-red-900">
        <p className="font-semibold">Didn&apos;t go through</p>
        <p className="text-sm">{data.error}</p>
        <div className="mt-2 flex gap-3">
          {last && <a href={last} target="_blank" className="text-sm underline">Screenshot</a>}
          <button onClick={onRetry} className="text-sm font-semibold underline">Try again</button>
        </div>
      </div>
    );
  return null;
}

const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function InvoiceRow({ id, inv, accepted, phone, name }: { id: string; inv: InvoiceInfo; accepted: boolean; phone?: string; name?: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const title = inv.kind === "deposit" ? "Deposit invoice" : "Balance invoice";
  async function act(action: "send" | "in_person") {
    if (action === "in_person" && !confirm(`Mark the ${money(inv.totalCents)} ${inv.kind} as collected in person on your Clover? No invoice will be sent.`)) return;
    setBusy(true); setMsg("");
    const r = await fetch(`/api/estimates/${id}/invoices`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: inv.kind, action }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    setMsg(r.ok ? (action === "send" ? "On its way…" : "Marked as paid in person.") : j.error ?? "Didn't work, try again.");
  }
  const status =
    inv.status === "sent" ? "Sent by email ✓" :
    inv.status === "sending" || inv.status === "approved" ? "Putting it into Clover…" :
    inv.status === "paid_in_person" ? "Collected in person ✓" :
    inv.status === "failed" ? "Didn't go through" : "Not sent yet";
  const sms = phone && inv.payLink
    ? `sms:${phone.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(`Hi ${name?.split(" ")[0] ?? ""}, here's your ${inv.kind} invoice: ${inv.payLink}`)}`
    : null;
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="flex items-baseline justify-between">
        <p className="font-semibold">{title}</p>
        <p className="font-semibold tabular-nums">{money(inv.totalCents)}</p>
      </div>
      <p className={`text-sm ${inv.status === "failed" ? "text-red-700" : "text-neutral-600"}`}>{status}</p>
      {inv.error && <p className="text-sm text-neutral-600">{inv.error}</p>}
      {(inv.status === "waiting" || inv.status === "failed") && (
        <div className="mt-3 flex gap-2">
          <button disabled={busy} onClick={() => act("send")}
            className="flex-1 rounded-lg bg-green-800 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            {inv.status === "failed" ? "Try again" : inv.kind === "deposit" ? (accepted ? "Send deposit" : "Send deposit now") : "Send balance"}
          </button>
          <button disabled={busy} onClick={() => act("in_person")}
            className="flex-1 rounded-lg border border-neutral-300 py-2.5 text-sm font-semibold disabled:opacity-50">Paid in person</button>
        </div>
      )}
      {sms && <a href={sms} className="mt-2 inline-block text-sm font-semibold text-green-800 underline">Text the payment link</a>}
      {msg && (inv.status === "waiting" || inv.status === "failed") && <p className="mt-2 text-sm text-neutral-600">{msg}</p>}
    </div>
  );
}
