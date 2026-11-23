"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { checkBookingRequest, type DaySlots } from "@ce/core";
import { toCloverJpeg } from "@/lib/photos";
import { btnPrimary, card } from "@/app/components/ui";

interface Info { name: string; service: string; phone: string | null; minutes: number; projectTypes: string[]; days: DaySlots[] }
interface Done { date: string; time: string; minutes: number }
interface Photo { file: File; url: string }

const input = "h-12 w-full rounded-xl border border-edge bg-white px-3.5 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";
const dayFmt = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { ...o, timeZone: "UTC" });

function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className={`${card} p-4`} aria-labelledby={`step-${n}`}>
      <div className="mb-3 flex items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">{n}</span>
        <div>
          <h2 id={`step-${n}`} className="font-display text-lg font-bold leading-tight">{title}</h2>
          {hint && <p className="text-sm text-muted">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export default function BookingForm({ slug, name, service }: { slug: string; name: string; service: string }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [f, setF] = useState({ projectType: "", details: "", street: "", unit: "", city: "", zip: "", firstName: "", lastName: "", phone: "", email: "", company: "" });
  const [day, setDay] = useState("");
  const [start, setStart] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<Done | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  async function load() {
    try {
      const r = await fetch(`/api/book/${slug}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setInfo(j);
      setDay((d) => d || j.days.find((x: DaySlots) => x.slots.length)?.date || "");
    } catch (e) {
      setLoadErr(e instanceof Error && e.message ? e.message : "Couldn't load open times. Refresh to try again.");
    }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedDay = useMemo(() => info?.days.find((d) => d.date === day), [info, day]);
  const startLabel = selectedDay?.slots.find((s) => s.start === start)?.label;

  async function addPhotos(list: FileList | null) {
    if (!list) return;
    setErr("");
    const room = 3 - photos.length;
    for (const file of Array.from(list).slice(0, room)) {
      try {
        const jpg = await toCloverJpeg(file);
        setPhotos((p) => [...p, { file: jpg, url: URL.createObjectURL(jpg) }].slice(0, 3));
      } catch {
        setErr("One photo couldn't be read. Try a different one.");
      }
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  async function submit() {
    const req = { ...f, start };
    const problems = checkBookingRequest(req);
    if (problems.length) { setErr(problems[0]); return; }
    setBusy(true); setErr("");
    const body = new FormData();
    for (const [k, v] of Object.entries(req)) body.append(k, v);
    for (const p of photos) body.append("photos", p.file, p.file.name);
    try {
      const r = await fetch(`/api/book/${slug}`, { method: "POST", body });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(j.error || "Something went wrong. Please try again.");
        if (r.status === 409) { setStart(""); load(); }
        return;
      }
      setDone({ date: j.date, time: j.time, minutes: j.minutes });
      window.scrollTo({ top: 0 });
    } catch {
      setErr("Couldn't reach us. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <header className="border-b border-line bg-white px-5 pb-4 pt-6">
      <p className="text-sm font-semibold text-muted">{name}</p>
      <h1 className="font-display text-[28px] font-bold leading-tight">Book a {service.toLowerCase().replace(/&/g, "and")}</h1>
      {info && <p className="mt-1 text-sm text-muted">We come to you. Takes about {info.minutes} minutes. No cost, no deposit.</p>}
    </header>
  );

  if (done)
    return (
      <main className="mx-auto min-h-dvh max-w-lg bg-paper">
        {header}
        <div className="p-5">
          <div className={`${card} p-6 text-center`}>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-soft text-brand">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            </div>
            <h2 className="mt-3 font-display text-2xl font-bold">You&apos;re booked</h2>
            <p className="mt-2 text-lg font-semibold">{dayFmt(done.date, { weekday: "long", month: "long", day: "numeric" })} at {done.time}</p>
            <p className="mt-1 text-muted">{[f.street, f.unit, f.city].filter(Boolean).join(", ")}</p>
            <p className="mt-4 text-sm text-muted">
              We&apos;ll see you then. {info?.phone ? <>Need to change it? Call or text <a className="font-semibold text-brand underline" href={`tel:${info.phone.replace(/\D/g, "")}`}>{info.phone}</a>.</> : `Need to change it? Contact ${name}.`}
            </p>
          </div>
        </div>
      </main>
    );

  return (
    <main className="mx-auto min-h-dvh max-w-lg bg-paper pb-36">
      {header}
      <div className="flex flex-col gap-4 p-4">
        {loadErr && <p className="rounded-xl bg-bad-soft p-3 text-sm text-bad">{loadErr}</p>}

        <Step n={1} title="What's the project?">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Project type">
            {(info?.projectTypes ?? []).map((t) => (
              <button key={t} type="button" role="radio" aria-checked={f.projectType === t} onClick={() => setF({ ...f, projectType: t })}
                className={`rounded-full border px-3.5 py-2 text-sm font-semibold ${f.projectType === t ? "border-brand bg-brand text-white" : "border-edge bg-white text-ink"}`}>{t}</button>
            ))}
          </div>
          <label className="mt-3 block text-sm font-semibold" htmlFor="details">Tell us about it</label>
          <textarea id="details" rows={4} maxLength={1500} value={f.details} onChange={set("details")}
            placeholder="Rough size, which room, the look you want, anything we should know before we come."
            className="mt-1 w-full rounded-xl border border-edge bg-white p-3 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
          <div className="mt-3">
            <p className="text-sm font-semibold">Photos <span className="font-normal text-muted">(optional, up to 3)</span></p>
            <div className="mt-2 flex gap-2">
              {photos.map((p, i) => (
                <div key={p.url} className="relative h-20 w-20 overflow-hidden rounded-xl border border-line">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
                  <button type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => setPhotos(photos.filter((_, j) => j !== i))}
                    className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-ink/70 text-xs text-white">✕</button>
                </div>
              ))}
              {photos.length < 3 && (
                <button type="button" onClick={() => fileRef.current?.click()}
                  className="flex h-20 w-20 flex-col items-center justify-center rounded-xl border border-dashed border-edge bg-white text-xs font-semibold text-muted">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                  Add photo
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => addPhotos(e.target.files)} />
            </div>
          </div>
        </Step>

        <Step n={2} title="Where's the job?">
          <div className="flex flex-col gap-2.5">
            <input className={input} placeholder="Street address" autoComplete="address-line1" value={f.street} onChange={set("street")} aria-label="Street address" />
            <input className={input} placeholder="Apt, unit or floor (optional)" autoComplete="address-line2" value={f.unit} onChange={set("unit")} aria-label="Apartment, unit or floor" />
            <div className="grid grid-cols-[1fr_110px] gap-2.5">
              <input className={input} placeholder="Town" autoComplete="address-level2" value={f.city} onChange={set("city")} aria-label="Town" />
              <input className={input} placeholder="ZIP" inputMode="numeric" maxLength={5} autoComplete="postal-code" value={f.zip} onChange={set("zip")} aria-label="ZIP code" />
            </div>
          </div>
        </Step>

        <Step n={3} title="Pick a time" hint="Morning visits, starting tomorrow.">
          {!info && !loadErr && <p className="text-sm text-muted">Loading open times…</p>}
          {info && (
            <>
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="radiogroup" aria-label="Day">
                {info.days.filter((d) => d.weekday !== "sun" || d.slots.length).map((d) => {
                  const on = d.date === day, open = d.slots.length > 0;
                  return (
                    <button key={d.date} type="button" role="radio" aria-checked={on} disabled={!open} onClick={() => { setDay(d.date); setStart(""); }}
                      className={`flex w-[68px] shrink-0 flex-col items-center rounded-xl border py-2 ${on ? "border-brand bg-brand text-white" : open ? "border-edge bg-white" : "border-line bg-paper text-edge"}`}>
                      <span className="text-xs font-semibold">{dayFmt(d.date, { weekday: "short" })}</span>
                      <span className="text-lg font-bold leading-tight">{dayFmt(d.date, { day: "numeric" })}</span>
                      <span className="text-[11px]">{dayFmt(d.date, { month: "short" })}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Time">
                {selectedDay?.slots.map((s) => (
                  <button key={s.start} type="button" role="radio" aria-checked={start === s.start} onClick={() => setStart(s.start)}
                    className={`h-11 rounded-xl border text-sm font-semibold ${start === s.start ? "border-brand bg-brand text-white" : "border-edge bg-white"}`}>{s.label}</button>
                ))}
              </div>
              {info.days.every((d) => !d.slots.length) && <p className="text-sm text-muted">No open times in the next two weeks. Please call us.</p>}
            </>
          )}
        </Step>

        <Step n={4} title="Your info" hint="So we can confirm and reach you on the day.">
          <div className="flex flex-col gap-2.5">
            <div className="grid grid-cols-2 gap-2.5">
              <input className={input} placeholder="First name" autoComplete="given-name" value={f.firstName} onChange={set("firstName")} aria-label="First name" />
              <input className={input} placeholder="Last name" autoComplete="family-name" value={f.lastName} onChange={set("lastName")} aria-label="Last name" />
            </div>
            <input className={input} type="tel" placeholder="Mobile phone" autoComplete="tel" value={f.phone} onChange={set("phone")} aria-label="Mobile phone" />
            <input className={input} type="email" placeholder="Email" autoComplete="email" value={f.email} onChange={set("email")} aria-label="Email" />
            {/* Only bots fill this in. */}
            <input tabIndex={-1} aria-hidden="true" autoComplete="off" className="absolute -left-[9999px] h-0 w-0 opacity-0" name="company" value={f.company} onChange={set("company")} />
          </div>
        </Step>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-lg px-4 pb-[max(14px,env(safe-area-inset-bottom))] pt-3">
          {err && <p role="alert" className="mb-2 rounded-xl bg-bad-soft px-3 py-2 text-sm text-bad">{err}</p>}
          <button type="button" className={btnPrimary} disabled={busy || !info} onClick={submit}>
            {busy ? "Booking…" : startLabel && selectedDay ? `Book ${dayFmt(selectedDay.date, { weekday: "short", month: "short", day: "numeric" })} at ${startLabel}` : "Book my visit"}
          </button>
        </div>
      </div>
    </main>
  );
}
