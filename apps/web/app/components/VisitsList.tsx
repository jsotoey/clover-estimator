"use client";
import { useEffect, useMemo, useState } from "react";
import { TopBar, BottomNav, SectionLabel, Tag, card, btnSecondary, btnPrimary, type Tone } from "./ui";

interface Visit {
  id: string; starts_at: string; minutes: number; first_name: string; last_name: string; email: string; phone: string;
  street: string; unit: string | null; city: string; zip: string; project_type: string; details: string;
  status: string; error: string | null; photos: string[];
}
interface DaySlots { date: string; slots: { start: string; label: string }[] }
type View = "list" | "day" | "week" | "month";

const TZ = "America/New_York";
const STATUS: Record<string, [Tone, string]> = {
  to_book: ["warn", "Waiting to add to Clover"], booking: ["warn", "Adding to Clover"], booked: ["good", "On Clover calendar"],
  test_run: ["warn", "Not added (test)"], failed: ["bad", "Not in Clover"], cancelled: ["plain", "Cancelled"],
};
const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString("en-US", { timeZone: TZ, ...o });
const when = (iso: string) => fmt(iso, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const clock = (iso: string) => fmt(iso, { hour: "numeric", minute: "2-digit" });
/** YYYY-MM-DD in the shop's time zone. */
const dayKey = (iso: string | number) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
// Plain calendar-date math on YYYY-MM-DD (noon UTC avoids any DST edge).
const toD = (k: string) => new Date(`${k}T12:00:00Z`);
const addDays = (k: string, n: number) => { const d = toD(k); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekStart = (k: string) => addDays(k, -toD(k).getUTCDay()); // Sunday
const label = (k: string, o: Intl.DateTimeFormatOptions) => toD(k).toLocaleDateString("en-US", { timeZone: "UTC", ...o });

/** Visits customers booked on the store's booking page: a list, or a day / week / month calendar. */
export default function VisitsList({ businessName }: { businessName: string }) {
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [view, setView] = useState<View>("week");
  const [focus, setFocus] = useState(() => dayKey(Date.now()));
  const [moving, setMoving] = useState<string | null>(null);

  async function load() {
    const r = await fetch("/api/bookings", { cache: "no-store" });
    if (!r.ok) { setMsg("Couldn't load visits. Pull to refresh."); return; }
    const j = await r.json();
    setVisits(j.bookings);
    setUrl(j.bookingUrl);
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, []);

  async function act(id: string, action: "retry" | "cancel") {
    if (action === "cancel" && !confirm("Cancel this visit? This frees the time on your booking page. If it's on the Clover calendar, remove it there too.")) return;
    const r = await fetch(`/api/bookings/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? (action === "retry" ? "Trying again…" : "Visit cancelled.") : j.error ?? "That didn't work.");
    load();
  }

  const active = useMemo(() => (visits ?? []).filter((v) => v.status !== "cancelled"), [visits]);
  const byDay = useMemo(() => {
    const m = new Map<string, Visit[]>();
    for (const v of active) { const k = dayKey(v.starts_at); m.set(k, [...(m.get(k) ?? []), v]); }
    for (const l of m.values()) l.sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
    return m;
  }, [active]);

  const now = Date.now();
  const upcoming = visits?.filter((v) => Date.parse(v.starts_at) >= now - 3600_000) ?? [];
  const past = visits?.filter((v) => Date.parse(v.starts_at) < now - 3600_000) ?? [];
  const today = dayKey(now);

  const details = (v: Visit) => {
    const addr = `${v.street}${v.unit ? `, ${v.unit}` : ""}, ${v.city} ${v.zip}`;
    return (
      <div className="mt-3 flex flex-col gap-3 border-t border-line pt-3 text-sm">
        <p className="whitespace-pre-wrap">{v.details}</p>
        {v.photos.length > 0 && (
          <div className="flex gap-2">
            {v.photos.map((p) => (
              <a key={p} href={p} target="_blank" rel="noreferrer" className="h-20 w-20 overflow-hidden rounded-xl border border-line">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p} alt="Customer photo" className="h-full w-full object-cover" />
              </a>
            ))}
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          <a className={btnSecondary} href={`tel:${v.phone.replace(/\D/g, "")}`}>Call</a>
          <a className={btnSecondary} href={`sms:${v.phone.replace(/\D/g, "")}`}>Text</a>
          <a className={btnSecondary} href={`https://maps.google.com/?q=${encodeURIComponent(addr)}`} target="_blank" rel="noreferrer">Map</a>
        </div>
        <p className="text-muted">{v.phone} · {v.email}</p>
        {v.error && <p className="rounded-xl bg-bad-soft p-2.5 text-bad">{v.error}</p>}
        {moving === v.id ? (
          <Reschedule visit={v} onDone={(m) => { setMoving(null); if (m) setMsg(m); load(); }} />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {(v.status === "failed" || v.status === "test_run") && <button className={`${btnSecondary} col-span-2`} onClick={() => act(v.id, "retry")}>Try again</button>}
            {v.status !== "cancelled" && v.status !== "booking" && <>
              <button className={btnSecondary} onClick={() => setMoving(v.id)}>Reschedule</button>
              <button className={btnSecondary} onClick={() => act(v.id, "cancel")}>Cancel visit</button>
            </>}
          </div>
        )}
      </div>
    );
  };

  const row = (v: Visit, timeOnly = false) => {
    const [tone, tag] = STATUS[v.status] ?? ["plain", v.status];
    const isOpen = open === v.id;
    return (
      <li key={v.id} className={`${card} p-4 ${v.status === "cancelled" ? "opacity-60" : ""}`}>
        <button className="flex w-full items-start justify-between gap-3 text-left" onClick={() => { setOpen(isOpen ? null : v.id); setMoving(null); }} aria-expanded={isOpen}>
          <div className="min-w-0">
            <p className="font-display text-lg font-bold leading-tight">{timeOnly ? `${clock(v.starts_at)} – ${clock(new Date(Date.parse(v.starts_at) + v.minutes * 60_000).toISOString())}` : when(v.starts_at)}</p>
            <p className="truncate font-semibold">{v.first_name} {v.last_name} · {v.project_type}</p>
            <p className="truncate text-sm text-muted">{v.street}, {v.city}</p>
          </div>
          <Tag tone={tone}>{tag}</Tag>
        </button>
        {isOpen && details(v)}
      </li>
    );
  };

  const step = (n: number) => setFocus((f) => (view === "month"
    ? (() => { const d = toD(f); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); })()
    : addDays(f, view === "week" ? 7 * n : n)));
  const title = view === "month" ? label(focus, { month: "long", year: "numeric" })
    : view === "week" ? `${label(weekStart(focus), { month: "short", day: "numeric" })} – ${label(addDays(weekStart(focus), 6), { month: "short", day: "numeric" })}`
    : label(focus, { weekday: "long", month: "short", day: "numeric" });

  const dayList = (k: string, compact = false) => {
    const list = byDay.get(k) ?? [];
    return (
      <section key={k} className="flex flex-col gap-2">
        <button onClick={() => { setFocus(k); setView("day"); }} className={`flex items-baseline justify-between text-left ${k === today ? "text-brand" : ""}`}>
          <span className="font-semibold">{label(k, { weekday: "long", month: "short", day: "numeric" })}{k === today ? " · Today" : ""}</span>
          <span className="text-sm text-muted">{list.length ? `${list.length} visit${list.length > 1 ? "s" : ""}` : "Open"}</span>
        </button>
        {list.length > 0 && <ul className="flex flex-col gap-2">{list.map((v) => row(v, true))}</ul>}
        {!compact && !list.length && <p className="text-sm text-muted">Nothing booked.</p>}
      </section>
    );
  };

  const month = () => {
    const first = (() => { const d = toD(focus); d.setUTCDate(1); return d.toISOString().slice(0, 10); })();
    const start = weekStart(first);
    const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
    const m = first.slice(0, 7);
    return (
      <div className={`${card} p-2`}>
        <div className="grid grid-cols-7 text-center text-xs font-semibold text-muted">
          {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i} className="py-1">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((k) => {
            const n = byDay.get(k)?.length ?? 0;
            const inMonth = k.slice(0, 7) === m;
            return (
              <button key={k} onClick={() => { setFocus(k); setView("day"); }}
                className={`flex aspect-square flex-col items-center justify-center rounded-xl text-sm ${inMonth ? "" : "text-muted/50"} ${k === today ? "ring-2 ring-brand" : ""} ${n ? "bg-brand-soft font-semibold text-brand" : ""}`}>
                {Number(k.slice(8))}
                {n > 0 && <span className="text-[10px] leading-none">{n} visit{n > 1 ? "s" : ""}</span>}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar title="Visits" business={businessName} />
      <main className="flex flex-1 flex-col gap-4 p-4 pb-28">
        {url && (
          <div className={`${card} flex items-center justify-between gap-3 p-4`}>
            <div className="min-w-0">
              <p className="font-semibold">Your booking page</p>
              <p className="truncate text-sm text-muted">{typeof window !== "undefined" ? window.location.origin : ""}{url}</p>
            </div>
            <a href={url} target="_blank" rel="noreferrer" className="shrink-0 rounded-full bg-brand-soft px-3 py-2 text-sm font-semibold text-brand">Open</a>
          </div>
        )}
        {!url && visits && <p className="text-sm text-muted">Online booking is off for this store.</p>}

        <div className="grid grid-cols-4 gap-1 rounded-full bg-line/60 p-1 text-sm font-semibold" role="tablist">
          {(["list", "day", "week", "month"] as View[]).map((v) => (
            <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
              className={`rounded-full py-2 capitalize ${view === v ? "bg-white shadow-sm" : "text-muted"}`}>{v}</button>
          ))}
        </div>
        {view !== "list" && (
          <div className="flex items-center justify-between">
            <button onClick={() => step(-1)} className="rounded-full px-3 py-2 text-lg" aria-label="Previous">‹</button>
            <button onClick={() => setFocus(today)} className="font-display text-lg font-bold">{title}</button>
            <button onClick={() => step(1)} className="rounded-full px-3 py-2 text-lg" aria-label="Next">›</button>
          </div>
        )}

        {msg && <p role="status" className="text-sm text-muted">{msg}</p>}
        {!visits && <p className="text-sm text-muted">Loading…</p>}
        {visits && view === "list" && (
          <>
            <SectionLabel>Upcoming</SectionLabel>
            {upcoming.length ? <ul className="flex flex-col gap-3">{upcoming.map((v) => row(v))}</ul> : <p className="text-sm text-muted">No visits booked yet.</p>}
            {past.length > 0 && <><SectionLabel>Past two weeks</SectionLabel><ul className="flex flex-col gap-3">{past.map((v) => row(v))}</ul></>}
          </>
        )}
        {visits && view === "day" && dayList(focus)}
        {visits && view === "week" && <div className="flex flex-col gap-4">{Array.from({ length: 7 }, (_, i) => dayList(addDays(weekStart(focus), i), true))}</div>}
        {visits && view === "month" && <>{month()}<p className="text-sm text-muted">Tap a day to see its visits.</p></>}
      </main>
      <BottomNav active="visits" />
    </div>
  );
}

/** Pick a new time: open times by the shop's rules, or any other day and time that doesn't overlap a visit. */
function Reschedule({ visit, onDone }: { visit: Visit; onDone: (msg?: string) => void }) {
  const [days, setDays] = useState<DaySlots[] | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [other, setOther] = useState(false);
  const [date, setDate] = useState(dayKey(visit.starts_at));
  const [time, setTime] = useState("09:00");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch(`/api/bookings/${visit.id}`, { cache: "no-store" }).then((r) => r.json()).then((j) => {
      const d = (j.days ?? []).filter((x: DaySlots) => x.slots.length);
      setDays(d);
      setDay(d[0]?.date ?? null);
    }).catch(() => setDays([]));
  }, [visit.id]);

  async function save(body: Record<string, string>) {
    setBusy(true); setErr("");
    const r = await fetch(`/api/bookings/${visit.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "reschedule", ...body }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(j.error ?? "That didn't work."); return; }
    onDone(j.onClover ? "Moved. Now move it on the Clover calendar too, so the customer gets the new time." : "Moved to the new time.");
  }

  const slots = days?.find((d) => d.date === day)?.slots ?? [];
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-line/30 p-3">
      <p className="font-semibold">Move to…</p>
      {!days && <p className="text-muted">Loading open times…</p>}
      {days && !other && (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {days.map((d) => (
              <button key={d.date} onClick={() => setDay(d.date)}
                className={`shrink-0 rounded-full border px-3 py-1.5 ${day === d.date ? "border-brand bg-brand text-white" : "border-line bg-white"}`}>
                {label(d.date, { weekday: "short", month: "short", day: "numeric" })}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {slots.map((s) => (
              <button key={s.start} disabled={busy} onClick={() => save({ start: s.start })} className="rounded-xl border border-line bg-white py-2 font-semibold">{s.label}</button>
            ))}
          </div>
          {!days.length && <p className="text-muted">No open times in the next two weeks.</p>}
        </>
      )}
      {other && (
        <div className="grid grid-cols-2 gap-2">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-xl border border-line bg-white p-2" />
          <input type="time" value={time} step={900} onChange={(e) => setTime(e.target.value)} className="rounded-xl border border-line bg-white p-2" />
          <button disabled={busy} onClick={() => save({ date, time })} className={`${btnPrimary} col-span-2`}>Move to this time</button>
        </div>
      )}
      {err && <p className="text-bad">{err}</p>}
      <div className="flex justify-between text-sm">
        <button onClick={() => setOther(!other)} className="font-semibold text-brand">{other ? "Show open times" : "Pick another day or time"}</button>
        <button onClick={() => onDone()} className="text-muted">Close</button>
      </div>
    </div>
  );
}
