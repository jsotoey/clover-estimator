"use client";
import { formatCents, type Estimate, type PricingResult } from "@ce/core";
import { SectionLabel, Tag, card, fmtDay } from "./ui";

const fmtLong = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export const CHANGE_CHOICES = ["Price or work", "Dates", "Deposit", "Customer info"];

export function deliveryWords(e: Estimate) {
  return e.delivery === "both" ? "email and text" : e.delivery === "sms" ? "text" : "email";
}

/** The estimate as the customer will get it. Approve / Change live in the bottom bar. */
export default function ReviewCard({ estimate, computed, photos, businessName, taxRate, readOnly }: {
  estimate: Estimate; computed: PricingResult; photos: string[];
  businessName: string; taxRate: number; readOnly?: boolean;
}) {
  const c = estimate.customer;
  const sameDay = estimate.service_date === estimate.completion_date;
  const taxPct = `${+(taxRate * 100).toFixed(3)}%`;
  const to = [estimate.delivery !== "sms" && c.email, estimate.delivery !== "email" && c.phone].filter(Boolean).join(" and ");

  return (
    <section className={`${card} flex flex-col gap-3.5 p-[18px]`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <SectionLabel>{businessName ? `${businessName} · estimate for` : "Estimate for"}</SectionLabel>
          <p className="font-display text-xl font-bold">{c.name}</p>
          {c.job_address && <p className="text-[13px] text-muted">{c.job_address}</p>}
        </div>
        {!readOnly && <Tag tone="warn">Not sent yet</Tag>}
      </div>

      <div>
        {computed.lines.map((l, i) => (
          <div key={i} className="flex justify-between gap-4 border-b border-line py-3 text-sm leading-snug">
            <span>{l.description}</span>
            <span className="font-semibold tabular-nums">{formatCents(l.priceCents)}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1.5 text-sm">
        <div className="flex justify-between text-muted"><span>Subtotal</span><span className="tabular-nums">{formatCents(computed.subtotalCents)}</span></div>
        {estimate.taxable && (
          <div className="flex justify-between text-muted"><span>NJ sales tax ({taxPct})</span><span className="tabular-nums">{formatCents(computed.taxCents)}</span></div>
        )}
        <div className="flex justify-between border-t border-line pt-2 text-base font-bold"><span>Total</span><span className="tabular-nums">{formatCents(computed.totalCents)}</span></div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1 rounded-xl bg-paper px-3 py-2.5">
          <SectionLabel>Payment</SectionLabel>
          {computed.depositCents > 0 ? (
            <>
              <span className="text-sm font-semibold">{estimate.deposit_percent}% deposit · {formatCents(computed.depositCents)}</span>
              <span className="text-xs text-muted">Due {fmtDay(estimate.deposit_due_date)} · rest on completion</span>
            </>
          ) : <span className="text-sm font-semibold">Full, on completion</span>}
        </div>
        <div className="flex flex-col gap-1 rounded-xl bg-paper px-3 py-2.5">
          <SectionLabel>Starts</SectionLabel>
          <span className="text-sm font-semibold">{fmtDay(estimate.service_date)}</span>
          {!sameDay && <span className="text-xs text-muted">Done by {fmtDay(estimate.completion_date)}</span>}
        </div>
      </div>

      {estimate.note && <p className="text-[13px] leading-relaxed text-muted">{estimate.note}</p>}

      {photos.length > 0 && (
        <div className="flex gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {photos.map((p) => <img key={p} src={p} alt="Job photo" className="h-16 w-16 rounded-lg object-cover" />)}
        </div>
      )}

      <p className="text-[13px] text-muted">
        {readOnly ? "Sent" : "Sends"} by {deliveryWords(estimate)}{to ? ` to ${to}` : ""} · valid until {fmtLong(estimate.expiration_date)}
      </p>
    </section>
  );
}
