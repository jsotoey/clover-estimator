"use client";
import { useMemo, useState } from "react";
import { Avatar, Progress, money, card } from "./ui";
import { initials, installSet, stage, type Group, type Tone } from "@/lib/stage";

export type RecentItem = {
  id: string; status: string; error: string | null; number: string | null; accepted_at: string | null; updated_at: string;
  customer: string | null; total_cents: number | null; invoices: { kind: string; status: string }[];
  install?: string | null; install_date?: string | null;
};

/** One tag + one line of status per estimate, and which filter it belongs to. */
export function describe(r: RecentItem): { tone: Tone; tag: string; sub: string; group: Group; steps: string[]; done: number } {
  const s = stage({ status: r.status, error: r.error, acceptedAt: r.accepted_at, invoices: r.invoices ?? [], install: r.install ?? null });
  let sub = s.next;
  if (installSet(r.install ?? null) && r.install_date && s.group !== "paid")
    sub = `${s.next} · install ${new Date(`${r.install_date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  return { tone: s.tone, tag: s.tag, sub, group: s.group, steps: s.steps, done: s.done };
}

const tagCls: Record<Tone, string> = {
  good: "text-brand-dark", warn: "text-warn", bad: "text-bad", plain: "text-muted",
};

export default function EstimateList({ items, onOpen }: { items: RecentItem[] | null; onOpen: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | Group>("all");
  const rows = useMemo(() => (items ?? []).map((r) => ({ r, d: describe(r) })), [items]);
  const count = (g: Group) => rows.filter((x) => x.d.group === g).length;
  const shown = rows.filter(({ r, d }) =>
    (filter === "all" || d.group === filter) &&
    (!q.trim() || `${r.customer ?? ""} ${r.number ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())));
  const tabs: { key: "all" | Group; label: string; n?: number }[] = [
    { key: "all", label: "All" },
    { key: "needs", label: "Needs you", n: count("needs") },
    { key: "waiting", label: "In progress", n: count("waiting") },
    { key: "paid", label: "Paid" },
  ];
  return (
    <div className="flex flex-col gap-3.5 px-4 pb-6 pt-1">
      <div className="relative">
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
        <label htmlFor="q" className="sr-only">Search estimates</label>
        <input id="q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or number"
          className="h-12 w-full rounded-2xl bg-white pl-10 pr-3.5 text-[15px] shadow-[0_1px_2px_rgba(20,24,27,.06)] outline-none focus:ring-2 focus:ring-brand" />
      </div>
      <div role="tablist" aria-label="Filter" className="grid grid-cols-4 gap-1 rounded-2xl bg-[#ECEAE3] p-1">
        {tabs.map((t) => (
          <button key={t.key} role="tab" onClick={() => setFilter(t.key)} aria-selected={filter === t.key}
            className={`flex h-9 items-center justify-center gap-1 whitespace-nowrap rounded-xl text-[13px] font-semibold transition ${filter === t.key ? "bg-white text-ink shadow-[0_1px_3px_rgba(20,24,27,.12)]" : "text-muted"}`}>
            {t.label}
            {!!t.n && <span className={`min-w-[18px] rounded-full px-1 text-[11px] leading-[18px] ${t.key === "needs" ? "bg-bad text-white" : "bg-ink/10 text-ink"}`}>{t.n}</span>}
          </button>
        ))}
      </div>
      {items === null && <p className="py-8 text-center text-sm text-muted">Loading…</p>}
      {items !== null && shown.length === 0 && (
        <p className="py-8 text-center text-sm text-muted">{items.length ? "Nothing here right now." : "No estimates yet. Tap + to make one."}</p>
      )}
      <div className="flex flex-col gap-2.5">
        {shown.map(({ r, d }) => (
          <button key={r.id} onClick={() => onOpen(r.id)}
            className={`${card} flex flex-col gap-3 px-4 py-3.5 text-left transition active:scale-[.99]`}>
            <span className="flex w-full items-center gap-3">
              <Avatar text={initials(r.customer)} tone={d.tone === "bad" ? "bad" : d.group === "paid" ? "good" : "plain"} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[15px] font-semibold">{r.customer ?? "No customer yet"}</span>
                <span className="truncate text-[13px] text-muted">
                  {r.number ? `#${r.number} · ` : ""}{new Date(r.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              </span>
              <span className="shrink-0 font-display text-[17px] font-bold tabular-nums">{r.total_cents != null ? money(r.total_cents) : ""}</span>
            </span>
            {d.done > 0 || r.status === "sent" ? <span className="w-full"><Progress steps={d.steps} done={d.done} tone={d.tone === "bad" ? "bad" : "good"} /></span> : null}
            <span className="flex w-full items-center gap-2 text-[13px]">
              <span className={`font-semibold ${tagCls[d.tone]}`}>{d.tag}</span>
              <span className="text-muted">·</span>
              <span className="min-w-0 flex-1 truncate text-muted">{d.sub}</span>
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted"><path d="M9 6l6 6-6 6" /></svg>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
