"use client";
import type { ReactNode } from "react";

/** Shared look for every screen (from the approved Nov 21 mockups). */

export const btnPrimary =
  "flex h-14 w-full shrink-0 items-center justify-center gap-2 rounded-2xl bg-brand px-4 text-base font-semibold text-white shadow-[0_6px_16px_rgba(31,107,69,.22)] transition active:scale-[.98] disabled:opacity-50 disabled:shadow-none";
export const btnSecondary =
  "flex h-14 w-full shrink-0 items-center justify-center gap-2 rounded-2xl border border-edge bg-white px-4 text-base font-semibold text-ink transition active:scale-[.98] disabled:opacity-50";
export const btnDanger =
  "flex h-14 w-full shrink-0 items-center justify-center gap-2 rounded-2xl bg-bad px-4 text-base font-semibold text-white transition active:scale-[.98] disabled:opacity-50";
/** White card: soft shadow instead of a hard border. */
export const card = "rounded-[20px] bg-white shadow-[0_1px_2px_rgba(20,24,27,.06),0_6px_20px_rgba(20,24,27,.04)]";
/** Dark hero card for "what's next". */
export const heroCard = "rounded-[22px] bg-[#14181B] text-white shadow-[0_10px_30px_rgba(20,24,27,.18)]";

/** Segmented progress bar: Sent → Accepted → Deposit → Install → Paid. */
export function Progress({ steps, done, dark, tone = "good", labels }: { steps: string[]; done: number; dark?: boolean; tone?: Tone; labels?: boolean }) {
  const on = tone === "bad" ? "bg-bad" : tone === "warn" ? "bg-[#D98A2B]" : dark ? "bg-[#7FD1A3]" : "bg-brand";
  const off = dark ? "bg-white/15" : "bg-[#E6E3DA]";
  return (
    <div className="flex flex-col gap-1.5" role="img" aria-label={`${done} of ${steps.length} steps done${done < steps.length ? `, next: ${steps[done]}` : ""}`}>
      <div className="flex gap-1">
        {steps.map((s, i) => <span key={s} className={`h-1.5 flex-1 rounded-full ${i < done ? on : off}`} />)}
      </div>
      {labels && (
        <div className="flex gap-1">
          {steps.map((s, i) => (
            <span key={s} className={`flex-1 text-[11px] font-semibold ${i < done ? (dark ? "text-white/90" : "text-ink") : dark ? "text-white/45" : "text-muted"}`}>{s}</span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Round initials badge for a customer. */
export function Avatar({ text, tone = "plain" }: { text: string; tone?: Tone }) {
  const cls = { good: "bg-brand-soft text-brand-dark", warn: "bg-warn-soft text-warn", bad: "bg-bad-soft text-bad", plain: "bg-[#ECEAE3] text-ink" }[tone];
  return <span aria-hidden="true" className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-display text-[15px] font-bold ${cls}`}>{text}</span>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">{children}</p>;
}

export type Tone = "good" | "warn" | "bad" | "plain";
const toneCls: Record<Tone, string> = {
  good: "bg-brand-soft text-brand-dark",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  plain: "bg-[#ECEAE3] text-muted",
};
export function Tag({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-[3px] text-[11px] font-bold ${toneCls[tone]}`}>{children}</span>;
}

export function TopBar({ title, business, onBack, backHref, right }: {
  title: string; business: string | ReactNode; onBack?: () => void; backHref?: string; right?: ReactNode;
}) {
  const backIcon = (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
  );
  const back = onBack
    ? <button onClick={onBack} aria-label="Back" className="-ml-2.5 flex h-11 w-11 items-center justify-center">{backIcon}</button>
    : backHref ? <a href={backHref} aria-label="Back" className="-ml-2.5 flex h-11 w-11 items-center justify-center">{backIcon}</a> : null;
  return (
    <header className="sticky top-0 z-30 flex items-center gap-1.5 bg-paper/90 px-5 pb-3 pt-[max(16px,env(safe-area-inset-top))] backdrop-blur-md">
      {back}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {typeof business === "string" ? <span className="truncate text-xs font-semibold text-muted">{business || "Your business"}</span> : business}
        <h1 className="truncate font-display text-[28px] font-bold leading-tight tracking-[-0.02em]">{title}</h1>
      </div>
      {right}
    </header>
  );
}

const NAV_ICONS = {
  today: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  list: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>,
  visits: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
  clover: <><path d="M10 14l4-4" /><path d="M8.5 11.5L6 14a3.5 3.5 0 0 0 5 5l2.5-2.5M15.5 12.5L18 10a3.5 3.5 0 0 0-5-5l-2.5 2.5" /></>,
};

/** Bottom menu, where the thumb is: Today / Estimates / + / Calendar / Clover. */
export function BottomNav({ active, onNew, onList }: { active: "today" | "new" | "list" | "visits" | "clover"; onNew?: () => void; onList?: () => void }) {
  const items = [
    { key: "today" as const, label: "Today", href: "/", on: undefined },
    { key: "list" as const, label: "Estimates", href: "/estimates", on: onList },
    { key: "new" as const, label: "New", href: "/new", on: onNew },
    { key: "visits" as const, label: "Calendar", href: "/visits", on: undefined },
    { key: "clover" as const, label: "Clover", href: "/clover", on: undefined },
  ];
  return (
    <nav aria-label="Main" className="sticky bottom-0 z-20 grid grid-cols-5 items-start border-t border-line/70 bg-white/95 pb-[max(14px,env(safe-area-inset-bottom))] pt-2 backdrop-blur-md">
      {items.map((it) => {
        const isOn = it.key === active;
        if (it.key === "new") {
          const cls = `mx-auto -mt-1 flex h-[52px] w-[52px] items-center justify-center rounded-[18px] text-white shadow-[0_6px_16px_rgba(31,107,69,.32)] transition active:scale-95 ${isOn ? "bg-brand-dark" : "bg-brand"}`;
          const inner = <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>;
          return it.on
            ? <button key={it.key} onClick={it.on} aria-label="New estimate" className={cls} aria-current={isOn ? "page" : undefined}>{inner}</button>
            : <a key={it.key} href={it.href} aria-label="New estimate" className={cls} aria-current={isOn ? "page" : undefined}>{inner}</a>;
        }
        const cls = `flex flex-col items-center gap-[3px] py-1 text-[11px] ${isOn ? "font-semibold text-brand" : "font-medium text-muted"}`;
        const inner = (
          <>
            <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={isOn ? 2 : 1.8} strokeLinecap="round" strokeLinejoin="round">{NAV_ICONS[it.key]}</svg>
            {it.label}
          </>
        );
        return it.on
          ? <button key={it.key} onClick={it.on} className={cls} aria-current={isOn ? "page" : undefined}>{inner}</button>
          : <a key={it.key} href={it.href} className={cls} aria-current={isOn ? "page" : undefined}>{inner}</a>;
      })}
    </nav>
  );
}

/** "Clover connected" / "Sign in needed" pill for the top bar. */
export function ConnectionPill({ state }: { state: "on" | "off" | "unknown" }) {
  if (state === "unknown") return null;
  return state === "on" ? (
    <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1.5 text-xs font-semibold text-brand">
      <span className="h-[7px] w-[7px] rounded-full bg-brand" />Clover connected
    </span>
  ) : (
    <a href="/clover" className="flex shrink-0 items-center gap-1.5 rounded-full bg-warn-soft px-2.5 py-1.5 text-xs font-semibold text-warn">
      <span className="h-[7px] w-[7px] rounded-full bg-warn" />Sign in needed
    </a>
  );
}

export const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const fmtDay = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

/**
 * Fixro wordmark (temporary until the final logo): the words plus a small yellow check mark.
 * "dark" = white letters on black (sign-in screen); "light" = black letters, for small footers.
 */
export function FixroMark({ variant = "dark", size = "lg" }: { variant?: "dark" | "light"; size?: "lg" | "sm" }) {
  const big = size === "lg";
  return (
    <span className={`inline-flex flex-col ${big ? "gap-1.5" : "gap-0.5"}`} aria-label="Fixro. Estimate smarter.">
      <span className="flex items-center gap-2">
        <span aria-hidden="true" className={`flex items-center justify-center rounded-[6px] bg-[#F4BE2C] ${big ? "h-7 w-7" : "h-4 w-4 rounded-[4px]"}`}>
          <svg width={big ? 16 : 10} height={big ? 16 : 10} viewBox="0 0 24 24" fill="none" stroke="#111111" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        </span>
        <span className={`font-display font-bold tracking-[0.06em] ${big ? "text-4xl" : "text-sm"} ${variant === "dark" ? "text-white" : "text-ink"}`}>FIXRO</span>
      </span>
      {big && (
        <span className={`pl-9 text-[11px] font-semibold tracking-[0.32em] ${variant === "dark" ? "text-[#F4BE2C]" : "text-[#8A6A0E]"}`}>ESTIMATE SMARTER.</span>
      )}
    </span>
  );
}
