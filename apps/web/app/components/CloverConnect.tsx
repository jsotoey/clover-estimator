"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import StoreSwitcher from "./StoreSwitcher";
import { TopBar, BottomNav, FixroMark, SectionLabel, card, btnPrimary, btnSecondary } from "./ui";

type Login = { id: number; status: string; reason: string | null; message: string | null; typing?: boolean; created_at: string; finished_at: string | null };
type Bot = { online: boolean; seenAt: string | null; known: boolean };
type StoreState = { name: string; cloverName: string | null; botEmail: string | null; paused: boolean; signedIn: boolean | null; storeOk: boolean | null; checkedAt: string | null };
type Hist = { id: number; status: string; reason: string | null; created_at: string; finished_at: string | null; seconds: number | null };

const START_CMD = "caffeinate -i bash ~/.clover-runner.sh";
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};
const DOT = { good: "bg-brand", warn: "bg-[#D98A2B]", bad: "bg-bad", plain: "bg-[#C9C5BA]" } as const;
const INK = { good: "text-brand-dark", warn: "text-warn", bad: "text-bad", plain: "text-muted" } as const;

/** One line of the Clover setup checklist. */
function Row({ n, title, status, tone, children }: { n: number; title: string; status: string; tone: keyof typeof DOT; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 p-[18px]">
      <div className="flex items-start gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#ECEAE3] text-[13px] font-bold">{n}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-[15px] font-semibold leading-tight">{title}</p>
          <p className={`flex items-center gap-1.5 text-[13px] font-medium ${INK[tone]}`}>
            <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${DOT[tone]}`} />{status}
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-3 pl-10">{children}</div>
    </div>
  );
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Sign in to Clover through a live view of the worker's browser. */
export default function CloverConnect({ businessName, admin }: { businessName: string; admin: boolean }) {
  const [current, setCurrent] = useState<Login | null>(null);
  const [history, setHistory] = useState<Hist[]>([]);
  const [waiting, setWaiting] = useState(0);
  const [bot, setBot] = useState<Bot | null>(null);
  const [store, setStore] = useState<StoreState | null>(null);
  const [editEmail, setEditEmail] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState(false);
  const [finishing, setFinishing] = useState<number | null>(null); // when "I'm signed in" was tapped
  const imgRef = useRef<HTMLImageElement>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/clover-login", { cache: "no-store" });
    if (r.status === 401) return location.reload();
    const j = await r.json();
    setCurrent(j.current); setHistory(j.history); setWaiting(j.waitingEstimates);
    setBot(j.bot ?? null); setStore(j.store ?? null);
  }, []);

  useEffect(() => { load(); }, [load]);
  // When no sign-in is open, still refresh every few seconds (waiting estimates, history).
  useEffect(() => {
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  const live = current && (current.status === "requested" || current.status === "active");
  useEffect(() => { if (!live) setFinishing(null); }, [live]);
  // Tick once a second while checking, for the progress bar.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (finishing === null) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [finishing]);
  function finishSignin() {
    if (finishing !== null) return; // already sent; the worker is checking
    setFinishing(Date.now());
    enqueue({ kind: "key", text: "SigninDone" });
  }

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

  async function saveSettings(body: { botEmail?: string | null; paused?: boolean }) {
    const r = await fetch("/api/clover-login/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setNote(r.ok ? "" : j.error ?? "That didn't save.");
    if (r.ok) setEditEmail(null);
    load();
  }

  async function start(switching = false) {
    setBusy(true);
    await fetch("/api/clover-login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ switch: switching }) });
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
  const botTone: "good" | "warn" | "bad" | "plain" =
    !store ? "plain" : store.paused ? "plain" : store.signedIn === false || waiting > 0 ? "bad" : store.storeOk === false ? "bad"
    : store.signedIn ? "good" : lastDone ? "good" : "warn";
  const botStatus = !store ? "Checking…"
    : store.paused ? "Paused: the bot skips this store"
    : waiting > 0 ? `Signed out · ${waiting} estimate${waiting > 1 ? "s" : ""} waiting`
    : store.signedIn === false ? "Signed out · needs you"
    : store.storeOk === false ? `Signed in to a different store, not ${store.cloverName ?? store.name}`
    : store.signedIn ? `Signed in${store.storeOk ? ` · Clover shows ${store.cloverName ?? store.name}` : ""}${store.checkedAt ? ` · checked ${ago(store.checkedAt)}` : ""}`
    : lastDone ? `Signed in ${fmt(lastDone.finished_at ?? lastDone.created_at)}` : "Not signed in yet";
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
        ["Go to the bot computer", "The Clover window opens there by itself."],
        [store?.botEmail ? `Log in as ${store.botEmail}` : "Log in with the bot's Clover login", "Enter the code Clover texts, and tick Remember this browser."],
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
      <TopBar title="Clover" business={<StoreSwitcher name={businessName} admin={admin} />} />
      <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto p-4">

      <p className="px-1 text-[14px] leading-snug text-muted">
        Three different things sign in to Clover. Only the <b className="text-ink">bot</b> ever needs you on this screen.
      </p>

      <section className={`${card} flex flex-col divide-y divide-line/70`} aria-label="Clover setup">
        {/* 1. The bot computer */}
        <Row n={1} title="Bot computer" tone={!bot ? "plain" : bot.online ? "good" : "bad"}
          status={!bot ? "Checking…" : bot.online ? `Running${bot.seenAt ? ` · checked in ${ago(bot.seenAt)}` : ""}` : bot.known ? `Off since ${fmt(bot.seenAt!)}` : "No check-in yet"}>
          <p className="text-[13px] leading-snug text-muted">The Mac that does the work in Clover for you. It has to be on, plugged in, with its Terminal window open.</p>
          {bot && !bot.online && (
            <div className="flex flex-col gap-2 rounded-2xl bg-[#F3F1EC] p-3.5">
              <p className="text-[13px] font-semibold">To start it: open Terminal on the Mac, paste this, press Return.</p>
              <code className="select-all break-all rounded-xl bg-white px-3 py-2.5 font-mono text-[13px]">{START_CMD}</code>
              <button onClick={() => navigator.clipboard?.writeText(START_CMD).then(() => setNote("Copied. Paste it in Terminal on the Mac."))}
                className="self-start text-[13px] font-semibold text-brand underline">Copy</button>
            </div>
          )}
        </Row>

        {/* 2. The bot's own Clover login for this store */}
        <Row n={2} title={`Bot's Clover login for ${store?.name ?? businessName}`} tone={botTone} status={botStatus}>
          <div className="flex flex-col gap-1 rounded-2xl bg-[#F3F1EC] px-3.5 py-3">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Sign the bot in with</span>
            {editEmail === null ? (
              <span className="flex items-center justify-between gap-2">
                <span className="break-all text-[15px] font-semibold">{store?.botEmail ?? "Not set yet"}</span>
                <button onClick={() => setEditEmail(store?.botEmail ?? "")} className="shrink-0 text-[13px] font-semibold text-brand underline">{store?.botEmail ? "Change" : "Add"}</button>
              </span>
            ) : (
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); saveSettings({ botEmail: editEmail }); }}>
                <label htmlFor="botEmail" className="sr-only">Bot's Clover email</label>
                <input id="botEmail" type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="bot@example.com" autoComplete="off"
                  className="h-11 min-w-0 flex-1 rounded-xl bg-white px-3 text-[15px] outline-none focus:ring-2 focus:ring-brand" />
                <button className="h-11 rounded-xl bg-brand px-4 text-[14px] font-semibold text-white">Save</button>
              </form>
            )}
            <span className="text-[12px] leading-snug text-muted">Its own Clover user (an Admin employee), not yours. The password stays with you; the app never stores it.</span>
          </div>
          {!store?.paused && !live && (
            botTone === "good" ? (
              <div className="flex gap-4">
                <button onClick={() => start()} disabled={busy || !bot?.online} className="text-[13px] font-semibold text-brand underline disabled:opacity-40">Sign in again</button>
                <button onClick={() => { if (confirm(`Sign the bot out of Clover so you can sign it in with a different login?`)) start(true); }} disabled={busy || !bot?.online}
                  className="text-[13px] font-semibold text-muted underline disabled:opacity-40">Use a different login</button>
              </div>
            ) : (
              <>
                {current?.status === "failed" && current.message && <p className="rounded-xl bg-bad-soft px-3 py-2.5 text-[13px] text-bad">Last try didn&apos;t finish: {current.message}</p>}
                <button onClick={() => start(store?.storeOk === false)} disabled={busy || !bot?.online} className={btnPrimary}>
                  {busy ? "Opening…" : !bot?.online ? "Start the bot computer first" : "Sign the bot in"}
                </button>
                {bot?.online && <p className="text-[12px] leading-snug text-muted">A Chrome window opens on the bot computer. You sign in there, not in your own browser.</p>}
              </>
            )
          )}
          <button onClick={() => saveSettings({ paused: !store?.paused })} className="self-start text-[12px] font-semibold text-muted underline">
            {store?.paused ? "Turn the bot back on for this store" : "Pause the bot for this store"}
          </button>
        </Row>

        {/* 3. Your own Clover */}
        <Row n={3} title="Your own Clover" tone="plain" status="Nothing to do here">
          <p className="text-[13px] leading-snug text-muted">
            To look around Clover yourself, use <b className="text-ink">your own</b> login in your own browser or the Clover app.
            {store?.botEmail ? <> Never sign in as <b className="break-all text-ink">{store.botEmail}</b> anywhere else: Clover allows one session per login and would sign the bot out.</> : " Never use the bot's login yourself: Clover allows one session per login and would sign the bot out."}
          </p>
        </Row>
      </section>
      {note && <p role="status" className="px-1 text-[13px] font-medium text-brand">{note}</p>}

      {localSignin && (
        <section className={`${card} flex flex-col gap-4 p-5`}>
          <div className="flex flex-col gap-0.5">
            <p className="font-display text-xl font-bold">Sign the bot in on the Mac</p>
            <p className="text-[13px] text-muted">A Chrome window with Clover&apos;s login just opened on the bot computer. Use that window, not your regular Chrome.</p>
          </div>
          <div className="rounded-2xl bg-brand-soft px-3.5 py-3">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-brand-dark">Log in as</span>
            <span className="break-all text-[16px] font-bold text-brand-dark">{store?.botEmail ?? "the bot's Clover login (an Admin employee, not you)"}</span>
          </div>
          {finishing === null ? (
            <>
              {steps}
              <button onClick={finishSignin} className={btnPrimary}>I&apos;m signed in</button>
            </>
          ) : (
            <div className="flex flex-col gap-3" role="status" aria-live="polite">
              <div className="flex items-center gap-3">
                <span aria-hidden="true" className="h-6 w-6 shrink-0 animate-spin rounded-full border-[3px] border-brand-soft border-t-brand" />
                <p className="text-[15px] font-semibold">
                  {Date.now() - finishing < 8000 ? "Got it. Saving your Clover sign-in…" : Date.now() - finishing < 20000 ? "Checking that Clover accepts it…" : "Almost done…"}
                </p>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-brand-soft">
                <div className="h-full rounded-full bg-brand transition-all duration-1000" style={{ width: `${Math.min(95, ((Date.now() - finishing) / 30000) * 100)}%` }} />
              </div>
              <p className="text-[13px] text-muted">This takes about 20 to 30 seconds. You can leave this screen; it finishes on its own.</p>
            </div>
          )}
          {finishing === null && (
            <button onClick={async () => { await fetch("/api/clover-login/cancel", { method: "POST" }); load(); }}
              className="py-1 text-sm font-semibold text-muted underline">Cancel</button>
          )}
        </section>
      )}

      {live && !localSignin && (
        <section className="flex flex-col gap-2">
          <p className="text-sm font-medium">
            {current?.status === "requested"
              ? (bot && !bot.online ? "The bot computer is off, so nothing can open. Start it (step 1 above), or tap Cancel." : "Waiting for the bot computer to open Clover (it finishes what it's doing first)…")
              : current?.message ?? "Tap the picture to click."}
          </p>
          {store?.botEmail && <p className="text-[13px] text-muted">Log in as <b className="break-all text-ink">{store.botEmail}</b></p>}
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

      <div className="mt-auto flex flex-col items-center gap-3 pb-1 pt-4">
        <button onClick={async () => { await fetch("/api/logout", { method: "POST" }); location.href = "/"; }}
          className="text-sm font-semibold text-muted underline">Sign out of this phone</button>
        <div className="flex items-center gap-2 text-xs text-muted"><span>Powered by</span><FixroMark variant="light" size="sm" /></div>
      </div>
      </div>
      <BottomNav active="clover" />
    </main>
  );
}
