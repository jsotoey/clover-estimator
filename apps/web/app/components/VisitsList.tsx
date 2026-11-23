"use client";
import { useEffect, useState } from "react";
import { TopBar, BottomNav, SectionLabel, Tag, card, btnSecondary, type Tone } from "./ui";

interface Visit {
  id: string; starts_at: string; minutes: number; first_name: string; last_name: string; email: string; phone: string;
  street: string; unit: string | null; city: string; zip: string; project_type: string; details: string;
  status: string; error: string | null; photos: string[];
}

const STATUS: Record<string, [Tone, string]> = {
  to_book: ["warn", "Adding to Clover"], booking: ["warn", "Adding to Clover"], booked: ["good", "On Clover calendar"],
  test_run: ["plain", "Test only"], failed: ["bad", "Not in Clover"], cancelled: ["plain", "Cancelled"],
};
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Visits customers booked on the store's booking page, with everything the person driving out needs. */
export default function VisitsList({ businessName }: { businessName: string }) {
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

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

  const now = Date.now();
  const upcoming = visits?.filter((v) => Date.parse(v.starts_at) >= now - 3600_000) ?? [];
  const past = visits?.filter((v) => Date.parse(v.starts_at) < now - 3600_000) ?? [];

  const row = (v: Visit) => {
    const [tone, label] = STATUS[v.status] ?? ["plain", v.status];
    const addr = `${v.street}${v.unit ? `, ${v.unit}` : ""}, ${v.city} ${v.zip}`;
    const isOpen = open === v.id;
    return (
      <li key={v.id} className={`${card} p-4 ${v.status === "cancelled" ? "opacity-60" : ""}`}>
        <button className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setOpen(isOpen ? null : v.id)} aria-expanded={isOpen}>
          <div className="min-w-0">
            <p className="font-display text-lg font-bold leading-tight">{when(v.starts_at)}</p>
            <p className="truncate font-semibold">{v.first_name} {v.last_name} · {v.project_type}</p>
            <p className="truncate text-sm text-muted">{addr}</p>
          </div>
          <Tag tone={tone}>{label}</Tag>
        </button>
        {isOpen && (
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
            <p className="text-muted">{v.email}</p>
            {v.error && <p className="rounded-xl bg-bad-soft p-2.5 text-bad">{v.error}</p>}
            <div className="flex gap-2">
              {(v.status === "failed" || v.status === "test_run") && <button className={btnSecondary} onClick={() => act(v.id, "retry")}>Try again</button>}
              {v.status !== "cancelled" && v.status !== "booking" && <button className={btnSecondary} onClick={() => act(v.id, "cancel")}>Cancel visit</button>}
            </div>
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar title="Visits" business={businessName} />
      <main className="flex flex-1 flex-col gap-4 p-4">
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
        {msg && <p role="status" className="text-sm text-muted">{msg}</p>}
        {!visits && <p className="text-sm text-muted">Loading…</p>}
        {visits && (
          <>
            <SectionLabel>Upcoming</SectionLabel>
            {upcoming.length ? <ul className="flex flex-col gap-3">{upcoming.map(row)}</ul> : <p className="text-sm text-muted">No visits booked yet.</p>}
            {past.length > 0 && <><SectionLabel>Past two weeks</SectionLabel><ul className="flex flex-col gap-3">{past.map(row)}</ul></>}
          </>
        )}
      </main>
      <BottomNav active="visits" />
    </div>
  );
}
