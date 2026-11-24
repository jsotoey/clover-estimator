"use client";
import type { ReactNode } from "react";

/** Shared look for every screen (from the approved Nov 21 mockups). */

export const btnPrimary =
  "flex h-[52px] w-full shrink-0 items-center justify-center rounded-[14px] bg-brand px-4 text-base font-semibold text-white disabled:opacity-50";
export const btnSecondary =
  "flex h-[52px] w-full shrink-0 items-center justify-center rounded-[14px] border border-edge bg-white px-4 text-base font-semibold text-ink disabled:opacity-50";
export const btnDanger =
  "flex h-[52px] w-full shrink-0 items-center justify-center rounded-[14px] bg-bad px-4 text-base font-semibold text-white disabled:opacity-50";
export const card = "rounded-[18px] border border-line bg-white";

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
    <header className="sticky top-0 z-30 flex items-center gap-1.5 border-b border-line bg-paper px-5 pb-3 pt-4">
      {back}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {typeof business === "string" ? <span className="truncate text-xs font-semibold text-muted">{business || "Your business"}</span> : business}
        <h1 className="truncate font-display text-2xl font-bold">{title}</h1>
      </div>
      {right}
    </header>
  );
}

const NAV_ICONS = {
  new: <path d="M12 5v14M5 12h14" />,
  list: <><path d="M7 3h7l4 4v14H7z" /><path d="M10 12h5M10 16h5" /></>,
  visits: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></>,
  clover: <><path d="M10 14l4-4" /><path d="M8.5 11.5L6 14a3.5 3.5 0 0 0 5 5l2.5-2.5M15.5 12.5L18 10a3.5 3.5 0 0 0-5-5l-2.5 2.5" /></>,
};

/** Bottom menu, where the thumb is: New / Estimates / Visits / Clover. */
export function BottomNav({ active, onNew, onList }: { active: "new" | "list" | "visits" | "clover"; onNew?: () => void; onList?: () => void }) {
  const items = [
    { key: "new" as const, label: "New", href: "/", on: onNew },
    { key: "list" as const, label: "Estimates", href: "/?recent=1", on: onList },
    { key: "visits" as const, label: "Visits", href: "/visits", on: undefined },
    { key: "clover" as const, label: "Clover", href: "/clover", on: undefined },
  ];
  return (
    <nav aria-label="Main" className="sticky bottom-0 z-20 grid grid-cols-4 border-t border-line bg-white pb-[max(14px,env(safe-area-inset-bottom))] pt-1.5">
      {items.map((it) => {
        const isOn = it.key === active;
        const cls = `flex flex-col items-center gap-[3px] py-1.5 text-xs ${isOn ? "font-semibold text-brand" : "font-medium text-muted"}`;
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
