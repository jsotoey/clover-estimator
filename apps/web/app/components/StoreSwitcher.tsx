"use client";
import { useState } from "react";

type Store = { id: number; name: string };

/**
 * The store name at the top of every screen. For the admin it's a button that switches stores.
 */
export default function StoreSwitcher({ name, admin }: { name: string; admin: boolean }) {
  const [open, setOpen] = useState(false);
  const [stores, setStores] = useState<Store[] | null>(null);
  const [current, setCurrent] = useState<number | null>(null);
  if (!admin) return <span className="truncate text-xs font-semibold text-muted">{name}</span>;

  async function show() {
    setOpen(true);
    const r = await fetch("/api/stores", { cache: "no-store" });
    if (r.ok) { const j = await r.json(); setStores(j.stores); setCurrent(j.current); }
  }
  async function pick(id: number) {
    if (id === current) return setOpen(false);
    const r = await fetch("/api/stores/switch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    if (r.ok) location.href = "/";
  }
  return (
    <>
      <button onClick={show} aria-haspopup="dialog" className="flex min-w-0 items-center gap-1 text-left text-xs font-semibold text-brand">
        <span className="truncate">{name}</span>
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div role="dialog" aria-label="Switch store" className="fixed inset-0 z-50 flex items-end bg-black/30" onClick={() => setOpen(false)}>
          <div className="mx-auto w-full max-w-md rounded-t-[20px] bg-white px-4 pb-[max(20px,env(safe-area-inset-bottom))] pt-4" onClick={(e) => e.stopPropagation()}>
            <p className="px-1 pb-3 font-display text-lg font-bold">Switch store</p>
            <div className="flex max-h-[55vh] flex-col gap-2 overflow-y-auto">
              {stores === null && <p className="py-4 text-center text-sm text-muted">Loading…</p>}
              {stores?.map((s) => (
                <button key={s.id} onClick={() => pick(s.id)}
                  className={`flex h-[52px] items-center justify-between rounded-[14px] border px-4 text-left text-[15px] font-semibold ${s.id === current ? "border-brand bg-brand-soft text-brand-dark" : "border-line bg-white"}`}>
                  <span className="truncate">{s.name}</span>
                  {s.id === current && <span className="text-xs">Current</span>}
                </button>
              ))}
            </div>
            <a href="/stores" className="mt-3 flex h-[52px] items-center justify-center rounded-[14px] border border-edge text-[15px] font-semibold">Manage stores</a>
          </div>
        </div>
      )}
    </>
  );
}
