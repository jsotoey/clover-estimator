"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Login = { id: number; status: string; reason: string | null; message: string | null; created_at: string; finished_at: string | null };
type Hist = { id: number; status: string; reason: string | null; created_at: string; finished_at: string | null; seconds: number | null };

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Sign in to Clover through a live view of the worker's browser. */
export default function CloverConnect() {
  const [current, setCurrent] = useState<Login | null>(null);
  const [history, setHistory] = useState<Hist[]>([]);
  const [waiting, setWaiting] = useState(0);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/clover-login", { cache: "no-store" });
    if (r.status === 401) return location.reload();
    const j = await r.json();
    setCurrent(j.current); setHistory(j.history); setWaiting(j.waitingEstimates);
  }, []);

  useEffect(() => { load(); }, [load]);

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
    }, 800);
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
  function tap(e: React.MouseEvent<HTMLImageElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    send({ kind: "click", x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
  }
  async function sendText() {
    if (!text) return;
    await send({ kind: "type", text });
    setText("");
  }

  const lastDone = history.find((h) => h.status === "done");

  return (
    <main className="mx-auto max-w-md p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Connect Clover</h1>
        <a href="/" className="text-sm font-medium text-green-800">← Estimates</a>
      </div>

      {!live && (
        <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
          {current?.status === "done" ? (
            <p className="text-green-800">✓ Connected{lastDone?.finished_at ? ` since ${fmt(lastDone.finished_at)}` : ""}.</p>
          ) : (
            <p className="text-neutral-700">Sign in to M&amp;J&apos;s Clover once and the app keeps you connected until Clover asks again.</p>
          )}
          {waiting > 0 && <p className="mt-2 text-amber-800">{waiting} estimate{waiting > 1 ? "s are" : " is"} waiting for you to sign in.</p>}
          {current?.status === "failed" && <p className="mt-2 text-red-700">{current.message}</p>}
          <button onClick={start} disabled={busy} className="mt-4 w-full rounded-xl bg-green-800 py-3 font-semibold text-white disabled:opacity-50">
            {busy ? "Starting…" : current?.status === "done" ? "Sign in again" : "Sign in to Clover"}
          </button>
        </div>
      )}

      {live && (
        <div className="mt-4 space-y-3">
          <p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-900">
            {current?.status === "requested" ? "Opening Clover… (a few seconds)" : current?.message ?? "Tap the picture to click. Use the box to type."}
          </p>
          {frameUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img ref={imgRef} src={frameUrl} alt="Clover sign-in" onClick={tap} className="w-full cursor-pointer rounded-lg border border-neutral-300" />
          ) : (
            <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-neutral-300 text-neutral-400">Loading picture…</div>
          )}
          <div className="flex gap-2">
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type here (e.g. the code)" inputMode="text" autoComplete="one-time-code"
              className="min-w-0 flex-1 rounded-xl border border-neutral-300 px-3 py-3 text-base" />
            <button onClick={sendText} className="rounded-xl bg-green-800 px-4 font-semibold text-white">Type</button>
          </div>
          <div className="grid grid-cols-4 gap-2 text-sm">
            {["Enter", "Tab", "Backspace", "Escape"].map((k) => (
              <button key={k} onClick={() => send({ kind: "key", text: k })} className="rounded-lg border border-neutral-300 py-2">{k === "Backspace" ? "⌫" : k}</button>
            ))}
          </div>
          <button onClick={async () => { await fetch("/api/clover-login/cancel", { method: "POST" }); load(); }} className="w-full py-2 text-sm text-neutral-500 underline">Cancel</button>
        </div>
      )}

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Sign-in history</h2>
        {history.length === 0 ? <p className="mt-2 text-sm text-neutral-500">None yet.</p> : (
          <ul className="mt-2 divide-y divide-neutral-100 rounded-xl bg-white text-sm shadow-sm">
            {history.map((h, i) => {
              const prev = history[i + 1];
              const gapHrs = prev?.finished_at && h.created_at ? Math.round((new Date(h.created_at).getTime() - new Date(prev.finished_at).getTime()) / 36e5) : null;
              return (
                <li key={h.id} className="flex justify-between px-3 py-2">
                  <span>{fmt(h.created_at)} · {h.reason === "estimate" ? "needed for an estimate" : "manual"}</span>
                  <span className={h.status === "done" ? "text-green-800" : "text-red-700"}>
                    {h.status === "done" ? `✓ ${h.seconds ?? "?"}s` : "failed"}{gapHrs !== null ? ` · ${gapHrs}h after last` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
