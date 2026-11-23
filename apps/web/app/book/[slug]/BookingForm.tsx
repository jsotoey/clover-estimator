"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { calendarLinks, checkBookingRequest, visitIcs, type DaySlots } from "@ce/core";
import { toCloverJpeg } from "@/lib/photos";

interface Info { name: string; service: string; phone: string | null; minutes: number; projectTypes: string[]; days: DaySlots[] }
interface Done { id: string; date: string; time: string; minutes: number; emailed: boolean; start: string }
interface Photo { file: File; url: string }

const dayFmt = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { ...o, timeZone: "UTC" });
const digits = (s: string) => s.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");

const Check = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);

function Step({ n, title, hint, done, children }: { n: number; title: string; hint?: string; done: boolean; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`step-${n}`}
      className={`rounded-[20px] border bg-white p-5 shadow-[0_1px_2px_rgba(16,24,20,0.04)] transition-colors sm:p-6 ${done ? "border-[color-mix(in_srgb,var(--accent)_35%,white)]" : "border-line"}`}>
      <div className="mb-4 flex items-center gap-3">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-colors ${done ? "bg-[var(--accent)] text-white" : "bg-[color-mix(in_srgb,var(--accent)_12%,white)] text-[var(--accent)]"}`}>
          {done ? <Check size={16} /> : n}
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`step-${n}`} className="font-display text-lg font-bold leading-tight sm:text-xl">{title}</h2>
          {hint && <p className="text-sm text-muted">{hint}</p>}
        </div>
        {done && <span className="hidden text-xs font-semibold text-[var(--accent)] sm:inline">Done</span>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children, optional }: { label: string; children: React.ReactNode; optional?: boolean }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold">{label}{optional && <span className="font-normal text-muted"> (optional)</span>}</span>
      {children}
    </label>
  );
}

export default function BookingForm({ slug, name, service, accent, tagline }: { slug: string; name: string; service: string; accent: string; tagline: string | null }) {
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
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setF({ ...f, [k]: e.target.value }); setErr(""); };
  const serviceName = service.toLowerCase().replace(/&/g, "and");

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
  const startLabel = info?.days.flatMap((d) => d.slots).find((s) => s.start === start)?.label;
  const startDay = info?.days.find((d) => d.slots.some((s) => s.start === start))?.date;

  // What's finished, for the checkmarks and the summary.
  const doneProject = !!f.projectType && f.details.trim().length >= 5;
  const doneAddress = f.street.trim().length >= 4 && f.city.trim().length >= 2 && /^\d{5}$/.test(f.zip.trim());
  const doneTime = !!start;
  const doneContact = !!f.firstName.trim() && !!f.lastName.trim() && digits(f.phone).length === 10 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim());
  const steps = [
    { label: "Project", done: doneProject, value: f.projectType || null, todo: f.projectType ? "Add a few words about the job" : "Pick the project" },
    { label: "Address", done: doneAddress, value: doneAddress ? `${f.street.trim()}${f.unit.trim() ? `, ${f.unit.trim()}` : ""}, ${f.city.trim()}` : null, todo: "Add the job address" },
    { label: "Time", done: doneTime, value: startLabel && startDay ? `${dayFmt(startDay, { weekday: "short", month: "short", day: "numeric" })} at ${startLabel}` : null, todo: "Pick a day and time" },
    { label: "Contact", done: doneContact, value: doneContact ? `${f.firstName.trim()} ${f.lastName.trim()}` : null, todo: "Add your name, phone and email" },
  ];
  const left = steps.filter((s) => !s.done).length;
  const ready = left === 0;

  async function addPhotos(list: FileList | null) {
    if (!list) return;
    setErr("");
    for (const file of Array.from(list).slice(0, 3 - photos.length)) {
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
    body.append("consent", "yes"); // shown next to the Book button: agreeing is part of booking
    for (const p of photos) body.append("photos", p.file, p.file.name);
    try {
      const r = await fetch(`/api/book/${slug}`, { method: "POST", body });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(j.error || "Something went wrong. Please try again.");
        if (r.status === 409) { setStart(""); load(); }
        return;
      }
      setDone({ id: j.id ?? "visit", date: j.date, time: j.time, minutes: j.minutes, emailed: !!j.emailed, start });
      window.scrollTo({ top: 0 });
    } catch {
      setErr("Couldn't reach us. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function calendarFile() {
    if (!done) return;
    const ics = visitIcs({ id: done.id, startIso: done.start, minutes: done.minutes, storeName: name,
      address: `${f.street}${f.unit ? `, ${f.unit}` : ""}, ${f.city} ${f.zip}`, phone: info?.phone ?? null });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    a.download = "visit.ics";
    a.click();
  }

  const style = { "--accent": accent } as React.CSSProperties;
  const input = "h-12 w-full rounded-xl border border-edge bg-white px-3.5 text-base outline-none transition focus:border-[var(--accent)] focus:ring-4 focus:ring-[color-mix(in_srgb,var(--accent)_15%,transparent)]";

  const header = (
    <header className="relative overflow-hidden bg-[var(--accent)] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(120%_120%_at_100%_0%,rgba(255,255,255,0.18),transparent_55%)]" aria-hidden="true" />
      <div className="relative mx-auto max-w-5xl px-5 pb-8 pt-7 sm:px-8 sm:pb-10 sm:pt-10">
        <p className="text-sm font-semibold tracking-wide text-white/80">{name}{tagline ? ` · ${tagline}` : ""}</p>
        <h1 className="mt-1 font-display text-[30px] font-bold leading-[1.1] sm:text-[40px]">
          {done ? "You're all set" : `Book your ${serviceName}`}
        </h1>
        {!done && (
          <ul className="mt-4 flex flex-wrap gap-2 text-sm font-semibold">
            {["Free", `About ${info?.minutes ?? 30} minutes`, "We come to you", "No deposit"].map((t) => (
              <li key={t} className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 backdrop-blur"><Check />{t}</li>
            ))}
          </ul>
        )}
      </div>
    </header>
  );

  if (done) {
    const when = `${dayFmt(done.date, { weekday: "long", month: "long", day: "numeric" })} at ${done.time}`;
    return (
      <main style={style} className="min-h-dvh bg-paper">
        {header}
        <div className="mx-auto -mt-6 max-w-xl px-4 pb-16">
          <div className="rounded-[24px] border border-line bg-white p-6 text-center shadow-[0_8px_30px_rgba(16,24,20,0.08)] sm:p-8">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--accent)_12%,white)] text-[var(--accent)]"><Check size={32} /></div>
            <h2 className="mt-4 font-display text-2xl font-bold">Your visit is booked</h2>
            <p className="mt-2 text-xl font-semibold">{when}</p>
            <p className="mt-1 text-muted">{[f.street, f.unit, f.city].filter(Boolean).join(", ")}</p>
            <div className="mt-6">
              <p className="text-sm font-bold">Add it to your calendar</p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(() => {
                  const address = `${f.street}${f.unit ? `, ${f.unit}` : ""}, ${f.city} ${f.zip}`;
                  const links = calendarLinks({ startIso: done.start, minutes: done.minutes, title: `${name}: free measure`, address,
                    details: `${name} is coming to measure (${f.projectType}).${info?.phone ? ` To change it, call or text ${info.phone}.` : ""}` });
                  const cls = "flex h-12 items-center justify-center gap-2 rounded-xl border border-edge bg-white px-3 text-sm font-semibold transition hover:border-[var(--accent)]";
                  return (
                    <>
                      <a href={done.id !== "visit" ? `/api/visit/${done.id}` : "#"} onClick={(e) => { if (done.id === "visit") { e.preventDefault(); calendarFile(); } }} className={cls}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9s-1.9-.9-3.1-.8c-1.6 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2.1-1.1 2.8-2.3.9-1.3 1.3-2.6 1.3-2.7 0 0-2.4-.9-2.4-3.7zM14.2 5.8c.6-.8 1.1-1.8 1-2.8-.9 0-2 .6-2.7 1.4-.6.7-1.1 1.7-1 2.7 1 .1 2-.5 2.7-1.3z" /></svg>
                        Apple
                      </a>
                      <a href={links.google} target="_blank" rel="noopener noreferrer" className={cls}>
                        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2" fill="none" stroke="#4285F4" strokeWidth="2" /><path d="M3 9h18" stroke="#EA4335" strokeWidth="2" /><path d="M8 2v4M16 2v4" stroke="#34A853" strokeWidth="2" strokeLinecap="round" /></svg>
                        Google
                      </a>
                      <a href={links.outlook} target="_blank" rel="noopener noreferrer" className={cls}>
                        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="12" height="14" rx="2" fill="#0A64C2" /><ellipse cx="9" cy="12" rx="3" ry="3.6" fill="none" stroke="#fff" strokeWidth="1.8" /><path d="M15 8h6v9h-6" fill="none" stroke="#0A64C2" strokeWidth="1.8" /></svg>
                        Outlook
                      </a>
                      <a href={links.office365} target="_blank" rel="noopener noreferrer" className={cls}>Office 365</a>
                    </>
                  );
                })()}
              </div>
            </div>
            <div className="mt-6 rounded-2xl bg-paper p-4 text-left">
              <p className="text-sm font-bold">What happens next</p>
              <ol className="mt-2 flex flex-col gap-2 text-sm text-muted">
                <li>1. You&apos;ll get a confirmation{done.emailed ? ` at ${f.email}` : " by text and email"}.</li>
                <li>2. We come out, measure, and go over options with you.</li>
                <li>3. You get a written estimate. No cost, no pressure.</li>
              </ol>
            </div>
            <p className="mt-5 text-sm text-muted">
              Need to change it? {info?.phone ? <>Call or text <a className="font-semibold text-[var(--accent)] underline" href={`tel:${digits(info.phone)}`}>{info.phone}</a>.</> : `Contact ${name}.`}
            </p>
          </div>
        </div>
      </main>
    );
  }

  const summary = (
    <div className="rounded-[20px] border border-line bg-white p-5 shadow-[0_1px_2px_rgba(16,24,20,0.04)]">
      <p className="font-display text-lg font-bold">Your visit</p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--accent)_12%,white)]">
        <div className="h-full rounded-full bg-[var(--accent)] transition-all duration-500" style={{ width: `${((4 - left) / 4) * 100}%` }} />
      </div>
      <p className="mt-2 text-xs font-semibold text-muted">{ready ? "Everything's filled in" : `${left} step${left > 1 ? "s" : ""} left`}</p>
      <ul className="mt-4 flex flex-col gap-3">
        {steps.map((s) => (
          <li key={s.label} className="flex gap-3">
            <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${s.done ? "bg-[var(--accent)] text-white" : "border-2 border-edge"}`}>{s.done && <Check size={12} />}</span>
            <span className="min-w-0">
              <span className="block text-xs font-bold uppercase tracking-wide text-muted">{s.label}</span>
              <span className={`block truncate text-sm ${s.done || s.value ? "font-semibold text-ink" : "text-muted"}`}>{s.value ?? s.todo}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );

  const bookButton = (
    <button type="button" onClick={submit} disabled={busy || !info}
      className={`flex h-[54px] w-full items-center justify-center rounded-2xl px-4 text-base font-semibold transition ${ready ? "bg-[var(--accent)] text-white shadow-[0_6px_20px_color-mix(in_srgb,var(--accent)_35%,transparent)]" : "bg-[#E4E1D8] text-muted"} disabled:opacity-60`}>
      {busy ? "Booking…" : ready && startLabel && startDay ? `Book ${dayFmt(startDay, { weekday: "short", month: "short", day: "numeric" })} at ${startLabel}` : ready ? "Book my visit" : `Book my visit · ${left} step${left > 1 ? "s" : ""} left`}
    </button>
  );
  const consent = <p className="text-center text-xs leading-snug text-muted">By booking, you agree to get texts and emails from {name} about this appointment. Msg &amp; data rates may apply.</p>;
  const errorBox = err && <p role="alert" className="rounded-xl bg-bad-soft px-3 py-2.5 text-sm text-bad">{err}</p>;

  return (
    <main style={style} className="min-h-dvh bg-paper pb-44 lg:pb-16">
      {header}
      <div className="mx-auto grid max-w-5xl gap-5 px-4 pt-5 sm:px-8 sm:pt-8 lg:grid-cols-[1fr_340px] lg:gap-8">
        <div className="flex min-w-0 flex-col gap-4 sm:gap-5">
          {loadErr && <p className="rounded-xl bg-bad-soft p-3 text-sm text-bad">{loadErr}</p>}

          <Step n={1} title="What's the project?" done={doneProject}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Project type">
              {(info?.projectTypes ?? []).map((t) => {
                const on = f.projectType === t;
                return (
                  <button key={t} type="button" role="radio" aria-checked={on} onClick={() => { setF({ ...f, projectType: t }); setErr(""); }}
                    className={`min-h-12 rounded-xl border px-3 py-2.5 text-left text-sm font-semibold leading-tight transition ${on ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,white)] text-[var(--accent)] ring-2 ring-[var(--accent)]" : "border-edge bg-white hover:border-[var(--accent)]"}`}>{t}</button>
                );
              })}
            </div>
            <div className="mt-4">
              <Field label="Tell us about it">
                <textarea rows={3} maxLength={1500} value={f.details} onChange={set("details")}
                  placeholder="Rough size, which room, the look you want, anything we should know before we come."
                  className="w-full rounded-xl border border-edge bg-white p-3.5 text-base outline-none transition focus:border-[var(--accent)] focus:ring-4 focus:ring-[color-mix(in_srgb,var(--accent)_15%,transparent)]" />
              </Field>
            </div>
            <div className="mt-4">
              <p className="text-sm font-semibold">Photos <span className="font-normal text-muted">(optional, up to 3, helps us come prepared)</span></p>
              <div className="mt-2 flex flex-wrap gap-2">
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
                    className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-edge bg-white text-xs font-semibold text-muted transition hover:border-[var(--accent)] hover:text-[var(--accent)]">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
                    Add photo
                  </button>
                )}
                <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => addPhotos(e.target.files)} />
              </div>
            </div>
          </Step>

          <Step n={2} title="Where's the job?" done={doneAddress}>
            <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
              <Field label="Street address"><input className={input} autoComplete="address-line1" value={f.street} onChange={set("street")} placeholder="123 Main St" /></Field>
              <Field label="Apt or unit" optional><input className={input} autoComplete="address-line2" value={f.unit} onChange={set("unit")} placeholder="2B" /></Field>
              <Field label="Town"><input className={input} autoComplete="address-level2" value={f.city} onChange={set("city")} placeholder="Union" /></Field>
              <Field label="ZIP code"><input className={input} inputMode="numeric" maxLength={5} autoComplete="postal-code" value={f.zip} onChange={set("zip")} placeholder="07083" /></Field>
            </div>
          </Step>

          <Step n={3} title="Pick a time" hint="Morning visits. Tap a day, then a time." done={doneTime}>
            {!info && !loadErr && <p className="text-sm text-muted">Loading open times…</p>}
            {info && (
              <>
                <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 sm:-mx-6 sm:px-6 sm:pb-2" role="radiogroup" aria-label="Day">
                  {info.days.filter((d) => d.weekday !== "sun" || d.slots.length).map((d) => {
                    const on = d.date === day, open = d.slots.length > 0;
                    return (
                      <button key={d.date} type="button" role="radio" aria-checked={on} disabled={!open} onClick={() => { setDay(d.date); setStart(""); }}
                        className={`flex w-[70px] shrink-0 flex-col items-center rounded-2xl border py-2.5 transition ${on ? "border-[var(--accent)] bg-[var(--accent)] text-white" : open ? "border-edge bg-white hover:border-[var(--accent)]" : "border-line bg-paper text-edge line-through"}`}>
                        <span className="text-xs font-semibold">{dayFmt(d.date, { weekday: "short" })}</span>
                        <span className="text-xl font-bold leading-tight">{dayFmt(d.date, { day: "numeric" })}</span>
                        <span className="text-[11px]">{dayFmt(d.date, { month: "short" })}</span>
                      </button>
                    );
                  })}
                </div>
                {selectedDay && (
                  <>
                    <p className="mt-4 text-sm font-semibold">{dayFmt(selectedDay.date, { weekday: "long", month: "long", day: "numeric" })}</p>
                    <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Time">
                      {selectedDay.slots.map((s) => (
                        <button key={s.start} type="button" role="radio" aria-checked={start === s.start} onClick={() => { setStart(s.start); setErr(""); }}
                          className={`h-12 rounded-xl border text-sm font-semibold transition ${start === s.start ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-edge bg-white hover:border-[var(--accent)]"}`}>{s.label}</button>
                      ))}
                    </div>
                  </>
                )}
                {info.days.every((d) => !d.slots.length) && <p className="text-sm text-muted">No open times in the next two weeks. Please call us.</p>}
              </>
            )}
          </Step>

          <Step n={4} title="Your info" hint="So we can confirm and reach you on the day." done={doneContact}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="First name"><input className={input} autoComplete="given-name" value={f.firstName} onChange={set("firstName")} /></Field>
              <Field label="Last name"><input className={input} autoComplete="family-name" value={f.lastName} onChange={set("lastName")} /></Field>
              <Field label="Mobile phone"><input className={input} type="tel" autoComplete="tel" value={f.phone} onChange={set("phone")} placeholder="(908) 555-0123" /></Field>
              <Field label="Email"><input className={input} type="email" autoComplete="email" value={f.email} onChange={set("email")} placeholder="you@email.com" /></Field>
            </div>
            {/* Only bots fill this in. */}
            <input tabIndex={-1} aria-hidden="true" autoComplete="off" className="absolute -left-[9999px] h-0 w-0 opacity-0" name="company" value={f.company} onChange={set("company")} />
          </Step>
        </div>

        {/* Desktop: summary + Book button stay in view on the right. */}
        <aside className="hidden lg:block">
          <div className="sticky top-6 flex flex-col gap-3">
            {summary}
            {errorBox}
            {bookButton}
            {consent}
          </div>
        </aside>
      </div>

      {/* Phone: progress + Book button pinned to the bottom. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-xl flex-col gap-2 px-4 pb-[max(14px,env(safe-area-inset-bottom))] pt-3">
          <div className="flex items-center gap-2">
            {steps.map((s) => <span key={s.label} className={`h-1.5 flex-1 rounded-full transition-colors ${s.done ? "bg-[var(--accent)]" : "bg-[#E4E1D8]"}`} />)}
          </div>
          {!ready && <p className="text-xs text-muted">Next: {steps.find((s) => !s.done)?.todo}</p>}
          {errorBox}
          {bookButton}
          {consent}
        </div>
      </div>
    </main>
  );
}
