"use client";
import { useMemo, useState } from "react";
import { Tag, money, type Tone } from "./ui";

export type RecentItem = {
  id: string; status: string; error: string | null; number: string | null; accepted_at: string | null; updated_at: string;
  customer: string | null; total_cents: number | null; invoices: { kind: string; status: string }[];
};
type Group = "needs" | "waiting" | "paid" | "other";

/** One tag + one line of status per estimate, and which filter it belongs to. */
export function describe(r: RecentItem): { tone: Tone; tag: string; sub: string; group: Group } {
  const inv = r.invoices ?? [];
  switch (r.status) {
    case "failed": return { tone: "bad", tag: "Needs you", sub: "Didn't go through", group: "needs" };
    case "needs_login": return { tone: "bad", tag: "Needs you", sub: "Waiting for Clover sign-in", group: "needs" };
    case "approved": case "sending": return { tone: "warn", tag: "Working", sub: "Going into Clover", group: "waiting" };
    case "ready_for_review": return { tone: "plain", tag: "Draft", sub: "Ready to approve", group: "other" };
    case "drafting": return { tone: "plain", tag: "Draft", sub: "Not finished", group: "other" };
  }
  if (r.status !== "sent") return { tone: "plain", tag: r.status, sub: "", group: "other" };
  if (r.error?.startsWith("dry run")) return { tone: "plain", tag: "Test", sub: "Test run, nothing sent", group: "other" };
  if (inv.some((i) => i.status === "failed")) return { tone: "bad", tag: "Needs you", sub: "An invoice didn't go through", group: "needs" };
  if (inv.length && inv.every((i) => i.status === "paid_in_person")) return { tone: "good", tag: "Paid", sub: "Paid in person", group: "paid" };
  const sent = inv.filter((i) => i.status === "sent" || i.status === "paid_in_person");
  if (sent.length) {
    const lastSent = sent[sent.length - 1];
    return { tone: "warn", tag: "Invoiced", sub: `${lastSent.kind === "deposit" ? "Deposit" : "Balance"} invoice sent`, group: "waiting" };
  }
  if (r.accepted_at) {
    const dep = inv.find((i) => i.kind === "deposit");
    return { tone: "good", tag: "Accepted", sub: dep ? "Ready to send the deposit" : "Ready to send the invoice", group: "waiting" };
  }
  return { tone: "warn", tag: "Waiting", sub: "Waiting for the customer to accept", group: "waiting" };
}

export default function EstimateList({ items, onOpen }: { items: RecentItem[] | null; onOpen: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | Group>("all");
  const rows = useMemo(() => (items ?? []).map((r) => ({ r, d: describe(r) })), [items]);
  const count = (g: Group) => rows.filter((x) => x.d.group === g).length;
  const shown = rows.filter(({ r, d }) =>
    (filter === "all" || d.group === filter) &&
    (!q.trim() || `${r.customer ?? ""} ${r.number ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())));
  const chips: { key: "all" | Group; label: string }[] = [
    { key: "all", label: "All" },
    { key: "needs", label: `Needs you${count("needs") ? ` · ${count("needs")}` : ""}` },
    { key: "waiting", label: `Waiting${count("waiting") ? ` · ${count("waiting")}` : ""}` },
    { key: "paid", label: "Paid" },
  ];
  return (
    <div className="flex flex-col gap-3 px-4 py-3.5">
      <label htmlFor="q" className="sr-only">Search estimates</label>
      <input id="q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or number"
        className="h-11 rounded-xl border border-edge bg-white px-3.5 text-[15px]" />
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5">
        {chips.map((c) => (
          <button key={c.key} onClick={() => setFilter(c.key)} aria-pressed={filter === c.key}
            className={`h-9 shrink-0 whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold ${filter === c.key ? "bg-ink text-white" : "border border-edge bg-white text-ink"}`}>{c.label}</button>
        ))}
      </div>
      {items === null && <p className="py-6 text-center text-sm text-muted">Loading…</p>}
      {items !== null && shown.length === 0 && <p className="py-6 text-center text-sm text-muted">{items.length ? "Nothing matches." : "No estimates yet. Tap New to make one."}</p>}
      <div className="flex flex-col gap-2.5">
        {shown.map(({ r, d }) => (
          <button key={r.id} onClick={() => onOpen(r.id)}
            className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-white px-4 py-3.5 text-left">
            <span className="flex min-w-0 flex-col gap-1.5">
              <span className="truncate text-[15px] font-semibold">{r.customer ?? "No customer yet"}{r.number ? ` · #${r.number}` : ""}</span>
              <span className="flex min-w-0 items-center gap-2 text-[13px] text-muted">
                <Tag tone={d.tone}>{d.tag}</Tag>
                <span className="truncate">{d.sub}</span>
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1.5">
              <span className="text-[15px] font-bold tabular-nums">{r.total_cents != null ? money(r.total_cents) : ""}</span>
              <span className="text-xs text-muted">{new Date(r.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
