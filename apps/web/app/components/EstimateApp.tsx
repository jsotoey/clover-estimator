"use client";
import { useEffect, useRef, useState } from "react";
import type { Estimate, PricingResult } from "@ce/core";
import { CLOVER_LIMITS } from "@ce/core";
import ReviewCard from "./ReviewCard";
import StatusBanner, { type StatusData } from "./StatusBanner";
import { toCloverJpeg } from "@/lib/photos";

type Msg = { role: "user" | "assistant"; text: string; photos?: string[] };
const GREETING = "Hey! Tell me about the job: who it's for, what you're doing, and what you want to charge. Voice works too, just tap the mic on your keyboard.";

export default function EstimateApp() {
  const [estimateId, setEstimateId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([{ role: "assistant", text: GREETING }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [pendingPhotos, setPendingPhotos] = useState(0);
  const [review, setReview] = useState<{ estimate: Estimate; computed: PricingResult } | null>(null);
  const [status, setStatus] = useState<StatusData | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, review, status]);

  // Poll the worker's progress after approval.
  useEffect(() => {
    if (!estimateId || !status || ["sent", "failed"].includes(status.status)) return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/estimates/${estimateId}`);
      if (r.ok) setStatus(await r.json());
    }, 3000);
    return () => clearInterval(t);
  }, [estimateId, status]);

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

  async function send() {
    const text = input.trim();
    if ((!text && !pendingPhotos) || busy) return;
    setBusy(true); setError("");
    const shownPhotos = photos.slice(photos.length - pendingPhotos);
    setMsgs((m) => [...m, { role: "user", text, photos: shownPhotos }]);
    setInput("");
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
      setReview(j.review ?? null);
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
    setPendingPhotos(0); setReview(null); setStatus(null); setInput(""); setError("");
  }

  const locked = !!status; // after approval the chat is read-only

  return (
    <main className="mx-auto flex h-dvh max-w-md flex-col">
      <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3">
        <h1 className="text-lg font-semibold">New estimate</h1>
        <button onClick={startOver} className="text-sm font-medium text-green-800">+ New</button>
      </header>

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
        {busy && !status && <div className="text-sm text-neutral-400">…</div>}
        {review && !status && (
          <ReviewCard estimate={review.estimate} computed={review.computed} photos={photos} busy={busy}
            onApprove={approve} onChange={() => { setReview(null); setInput(""); }} />
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
            <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1} placeholder="Describe the job…"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              className="max-h-32 min-h-12 flex-1 resize-none rounded-xl border border-neutral-300 px-3 py-3 text-base" />
            <button onClick={send} disabled={busy || (!input.trim() && !pendingPhotos)}
              className="h-12 shrink-0 rounded-xl bg-green-800 px-4 font-semibold text-white disabled:opacity-40">Send</button>
          </div>
        </div>
      )}
    </main>
  );
}
