"use client";
import { useEffect, useRef, useState } from "react";
import type { Estimate, PricingResult } from "@ce/core";
import { CLOVER_LIMITS } from "@ce/core";
import ReviewCard from "./ReviewCard";
import AppHeader from "./AppHeader";
import StatusBanner, { type StatusData } from "./StatusBanner";
import { toCloverJpeg } from "@/lib/photos";

type Msg = { role: "user" | "assistant"; text: string; photos?: string[] };
type Ask = { question: string; options: string[]; datePicker: boolean };
const GREETING = "Tell me about the job: the customer's name and email, the work, the price, and when you start. Talk or type, all in one go. I'll put the estimate together.";

type RecentItem = { id: string; status: string; error: string | null; number: string | null; accepted_at: string | null; updated_at: string; customer: string | null; total_cents: number | null };

function recentLabel(r: RecentItem): string {
  if (r.status === "sent") return r.error?.startsWith("dry run") ? "Test run" : r.accepted_at ? "Accepted" : "Sent";
  return ({ ready_for_review: "Ready to approve", approved: "In progress", sending: "In progress", needs_login: "Waiting for sign-in", failed: "Didn't go through", drafting: "Draft" } as Record<string, string>)[r.status] ?? r.status;
}

export default function EstimateApp({ businessName, taxRate }: { businessName: string; taxRate: number }) {
  const [estimateId, setEstimateId] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentItem[] | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([{ role: "assistant", text: GREETING }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [pendingPhotos, setPendingPhotos] = useState(0);
  const [review, setReview] = useState<{ estimate: Estimate; computed: PricingResult } | null>(null);
  const [status, setStatus] = useState<StatusData | null>(null);
  const [error, setError] = useState("");
  const [ask, setAsk] = useState<Ask | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, review, status]);

  // Poll the worker's progress after approval.
  useEffect(() => {
    if (!estimateId || !status) return;
    // After sending, keep an eye on acceptance and invoices (slower).
    const watching = status.status === "sent" && status.sentForReal &&
      (!status.acceptedAt || (status.invoices ?? []).some((i) => ["waiting", "approved", "sending"].includes(i.status)));
    if (!watching && ["sent", "failed"].includes(status.status)) return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/estimates/${estimateId}`);
      if (r.ok) setStatus(await r.json());
    }, watching ? 8000 : 3000);
    return () => clearInterval(t);
  }, [estimateId, status]);

  useEffect(() => {
    if (typeof window !== "undefined" && new URLSearchParams(location.search).get("recent")) {
      history.replaceState(null, "", "/");
      void showRecent();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function showRecent() {
    const r = await fetch("/api/estimates", { cache: "no-store" });
    if (r.ok) setRecent((await r.json()).estimates);
  }

  async function openEstimate(id: string) {
    const r = await fetch(`/api/estimates/${id}`, { cache: "no-store" });
    if (!r.ok) return;
    const d = await r.json();
    setRecent(null);
    setEstimateId(id);
    setPhotos(d.photos ?? []);
    setAsk(null); setError(""); setInput("");
    const who = d.estimate?.customer?.name ?? "this customer";
    setMsgs([{ role: "assistant", text: `Estimate for ${who}${d.cloverEstimateNumber ? ` (Clover #${d.cloverEstimateNumber})` : ""}.` }]);
    // Show the estimate itself (customer, items, totals); read-only once it has gone to Clover.
    setReview(d.estimate && d.computed ? { estimate: d.estimate, computed: d.computed } : null);
    setStatus(["drafting", "ready_for_review"].includes(d.status) ? null : d);
    try { localStorage.setItem("lastEstimate", id); } catch { /* not available */ }
  }

  async function ensureEstimate(): Promise<string> {
    if (estimateId) return estimateId;
    const r = await fetch("/api/estimates", { method: "POST" });
    if (r.status === 401) { location.reload(); throw new Error("signed out"); }
    const { id } = await r.json();
    setEstimateId(id);
    return id;
  }

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    setError("");
    const room = CLOVER_LIMITS.maxAttachments - photos.length;
    const list = Array.from(files).slice(0, room);
    if (files.length > room) setError(`Clover takes 3 photos max, so I kept ${room}.`);
    setBusy(true);
    try {
      const id = await ensureEstimate();
      for (const f of list) {
        const jpeg = await toCloverJpeg(f);
        const fd = new FormData();
        fd.set("estimateId", id);
        fd.set("file", jpeg);
        const r = await fetch("/api/upload", { method: "POST", body: fd });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Upload failed");
        setPhotos((p) => [...p, j.url]);
        setPendingPhotos((n) => n + 1);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Photo upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function send(override?: string) {
    const text = (override ?? input).trim();
    if ((!text && !pendingPhotos) || busy) return;
    setBusy(true); setError("");
    const shownPhotos = photos.slice(photos.length - pendingPhotos);
    setMsgs((m) => [...m, { role: "user", text, photos: shownPhotos }]);
    if (override === undefined) setInput("");
    setAsk(null);
    try {
      const id = await ensureEstimate();
      const r = await fetch("/api/chat", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ estimateId: id, message: text, photoCount: pendingPhotos }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Something went wrong");
      setPendingPhotos(0);
      if (j.reply) setMsgs((m) => [...m, { role: "assistant", text: j.reply }]);
      if (j.review) setReview(j.review); // otherwise the current estimate stays on screen
      setAsk(j.ask ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!estimateId) return;
    setBusy(true); setError("");
    const r = await fetch(`/api/estimates/${estimateId}/approve`, { method: "POST" });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) return setError(j.error ?? "Could not approve");
    setStatus({ status: "approved", error: null, cloverEstimateNumber: null, screenshots: [] });
  }

  async function retry() {
    if (!estimateId) return;
    const r = await fetch(`/api/estimates/${estimateId}/retry`, { method: "POST" });
    if (r.ok) setStatus((s) => (s ? { ...s, status: "approved", error: null } : s));
  }

  function startOver() {
    setEstimateId(null); setMsgs([{ role: "assistant", text: GREETING }]); setPhotos([]);
    setPendingPhotos(0); setReview(null); setStatus(null); setInput(""); setError(""); setAsk(null);
  }

  const locked = !!status; // after approval the chat is read-only

  return (
    <main className="mx-auto flex h-dvh max-w-md flex-col">
      <AppHeader active={recent ? "recent" : "estimate"} onRecent={() => (recent ? setRecent(null) : showRecent())} onNew={() => { setRecent(null); startOver(); }} />

      {recent && (
        <div className="fixed inset-x-0 bottom-0 top-[53px] z-20 flex flex-col bg-neutral-50">
          <div className="mx-auto w-full max-w-md flex-1 overflow-y-auto p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Recent estimates</h2>
            {recent.length === 0 && <p className="text-neutral-500">None yet.</p>}
            {recent.map((r) => (
              <button key={r.id} onClick={() => openEstimate(r.id)}
                className="mb-2 flex w-full items-center justify-between rounded-xl border border-neutral-200 bg-white px-4 py-3 text-left">
                <span>
                  <span className="block font-medium">{r.customer ?? "No customer yet"}{r.number ? ` · #${r.number}` : ""}</span>
                  <span className="block text-xs text-neutral-500">{new Date(r.updated_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {recentLabel(r)}</span>
                </span>
                <span className="font-semibold tabular-nums">{r.total_cents != null ? `$${(r.total_cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : ""}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 ${m.role === "user" ? "bg-green-800 text-white" : "bg-white shadow-sm"}`}>
              {m.photos && m.photos.length > 0 && (
                <div className="mb-1 flex gap-1">{m.photos.map((p) => <img key={p} src={p} alt="" className="h-14 w-14 rounded object-cover" />)}</div>
              )}
              {m.text}
            </div>
          </div>
        ))}
        {ask && !busy && !status && (
          <div className="flex flex-wrap gap-2">
            {ask.options.map((o) => (
              <button key={o} onClick={() => send(o)} className="rounded-full border border-green-800 bg-white px-4 py-2 text-sm font-medium text-green-900">{o}</button>
            ))}
            {ask.datePicker && (
              <label className="relative rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700">
                Pick a date
                <input type="date" className="absolute inset-0 opacity-0"
                  onChange={(e) => { if (e.target.value) send(new Date(`${e.target.value}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })); }} />
              </label>
            )}
          </div>
        )}
        {busy && !status && <div className="text-sm text-neutral-400">Working on it…</div>}
        {review && (
          <ReviewCard estimate={review.estimate} computed={review.computed} photos={photos} busy={busy} readOnly={!!status}
            businessName={businessName} taxRate={taxRate} onApprove={approve}
            onEdit={(what) => { setInput(`Change the ${what.toLowerCase()}: `); inputRef.current?.focus(); }} />
        )}
        {status && estimateId && <StatusBanner id={estimateId} data={status} onRetry={retry} />}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div ref={bottomRef} />
      </div>

      {!locked && (
        <div className="border-t border-neutral-200 bg-white p-3">
          {pendingPhotos > 0 && <p className="mb-1 text-xs text-neutral-500">{pendingPhotos} photo{pendingPhotos > 1 ? "s" : ""} ready to send</p>}
          <div className="flex items-end gap-2">
            <button onClick={() => fileRef.current?.click()} disabled={busy || photos.length >= CLOVER_LIMITS.maxAttachments}
              aria-label="Add photos" className="h-12 w-12 shrink-0 rounded-xl border border-neutral-300 text-xl disabled:opacity-40">📷</button>
            <input ref={fileRef} type="file" accept="image/*,.heic,.heif" multiple hidden onChange={(e) => addPhotos(e.target.files)} />
            <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} rows={1} placeholder={review ? "Tell me what to change…" : "Describe the job…"}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              className="max-h-32 min-h-12 flex-1 resize-none rounded-xl border border-neutral-300 px-3 py-3 text-base" />
            <button onClick={() => send()} disabled={busy || (!input.trim() && !pendingPhotos)}
              className="h-12 shrink-0 rounded-xl bg-green-800 px-4 font-semibold text-white disabled:opacity-40">Send</button>
          </div>
        </div>
      )}
    </main>
  );
}
