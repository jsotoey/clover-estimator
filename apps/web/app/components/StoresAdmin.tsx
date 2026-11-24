"use client";
import { useEffect, useState } from "react";
import StoreSwitcher from "./StoreSwitcher";
import StoreSettings from "./StoreSettings";
import { TopBar, BottomNav, SectionLabel, card, btnPrimary, btnSecondary, fmtWhen } from "./ui";

type Store = { id: number; name: string; cloverName: string; taxRate: number; depositPercent: number; lastSignIn: string | null };

const field = "h-12 w-full rounded-xl border border-edge bg-white px-3 text-base";

export default function StoresAdmin({ businessName }: { businessName: string }) {
  const [stores, setStores] = useState<Store[] | null>(null);
  const [current, setCurrent] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", cloverName: "", taxRate: "6.625", depositPercent: "50", pin: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    const r = await fetch("/api/stores", { cache: "no-store" });
    if (r.status === 401) return (location.href = "/");
    const j = await r.json();
    setStores(j.stores); setCurrent(j.current);
  }
  useEffect(() => { load(); }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const r = await fetch("/api/stores", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: form.name, cloverName: form.cloverName, taxRate: Number(form.taxRate), depositPercent: Number(form.depositPercent), pin: form.pin }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: j.error ?? "Couldn't add the store" });
    setMsg({ ok: true, text: `${form.name} added. Switch to it, then sign it in from the Clover tab.` });
    setForm({ name: "", cloverName: "", taxRate: "6.625", depositPercent: "50", pin: "" });
    setAdding(false);
    load();
  }

  async function switchTo(id: number, then = "/") {
    const r = await fetch("/api/stores/switch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    if (r.ok) location.href = then;
  }

  return (
    <main className="mx-auto flex h-dvh max-w-md flex-col bg-paper">
      <TopBar title="Stores" business={<StoreSwitcher name={businessName} admin />} backHref="/" />
      <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto p-4">
        {msg && <p className={`rounded-xl px-3.5 py-3 text-sm ${msg.ok ? "bg-brand-soft text-brand-dark" : "bg-bad-soft text-bad"}`}>{msg.text}</p>}

        {stores === null && <p className="py-6 text-center text-sm text-muted">Loading…</p>}
        {stores?.map((s) => (
          <section key={s.id} className={`${card} flex flex-col gap-3 p-4`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="truncate font-display text-lg font-bold">{s.name}</p>
                <p className="text-[13px] text-muted">Tax {+(s.taxRate * 100).toFixed(3)}% · deposit {s.depositPercent}%</p>
                <p className="text-[13px] text-muted">{s.lastSignIn ? `Clover signed in ${fmtWhen(s.lastSignIn)}` : "Not signed in to Clover yet"}</p>
              </div>
              {s.id === current && <span className="shrink-0 rounded-full bg-brand-soft px-2 py-[3px] text-[11px] font-bold text-brand-dark">Current</span>}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button onClick={() => switchTo(s.id)} className="h-11 rounded-xl border border-edge bg-white text-sm font-semibold">Open</button>
              <button onClick={() => switchTo(s.id, "/clover")} className="h-11 rounded-xl border border-edge bg-white text-sm font-semibold">Clover</button>
              <button onClick={() => setEditing(editing === s.id ? null : s.id)} aria-expanded={editing === s.id}
                className={`h-11 rounded-xl border text-sm font-semibold ${editing === s.id ? "border-brand bg-brand-soft text-brand-dark" : "border-edge bg-white"}`}>Settings</button>
            </div>
            {editing === s.id && <StoreSettings id={s.id} onSaved={load} />}
          </section>
        ))}

        {!adding ? (
          <button onClick={() => setAdding(true)} className={btnPrimary}>Add a store</button>
        ) : (
          <form onSubmit={add} className={`${card} flex flex-col gap-3 p-4`}>
            <SectionLabel>New store</SectionLabel>
            <label className="flex flex-col gap-1 text-sm font-semibold">Business name
              <input className={field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="As customers know it" />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">Name at the top of its Clover dashboard
              <input className={field} value={form.cloverName} onChange={(e) => setForm({ ...form, cloverName: e.target.value })} placeholder="Same as above if blank" />
              <span className="text-xs font-normal text-muted">The worker checks it&apos;s in this store before filling anything in.</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-sm font-semibold">Sales tax %
                <input className={field} inputMode="decimal" value={form.taxRate} onChange={(e) => setForm({ ...form, taxRate: e.target.value })} required />
              </label>
              <label className="flex flex-col gap-1 text-sm font-semibold">Usual deposit %
                <input className={field} inputMode="numeric" value={form.depositPercent} onChange={(e) => setForm({ ...form, depositPercent: e.target.value })} required />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-sm font-semibold">Owner&apos;s PIN (optional)
              <input className={field} inputMode="numeric" type="password" autoComplete="new-password" value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value })} placeholder="4 to 8 digits" />
              <span className="text-xs font-normal text-muted">Lets the owner open only their store. Leave blank for demo stores.</span>
            </label>
            <button disabled={busy} className={btnPrimary}>{busy ? "Adding…" : "Add store"}</button>
            <button type="button" onClick={() => setAdding(false)} className={btnSecondary}>Cancel</button>
          </form>
        )}

        <section className="rounded-[18px] bg-white/60 p-4 text-[13px] leading-relaxed text-muted">
          <p className="font-semibold text-ink">Signing a store in to Clover</p>
          Open the store, go to the Clover tab, tap Start sign-in, then log in on the computer with that store&apos;s Clover login
          (a bot employee login that only has this one store is safest). Each store keeps its own sign-in.
        </section>
      </div>
      <BottomNav active="clover" />
    </main>
  );
}
