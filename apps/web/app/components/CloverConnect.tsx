"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { TopBar, BottomNav, FixroMark, SectionLabel, card, btnPrimary, btnSecondary } from "./ui";

type Login = { id: number; status: string; reason: string | null; message: string | null; typing?: boolean; created_at: string; finished_at: string | null };
type Hist = { id: number; status: string; reason: string | null; created_at: string; finished_at: string | null; seconds: number | null };

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Sign in to Clover through a live view of the worker's browser. */
export default function CloverConnect({ businessName }: { businessName: string }) {
  const [current, setCurrent] = useState<Login | null>(null);
  const [history, setHistory] = useState<Hist[]>([]);
  const [waiting, setWaiting] = useState(0);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/clover-login", { cache: "no-store" });
    if (r.status === 401) return location.reload();
    const j = await r.json();
    setCurrent(j.current); setHistory(j.history); setWaiting(j.waitingEstimates);
  }, []);

  useEffect(() => { load(); }, [load]);
  // When no sign-in is open, still refresh every few seconds (waiting estimates, history).
  useEffect(() => {
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  const live = current && (current.status === "requested" || current.status === "active");

  // Poll status, and the picture while signing in.
  useEffect(() => {
    if (!live) return;
    const t = setInterval(async () => {
      load();
      if (current?.status === "active") {
        const r = await fetch("/api/clover-login/frame", { cache: "no-store" });
        if (r.status === 200) {
          const blob = await r.blob();
          setFrameUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(blob); });
        }
      }
    }, 500);
    return () => clearInterval(t);
  }, [live, current?.status, load]);

  async function start() {
    setBusy(true);
    await fetch("/api/clover-login", { method: "POST" });
    await load();
    setBusy(false);
  }
  async function send(body: object) {
    await fetch("/api/clover-login/input", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }
  // Keep taps and keystrokes in order.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const enqueue = (body: object) => { queue.current = queue.current.then(() => send(body)).catch(() => {}); };
  const keysRef = useRef<HTMLInputElement>(null);
  const prev = useRef("");

  function tap(e: React.MouseEvent<HTMLImageElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    enqueue({ kind: "click", x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
    // Taps on pictures/buttons shouldn't pop the keyboard; it's offered when Clover focuses a text box.
    prev.current = "";
    setText("");
    if (!current?.typing) keysRef.current?.blur();
  }
  function openKeyboard() {
    prev.current = "";
    setText("");
    keysRef.current?.focus({ preventScroll: true });
  }
  function onType(v: string) {
    const p = prev.current;
    if (v.startsWith(p)) {
      if (v.length > p.length) enqueue({ kind: "type", text: v.slice(p.length) });
    } else {
      const common = [...p].findIndex((c, i) => v[i] !== c);
      const keep = common === -1 ? p.length : common;
      for (let i = 0; i < p.length - keep; i++) enqueue({ kind: "key", text: "Backspace" });
      if (v.length > keep) enqueue({ kind: "type", text: v.slice(keep) });
    }
    prev.current = v;
    setText(v);
  }
  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); enqueue({ kind: "key", text: "Enter" }); prev.current = ""; setText(""); }
    else if (e.key === "Backspace" && text === "") enqueue({ kind: "key", text: "Backspace" });
  }

  const lastDone = history.find((h) => h.status === "done");
  const connected = current?.status === "done" && waiting === 0;
  const localSignin = live && current?.message?.startsWith("Sign in on the Mac");

  // Real sign-ins only (a check that finds us already connected takes a few seconds and isn't one).
  const signins = history.filter((h) => h.status === "done" && (h.seconds ?? 99) > 10);
  const activity = signins.slice(0, 4).map((h, i) => {
    const prev = signins[i + 1];
    const gapMs = prev?.finished_at ? new Date(h.created_at).getTime() - new Date(prev.finished_at).getTime() : null;
    const gap = gapMs === null ? null : gapMs < 36e5 ? `${Math.max(1, Math.round(gapMs / 6e4))} min` : gapMs < 48 * 36e5 ? `about ${Math.round(gapMs / 36e5)} hours` : `${Math.round(gapMs / 864e5)} days`;
    return { id: h.id, when: fmt(h.finished_at ?? h.created_at), why: h.reason === "estimate" ? "needed for an estimate" : "you signed in", gap };
  });

  const steps = (
    <ol className="flex flex-col gap-3.5">
      {[
        ["Open Clover on the computer", "A normal Chrome window opens there by itself."],
        ["Log in like always", "Enter the code Clover sends, and tick Remember this browser."],
        ["Come back and tap I'm signed in", waiting > 0 ? "Your waiting estimates go out right after." : "That's it. The app stays connected until Clover asks again."],
      ].map(([t, sub], i) => (
        <li key={t} className="flex gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-brand-dark">{i + 1}</span>
          <span className="flex flex-col gap-0.5"><span className="text-[15px] font-semibold">{t}</span><span className="text-[13px] leading-snug text-muted">{sub}</span></span>
        </li>
      ))}
    </ol>
  );

  return (
    <main className="mx-auto flex h-dvh max-w-md flex-col bg-paper">
      <TopBar title="Clover" business={businessName} />
      <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto p-4">

      {!live && connected && (
        <section className={`${card} flex flex-col gap-4 p-5`}>
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-[14px] bg-brand-soft">
              <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1F6B45" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            </span>
            <div className="flex flex-col gap-0.5">
              <p className="font-display text-xl font-bold">Connected to Clover</p>
              <p className="text-[13px] text-muted">{(signins[0] ?? lastDone)?.finished_at ? `Signed in ${fmt((signins[0] ?? lastDone)!.finished_at!)}` : "Ready for estimates"}</p>
            </div>
          </div>
          <button onClick={start} disabled={busy} className={btnSecondary}>{busy ? "Starting…" : "Sign in again"}</button>
        </section>
      )}

      {!live && !connected && (
        <section className={`${card} flex flex-col gap-4 p-5`}>
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-[14px] bg-warn-soft">
              <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#9A4A08" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
            </span>
            <div className="flex flex-col gap-0.5">
              <p className="font-display text-xl font-bold">Sign in to Clover</p>
              <p className="text-[13px] text-muted">{waiting > 0 ? `${waiting} estimate${waiting > 1 ? "s are" : " is"} waiting to go out` : "Needed before estimates can go out"}</p>
            </div>
          </div>
          {current?.status === "failed" && current.message && <p className="rounded-xl bg-bad-soft px-3 py-2.5 text-[13px] text-bad">Last try didn&apos;t finish: {current.message}</p>}
          {steps}
          <button onClick={start} disabled={busy} className={btnPrimary}>{busy ? "Opening…" : "Start sign-in"}</button>
        </section>
      )}

      {localSignin && (
        <section className={`${card} flex flex-col gap-4 p-5`}>
          <div className="flex flex-col gap-0.5">
            <p className="font-display text-xl font-bold">Sign in on the computer</p>
            <p className="text-[13px] text-muted">Clover&apos;s login is open there now.</p>
          </div>
          {steps}
          <button onClick={() => enqueue({ kind: "key", text: "SigninDone" })} className={btnPrimary}>I&apos;m signed in</button>
          <button onClick={async () => { await fetch("/api/clover-login/cancel", { method: "POST" }); load(); }}
            className="py-1 text-sm font-semibold text-muted underline">Cancel</button>
        </section>
      )}

      {live && !localSignin && (
        <section className="flex flex-col gap-2">
          <p className="text-sm font-medium">
            {current?.status === "requested" ? "Opening Clover… (a few seconds)" : current?.message ?? "Tap the picture to click."}
          </p>
          <div className="relative -mx-4">
            {frameUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img ref={imgRef} src={frameUrl} alt="Clover sign-in" onClick={tap} className="block w-full cursor-pointer border-y border-edge" />
            ) : (
              <div className="flex h-96 items-center justify-center border-y border-dashed border-edge text-muted">Loading Clover…</div>
            )}
            {/* Invisible: it only catches the phone keyboard. What you type shows up in the Clover picture. */}
            <input ref={keysRef} value={text} onChange={(e) => onType(e.target.value)} onKeyDown={onKey}
              onFocus={() => setTyping(true)} onBlur={() => setTyping(false)}
              aria-label="Type into Clover" inputMode="text" autoComplete="one-time-code"
              autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="go"
              className="pointer-events-none absolute left-0 top-0 h-px w-px opacity-0" style={{ fontSize: 16 }} />
          </div>
          <div className="grid grid-cols-4 gap-2 text-sm">
            {["Keyboard", "Enter", "Backspace", "Cancel"].map((k) => (
              <button key={k} onClick={async () => {
                if (k === "Cancel") { await fetch("/api/clover-login/cancel", { method: "POST" }); load(); return; }
                if (k === "Keyboard") { openKeyboard(); return; }
                enqueue({ kind: "key", text: k });
              }} className={`h-11 rounded-xl border ${k === "Cancel" ? "border-transparent text-muted underline" : k === "Keyboard" && current?.typing && !typing ? "animate-pulse border-brand bg-brand font-semibold text-white" : "border-edge bg-white"}`}>{k === "Backspace" ? "⌫" : k === "Keyboard" ? "Type" : k}</button>
            ))}
          </div>
        </section>
      )}

      <section className={`${card} flex flex-col gap-2.5 px-[18px] py-4`}>
        <SectionLabel>Recent sign-ins</SectionLabel>
        {activity.length === 0 ? <p className="text-sm text-muted">None yet.</p> : activity.map((a) => (
          <div key={a.id} className="flex justify-between gap-3 text-sm">
            <span className="flex flex-col"><span className="font-medium">{a.when}</span><span className="text-[13px] text-muted">{a.why}</span></span>
            {a.gap && <span className="text-right text-[13px] text-muted">{a.gap} after<br />the one before</span>}
          </div>
        ))}
      </section>

      <div className="mt-auto flex items-center justify-center gap-2 pb-1 pt-4 text-xs text-muted">
        <span>Powered by</span><FixroMark variant="light" size="sm" />
      </div>
      </div>
      <BottomNav active="clover" />
    </main>
  );
}
