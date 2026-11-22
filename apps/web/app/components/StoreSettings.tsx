"use client";
import { useEffect, useState } from "react";
import { SectionLabel, btnPrimary } from "./ui";

type Settings = {
  cloverName: string; depositPercent: number; depositNote: string; leadDays: number; bufferDays: number; bookInstalls: boolean; installService: string; installTime: string;
  suppliers: { name: string; leadDays: number }[]; crews: { name: string; skills: string[] }[];
};
const field = "h-11 w-full rounded-xl border border-edge bg-white px-3 text-[15px]";
const small = "h-11 rounded-xl border border-edge bg-white px-3 text-[15px]";

/** Admin: one store's deposit message and install workflow (suppliers with wait times, crews with skills). */
export default function StoreSettings({ id, onSaved }: { id: number; onSaved?: () => void }) {
  const [s, setS] = useState<Settings | null>(null);
  const [skillsText, setSkillsText] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch(`/api/stores/${id}`, { cache: "no-store" }).then((r) => r.json()).then((j: Settings) => {
      setS(j); setSkillsText(j.crews.map((c) => c.skills.join(", ")));
    });
  }, [id]);
  if (!s) return <p className="py-3 text-sm text-muted">Loading…</p>;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });

  async function save() {
    if (!s) return;
    setBusy(true); setMsg(null);
    const crews = s.crews.map((c, i) => ({ name: c.name, skills: (skillsText[i] ?? "").split(",").map((x) => x.trim()).filter(Boolean) }));
    const r = await fetch(`/api/stores/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...s, crews }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: j.error ?? "Couldn't save" });
    setS(j); setSkillsText(j.crews.map((c: { skills: string[] }) => c.skills.join(", ")));
    setMsg({ ok: true, text: "Saved." });
    onSaved?.();
  }

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <label className="flex flex-col gap-1 text-sm font-semibold">Name at the top of its Clover dashboard
        <input className={field} value={s.cloverName} onChange={(e) => set("cloverName", e.target.value)} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-sm font-semibold">Usual deposit %
          <input className={field} inputMode="numeric" value={s.depositPercent} onChange={(e) => set("depositPercent", Number(e.target.value) || 0)} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm font-semibold">Deposit invoice message
        <textarea className="min-h-20 w-full rounded-xl border border-edge bg-white px-3 py-2 text-[15px]" maxLength={120} value={s.depositNote}
          onChange={(e) => set("depositNote", e.target.value)} placeholder="Thank you, this locks in your start date." />
        <span className="text-xs font-normal text-muted">Goes on the deposit invoice the customer gets from Clover. {120 - s.depositNote.length} characters left.</span>
      </label>

      <SectionLabel>Installs</SectionLabel>
      <label className="flex items-center gap-3 text-sm font-semibold">
        <input type="checkbox" className="h-5 w-5 accent-[#1F6B45]" checked={s.bookInstalls} onChange={(e) => set("bookInstalls", e.target.checked)} />
        When a deposit is paid, pencil in the install
      </label>
      {s.bookInstalls && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-sm font-semibold">Usual materials wait (days)
              <input className={field} inputMode="numeric" value={s.leadDays} onChange={(e) => set("leadDays", Number(e.target.value) || 0)} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">Extra buffer (days)
              <input className={field} inputMode="numeric" value={s.bufferDays} onChange={(e) => set("bufferDays", Number(e.target.value) || 0)} />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-sm font-semibold">Clover service to book
              <input className={field} value={s.installService} onChange={(e) => set("installService", e.target.value)} placeholder="Installation" />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">Start time
              <input className={field} value={s.installTime} onChange={(e) => set("installTime", e.target.value)} placeholder="9:00 AM" />
            </label>
          </div>

          <p className="text-sm font-semibold">Suppliers <span className="font-normal text-muted">(wait time for their materials)</span></p>
          {s.suppliers.map((x, i) => (
            <div key={i} className="flex gap-2">
              <input aria-label="Supplier name" className={`${small} min-w-0 flex-1`} value={x.name} placeholder="Supplier name"
                onChange={(e) => set("suppliers", s.suppliers.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
              <input aria-label="Days" className={`${small} w-20`} inputMode="numeric" value={x.leadDays}
                onChange={(e) => set("suppliers", s.suppliers.map((y, j) => (j === i ? { ...y, leadDays: Number(e.target.value) || 0 } : y)))} />
              <button aria-label="Remove supplier" onClick={() => set("suppliers", s.suppliers.filter((_, j) => j !== i))} className="h-11 w-11 rounded-xl text-muted">✕</button>
            </div>
          ))}
          <button onClick={() => set("suppliers", [...s.suppliers, { name: "", leadDays: s.leadDays || 21 }])} className="self-start text-sm font-semibold text-brand underline">Add a supplier</button>

          <p className="text-sm font-semibold">Crews <span className="font-normal text-muted">(named exactly like the employee in Clover; letters only, e.g. Team One)</span></p>
          {s.crews.map((x, i) => (
            <div key={i} className="flex flex-col gap-1.5 rounded-xl bg-paper p-2.5">
              <div className="flex gap-2">
                <input aria-label="Crew name" className={`${small} min-w-0 flex-1`} value={x.name} placeholder="Team One"
                  onChange={(e) => set("crews", s.crews.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
                <button aria-label="Remove crew" onClick={() => { set("crews", s.crews.filter((_, j) => j !== i)); setSkillsText(skillsText.filter((_, j) => j !== i)); }} className="h-11 w-11 rounded-xl text-muted">✕</button>
              </div>
              <input aria-label="Skills" className={small} value={skillsText[i] ?? ""} placeholder="Skills: shower, railing, mirror"
                onChange={(e) => setSkillsText(skillsText.map((t, j) => (j === i ? e.target.value : t)))} />
            </div>
          ))}
          <button onClick={() => { set("crews", [...s.crews, { name: "", skills: [] }]); setSkillsText([...skillsText, ""]); }} className="self-start text-sm font-semibold text-brand underline">Add a crew</button>
        </>
      )}
      {msg && <p className={`text-sm ${msg.ok ? "text-brand-dark" : "text-bad"}`}>{msg.text}</p>}
      <button onClick={save} disabled={busy} className={btnPrimary}>{busy ? "Saving…" : "Save settings"}</button>
    </div>
  );
}
