"use client";
import { formatCents, type Estimate, type PricingResult } from "@ce/core";

const fmtDate = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const fmtLong = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const today = () => new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export const CHANGE_CHOICES = ["Price or work", "Dates", "Deposit", "Customer info"];

/** The estimate as the customer will get it: a finished document, then Approve or Edit. */
export default function ReviewCard({ estimate, computed, photos, onApprove, onEdit, busy, businessName, taxRate, readOnly }: {
  estimate: Estimate; computed: PricingResult; photos: string[];
  onApprove: () => void; onEdit: (what: string) => void; busy: boolean;
  businessName: string; taxRate: number; readOnly?: boolean;
}) {
  const c = estimate.customer;
  const sameDay = estimate.service_date === estimate.completion_date;
  const sendBy = estimate.delivery === "both" ? "email and text" : estimate.delivery === "sms" ? "text" : "email";
  const taxPct = `${+(taxRate * 100).toFixed(3)}%`;

  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
      <div className="flex items-start justify-between bg-green-900 px-5 py-4 text-white">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-green-200">Estimate</p>
          <p className="mt-0.5 text-lg font-semibold">{businessName || "Your business"}</p>
        </div>
        <div className="text-right text-xs text-green-100">
          <p>Issued {today()}</p>
          <p>Valid until {fmtLong(estimate.expiration_date)}</p>
        </div>
      </div>

      <div className="space-y-5 px-5 py-4 text-sm">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Prepared for</p>
            <p className="mt-1 font-medium">{c.name}</p>
            <p className="break-all text-neutral-600">{c.email}</p>
            {c.phone && <p className="text-neutral-600">{c.phone}</p>}
          </div>
          {c.job_address && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Job site</p>
              <p className="mt-1 text-neutral-700">{c.job_address}</p>
            </div>
          )}
        </div>

        <div>
          <div className="flex justify-between border-b border-neutral-200 pb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
            <span>Description</span><span>Amount</span>
          </div>
          {computed.lines.map((l, i) => (
            <div key={i} className="flex justify-between gap-4 border-b border-neutral-100 py-2">
              <span>{l.description}</span><span className="tabular-nums">{formatCents(l.priceCents)}</span>
            </div>
          ))}
          <div className="ml-auto mt-2 w-3/4 space-y-1">
            <div className="flex justify-between text-neutral-600"><span>Subtotal</span><span className="tabular-nums">{formatCents(computed.subtotalCents)}</span></div>
            {estimate.taxable && (
              <div className="flex justify-between text-neutral-600"><span>Sales tax ({taxPct})</span><span className="tabular-nums">{formatCents(computed.taxCents)}</span></div>
            )}
            <div className="flex justify-between border-t border-neutral-300 pt-1 text-base font-semibold"><span>Total</span><span className="tabular-nums">{formatCents(computed.totalCents)}</span></div>
          </div>
        </div>

        <div className="rounded-xl bg-neutral-50 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Payment schedule</p>
          {computed.depositCents > 0 ? (
            <>
              <div className="mt-2 flex justify-between">
                <span>Deposit ({estimate.deposit_percent}%), due {fmtDate(estimate.deposit_due_date)}</span>
                <span className="font-semibold tabular-nums">{formatCents(computed.depositCents)}</span>
              </div>
              <div className="mt-1 flex justify-between text-neutral-600">
                <span>Balance, due on completion</span><span className="tabular-nums">{formatCents(computed.balanceCents)}</span>
              </div>
            </>
          ) : (
            <div className="mt-2 flex justify-between">
              <span>Full payment, due on completion</span>
              <span className="font-semibold tabular-nums">{formatCents(computed.balanceCents)}</span>
            </div>
          )}
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Schedule</p>
          <p className="mt-1">{sameDay ? fmtDate(estimate.service_date) : `${fmtDate(estimate.service_date)} to ${fmtDate(estimate.completion_date)}`}</p>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Notes</p>
          <p className="mt-1 text-neutral-700">{estimate.note}</p>
        </div>

        {photos.length > 0 && (
          <div className="flex gap-2">
            {photos.map((p) => <img key={p} src={p} alt="" className="h-16 w-16 rounded-lg object-cover" />)}
          </div>
        )}
      </div>

      {!readOnly && <div className="border-t border-neutral-200 bg-neutral-50 px-5 py-4">
        <button onClick={onApprove} disabled={busy} className="w-full rounded-xl bg-green-800 py-3.5 text-base font-semibold text-white disabled:opacity-50">
          {busy ? "Working…" : `Approve and send by ${sendBy}`}
        </button>
        <p className="mt-3 text-center text-xs text-neutral-500">Need a change? Tap one, or just type it below.</p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {CHANGE_CHOICES.map((w) => (
            <button key={w} onClick={() => onEdit(w)} disabled={busy}
              className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-sm">{w}</button>
          ))}
        </div>
      </div>}
    </div>
  );
}
