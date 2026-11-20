"use client";
import { formatCents, type Estimate, type PricingResult } from "@ce/core";

const fmtDate = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

export default function ReviewCard({ estimate, computed, photos, onApprove, onChange, busy }: {
  estimate: Estimate; computed: PricingResult; photos: string[];
  onApprove: () => void; onChange: () => void; busy: boolean;
}) {
  const c = estimate.customer;
  return (
    <div className="rounded-2xl border border-green-800/30 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-green-800">Review before sending</p>
      <p className="mt-2 text-lg font-semibold">{c.name}</p>
      <p className="text-sm text-neutral-500">{[c.email, c.phone].filter(Boolean).join(" · ")}{c.job_address ? ` · ${c.job_address}` : ""}</p>

      <div className="mt-3 divide-y divide-neutral-100 text-sm">
        {computed.lines.map((l, i) => (
          <div key={i} className="flex justify-between py-2"><span>{l.description}</span><span>{formatCents(l.priceCents)}</span></div>
        ))}
        <div className="flex justify-between py-2 text-neutral-500"><span>Subtotal</span><span>{formatCents(computed.subtotalCents)}</span></div>
        <div className="flex justify-between py-2 text-neutral-500"><span>Tax</span><span>{formatCents(computed.taxCents)}</span></div>
        <div className="flex justify-between py-2 text-base font-semibold"><span>Total</span><span>{formatCents(computed.totalCents)}</span></div>
        <div className="flex justify-between py-2 font-medium text-green-900">
          <span>Deposit {estimate.deposit_percent}% · due {fmtDate(estimate.deposit_due_date)}</span><span>{formatCents(computed.depositCents)}</span>
        </div>
        <div className="flex justify-between py-2 text-neutral-600"><span>Balance</span><span>{formatCents(computed.balanceCents)}</span></div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div><p className="text-neutral-500">Work</p><p>{fmtDate(estimate.service_date)} – {fmtDate(estimate.completion_date)}</p></div>
        <div><p className="text-neutral-500">Good until</p><p>{fmtDate(estimate.expiration_date)}</p></div>
        <div><p className="text-neutral-500">Send by</p><p>{estimate.delivery === "both" ? "Email + text" : estimate.delivery === "sms" ? "Text" : "Email"}</p></div>
        <div><p className="text-neutral-500">Tax</p><p>{estimate.taxable ? "Yes" : "No"}</p></div>
      </div>

      <div className="mt-3 rounded-lg bg-neutral-50 p-3 text-sm">
        <p>{estimate.note}</p>
        <p className="mt-1 text-right text-xs text-neutral-400">{estimate.note.length}/200</p>
      </div>

      {photos.length > 0 && (
        <div className="mt-3 flex gap-2">
          {photos.map((p) => <img key={p} src={p} alt="" className="h-16 w-16 rounded-lg object-cover" />)}
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button onClick={onChange} disabled={busy} className="rounded-xl border border-neutral-300 py-3 font-medium">Change something</button>
        <button onClick={onApprove} disabled={busy} className="rounded-xl bg-green-800 py-3 font-semibold text-white disabled:opacity-50">
          {busy ? "Sending…" : "Approve and send"}
        </button>
      </div>
    </div>
  );
}
