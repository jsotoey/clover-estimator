"use client";
import { useEffect, useMemo, useState } from "react";
import { TopBar, BottomNav, ConnectionPill, SectionLabel, Avatar, card, heroCard, money } from "./ui";
import StoreSwitcher from "./StoreSwitcher";
import { describe, type RecentItem } from "./EstimateList";
import { initials } from "@/lib/stage";
import { cloverHealth } from "@/lib/cloverHealth";

const TZ = "America/New_York";
interface Visit { id: string; starts_at: string; minutes: number; first_name: string; last_name: string; phone: string; street: string; city: string; zip: string; project_type: string; status: string }
interface Install { id: string; estimate_id: string; date: string; status: string; crew: string | null; time: string | null; customer: string | null; address: string | null }
type Item = { key: string; at: number; day: string; time: string; who: string; what: string; where: string; kind: "visit" | "install"; href: string; phone?: string; visitId?: string; problem: boolean };

const dayKey = (t: number) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
const clock = (t: number) => new Date(t).toLocaleString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const dayLabel = (k: string, today: string) => {
  const tomorrow = dayKey(Date.parse(`${today}T12:00:00Z`) + 86400_000);
  if (k === today) return "Today";
  if (k === tomorrow) return "Tomorrow";
  return new Date(`${k}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
};
/** "9:00 AM" → minutes after midnight, for ordering installs against visits. */
const clockToMin = (s: string | null) => {
  const m = /(\d+):(\d+)\s*(AM|PM)/i.exec(s ?? "");
  return m ? ((+m[1] % 12) + (m[3].toUpperCase() === "PM" ? 12 : 0)) * 60 + +m[2] : 9 * 60;
};

export default function TodayView({ businessName, admin }: { businessName: string; admin: boolean }) {
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [installs, setInstalls] = useState<Install[]>([]);
  const [estimates, setEstimates] = useState<RecentItem[] | null>(null);
  const [clover, setClover] = useState<"on" | "off" | "unknown">("unknown");
  const [alert, setAlert] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const [b, e, c] = await Promise.all([
        fetch("/api/bookings", { cache: "no-store" }).catch(() => null),
        fetch("/api/estimates", { cache: "no-store" }).catch(() => null),
        fetch("/api/clover-login", { cache: "no-store" }).catch(() => null),
      ]);
      if (b?.status === 401 || e?.status === 401) return location.reload();
      if (b?.ok) { const j = await b.json(); setVisits(j.bookings); setInstalls(j.installs ?? []); }
      if (e?.ok) setEstimates((await e.json()).estimates);
      if (c?.ok) {
        const j = await c.json();
        const h = cloverHealth(j);
        setAlert(h.problem);
        setClover(h.state);
      }
    };
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  const now = Date.now();
  const today = dayKey(now);

  const items = useMemo<Item[]>(() => {
    const v: Item[] = (visits ?? []).filter((x) => x.status !== "cancelled" && Date.parse(x.starts_at) + x.minutes * 60_000 >= now).map((x) => {
      const at = Date.parse(x.starts_at);
      return {
        key: `v${x.id}`, at, day: dayKey(at), time: clock(at), who: `${x.first_name} ${x.last_name}`, what: `Free measure · ${x.project_type}`,
        where: `${x.street}, ${x.city}`, kind: "visit", href: "/visits", phone: x.phone, visitId: x.id, problem: x.status === "failed",
      };
    });
    const i: Item[] = installs.filter((x) => x.date >= today).map((x) => ({
      key: `i${x.id}`, at: Date.parse(`${x.date}T00:00:00Z`) + clockToMin(x.time) * 60_000 + 5 * 3600_000, day: x.date, time: x.time ?? "Install",
      who: x.customer ?? "Customer", what: `Install${x.crew ? ` · ${x.crew}` : ""}`, where: x.address?.split(",").slice(0, 2).join(",") ?? "",
      kind: "install", href: `/estimates?id=${x.estimate_id}`, problem: x.status === "failed",
    }));
    return [...v, ...i].sort((a, b) => a.at - b.at);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visits, installs, today]);

  const rows = useMemo(() => (estimates ?? []).map((r) => ({ r, d: describe(r) })), [estimates]);
  const needs = rows.filter((x) => x.d.group === "needs");
  const waitingAccept = rows.filter((x) => x.d.group === "waiting" && !x.r.accepted_at).length;
  const owed = rows.filter((x) => x.r.accepted_at && x.d.group !== "paid").reduce((s, x) => s + (x.r.total_cents ?? 0), 0);
  const todayCount = items.filter((x) => x.day === today).length;
  // Failed visits sit under Needs you; Next up is only work that's really on the calendar.
  const onCal = items.filter((x) => !x.problem);
  const next = onCal[0];
  const later = onCal.slice(1, 6);
  const failedVisits = (visits ?? []).filter((x) => x.status === "failed" && Date.parse(x.starts_at) >= now);

  const hour = Number(new Date().toLocaleString("en-US", { timeZone: TZ, hour: "numeric", hour12: false }));
  const hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const dateLine = new Date().toLocaleDateString("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric" });
  const loading = visits === null || estimates === null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-paper">
      <TopBar title={hello} business={<StoreSwitcher name={businessName} admin={admin} />} right={<ConnectionPill state={clover} />} />
      <div className="flex flex-1 flex-col gap-5 px-4 pb-6 pt-1">
        <p className="-mt-2 text-[15px] text-muted">{dateLine}</p>

        {alert && (
          <a href="/clover" role="alert" className="flex items-center gap-3 rounded-[20px] bg-bad-soft px-4 py-3.5 text-bad">
            <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9L2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
            <span className="flex-1 text-[14px] font-semibold leading-snug">{alert}</span>
            <span className="shrink-0 text-[13px] font-bold underline">Fix</span>
          </a>
        )}

        <div className="grid grid-cols-3 gap-2.5">
          {[
            { n: String(todayCount), l: todayCount === 1 ? "Job today" : "Jobs today", href: "/visits" },
            { n: String(waitingAccept), l: "Awaiting a yes", href: "/estimates" },
            { n: owed ? money(owed).replace(/\.\d\d$/, "") : "$0", l: "Accepted, unpaid", href: "/estimates" },
          ].map((s) => (
            <a key={s.l} href={s.href} className={`${card} flex flex-col gap-1 px-3 py-3.5`}>
              <span className="truncate font-display text-[22px] font-bold tabular-nums leading-none">{loading ? "–" : s.n}</span>
              <span className="text-[12px] font-medium leading-tight text-muted">{s.l}</span>
            </a>
          ))}
        </div>

        <section className="flex flex-col gap-2.5">
          <SectionLabel>Next up</SectionLabel>
          {next ? (
            <div className={`${heroCard} flex flex-col gap-4 p-5`}>
              <div className="flex items-center justify-between gap-3">
                <span className={`rounded-full px-2.5 py-1 text-[12px] font-bold ${next.kind === "install" ? "bg-[#2B5FA8]/40 text-[#CFE0F7]" : "bg-[#1F6B45]/60 text-[#BFE6CF]"}`}>
                  {next.kind === "install" ? "Install" : "Visit"}
                </span>
                <span className="text-[13px] font-semibold text-white/70">{dayLabel(next.day, today)} · {next.time}</span>
              </div>
              <div className="flex flex-col gap-1">
                <p className="font-display text-[24px] font-bold leading-tight">{next.who.replace(/\s+TEST$/i, "")}</p>
                <p className="text-[14px] text-white/70">{next.what}</p>
                {next.where && <p className="text-[14px] text-white/70">{next.where}</p>}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <a href={`https://maps.google.com/?q=${encodeURIComponent(next.where)}`} target="_blank" rel="noreferrer"
                  className="flex h-11 items-center justify-center rounded-xl bg-white/10 text-[14px] font-semibold">Map</a>
                {next.phone
                  ? <a href={`tel:${next.phone.replace(/\D/g, "")}`} className="flex h-11 items-center justify-center rounded-xl bg-white/10 text-[14px] font-semibold">Call</a>
                  : <a href={next.href} className="flex h-11 items-center justify-center rounded-xl bg-white/10 text-[14px] font-semibold">Details</a>}
                {next.visitId
                  ? <a href={`/new?visit=${next.visitId}`} className="flex h-11 items-center justify-center rounded-xl bg-white text-[14px] font-semibold text-ink">Estimate</a>
                  : <a href={next.href} className="flex h-11 items-center justify-center rounded-xl bg-white text-[14px] font-semibold text-ink">Open</a>}
              </div>
            </div>
          ) : (
            <div className={`${card} p-5 text-[15px] text-muted`}>{loading ? "Loading…" : "Nothing on the calendar yet."}</div>
          )}
        </section>

        <section className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between">
            <SectionLabel>Needs you</SectionLabel>
            {needs.length > 0 && <a href="/estimates" className="text-[13px] font-semibold text-brand">See all</a>}
          </div>
          {!loading && needs.length === 0 && failedVisits.length === 0 && (
            <div className={`${card} flex items-center gap-3 p-4`}>
              <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-soft text-brand">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-10" /></svg>
              </span>
              <p className="text-[15px] font-medium">All caught up.</p>
            </div>
          )}
          <div className="flex flex-col gap-2">
            {failedVisits.slice(0, 3).map((v) => (
              <a key={v.id} href="/visits" className={`${card} flex items-center gap-3 p-3.5`}>
                <Avatar text={initials(`${v.first_name} ${v.last_name}`)} tone="bad" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[15px] font-semibold">{v.first_name} {v.last_name}</span>
                  <span className="truncate text-[13px] text-bad">Visit isn&apos;t on the Clover calendar</span>
                </span>
              </a>
            ))}
            {needs.slice(0, 5).map(({ r, d }) => (
              <a key={r.id} href={`/estimates?id=${r.id}`} className={`${card} flex items-center gap-3 p-3.5`}>
                <Avatar text={initials(r.customer)} tone={d.tone === "bad" ? "bad" : "good"} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[15px] font-semibold">{r.customer ?? "Estimate"}</span>
                  <span className={`truncate text-[13px] ${d.tone === "bad" ? "text-bad" : "text-muted"}`}>{d.sub}</span>
                </span>
                {r.total_cents != null && <span className="shrink-0 text-[15px] font-bold tabular-nums">{money(r.total_cents)}</span>}
              </a>
            ))}
          </div>
        </section>

        {later.length > 0 && (
          <section className="flex flex-col gap-2.5">
            <div className="flex items-baseline justify-between">
              <SectionLabel>Coming up</SectionLabel>
              <a href="/visits" className="text-[13px] font-semibold text-brand">Calendar</a>
            </div>
            <div className={`${card} divide-y divide-line/70 overflow-hidden`}>
              {later.map((x) => (
                <a key={x.key} href={x.href} className="flex items-center gap-3 px-4 py-3">
                  <span aria-hidden="true" className={`h-9 w-1 shrink-0 rounded-full ${x.problem ? "bg-bad" : x.kind === "install" ? "bg-[#2B5FA8]" : "bg-brand"}`} />
                  <span className="flex w-[76px] shrink-0 flex-col">
                    <span className="text-[13px] font-semibold">{dayLabel(x.day, today)}</span>
                    <span className="text-[12px] text-muted">{x.time}</span>
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[15px] font-semibold">{x.who.replace(/\s+TEST$/i, "")}</span>
                    <span className="truncate text-[13px] text-muted">{x.what}</span>
                  </span>
                </a>
              ))}
            </div>
          </section>
        )}
      </div>
      <BottomNav active="today" />
    </main>
  );
}
