"use client";
import { useEffect, useRef, useState } from "react";
import type { Estimate, PricingResult } from "@ce/core";
import { CLOVER_LIMITS } from "@ce/core";
import ReviewCard, { CHANGE_CHOICES } from "./ReviewCard";
import EstimateList, { type RecentItem } from "./EstimateList";
import { StatusBody, StatusSummary, StatusActions, nextInvoice, type StatusData } from "./EstimateStatus";
import { TopBar, BottomNav, ConnectionPill, btnPrimary, btnSecondary } from "./ui";
import { toCloverJpeg } from "@/lib/photos";
import { useDictation } from "@/lib/useDictation";

type Msg = { role: "user" | "assistant"; text: string; photos?: string[] };
type Ask = { question: string; options: string[]; datePicker: boolean };
const GREETING = "Tell me about the job: the customer's name and email, the work, the price, and when you start. Talk or type, all in one go. I'll put the estimate together.";

export default function EstimateApp({ businessName, taxRate }: { businessName: string; taxRate: number }) {
  const [view, setView] = useState<"chat" | "list">("chat");
  const [recent, setRecent] = useState<RecentItem[] | null>(null);
  const [estimateId, setEstimateId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([{ role: "assistant", text: GREETING }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [pendingPhotos, setPendingPhotos] = useState(0);
  const [review, setReview] = useState<{ estimate: Estimate; computed: PricingResult } | null>(null);
  const [status, setStatus] = useState<StatusData | null>(null);
  const [changing, setChanging] = useState(false);
  const [showEstimate, setShowEstimate] = useState(false);
  const [error, setError] = useState("");
  const [ask, setAsk] = useState<Ask | null>(null);
  const [clover, setClover] = useState<"on" | "off" | "unknown">("unknown");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const mic = useDictation(setInput);

  useEffect(() => { if (view === "chat") bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, review, status, ask, view]);

  // Clover connection pill in the top bar.
  useEffect(() => {
    const check = async () => {
      const r = await fetch("/api/clover-login", { cache: "no-store" }).catch(() => null);
      if (!r?.ok) return;
      const j = await r.json();
      setClover(j.waitingEstimates > 0 || j.current?.status !== "done" ? (j.current ? "off" : "unknown") : "on");
    };
    check();
    const t = setInterval(check, 30000);
    return () => clearInterval(t);
  }, []);

  // Follow the worker after approval; after sending, keep an eye on acceptance and invoices (slower).
  useEffect(() => {
    if (!estimateId || !status) return;
    const watching = status.status === "sent" && status.sentForReal &&
      (!status.acceptedAt || (status.invoices ?? []).some((i) => ["waiting", "approved", "sending"].includes(i.status)));
    if (!watching && ["sent", "failed"].includes(status.status)) return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/estimates/${estimateId}`, { cache: "no-store" });
      if (r.ok) setStatus(await r.json());
    }, watching ? 8000 : 3000);
    return () => clearInterval(t);
  }, [estimateId, status]);

  useEffect(() => {
    if (new URLSearchParams(location.search).get("recent")) {
      history.replaceState(null, "", "/");
      void showList();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function showList() {
    setView("list");
    const r = await fetch("/api/estimates", { cache: "no-store" });
    if (r.status === 401) return location.reload();
    if (r.ok) setRecent((await r.json()).estimates);
  }

  async function openEstimate(id: string) {
    const r = await fetch(`/api/estimates/${id}`, { cache: "no-store" });
    if (!r.ok) return;
    const d = await r.json();
    setView("chat");
    setEstimateId(id);
    setPhotos(d.photos ?? []); setPendingPhotos(0);
    setAsk(null); setError(""); setInput(""); setChanging(false); setShowEstimate(false);
    setMsgs([]);
    setReview(d.estimate && d.computed ? { estimate: d.estimate, computed: d.computed } : null);
    setStatus(["drafting", "ready_for_review"].includes(d.status) ? null : d);
    if (["drafting", "ready_for_review"].includes(d.status) && !(d.estimate && d.computed)) setMsgs([{ role: "assistant", text: GREETING }]);
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
        const fd = new FormData();
        fd.set("estimateId", id);
        fd.set("file", await toCloverJpeg(f));
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
    if (mic.listening) mic.stop();
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
      if (j.review) { setReview(j.review); setChanging(false); }
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
    const d = await fetch(`/api/estimates/${estimateId}`, { cache: "no-store" }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    setStatus(d ?? { status: "approved", error: null, cloverEstimateNumber: null, screenshots: [] });
  }

  async function retry() {
    if (!estimateId) return;
    const r = await fetch(`/api/estimates/${estimateId}/retry`, { method: "POST" });
    if (r.ok) setStatus((s) => (s ? { ...s, status: "approved", error: null } : s));
  }

  function startOver() {
    setView("chat");
    setEstimateId(null); setMsgs([{ role: "assistant", text: GREETING }]); setPhotos([]);
    setPendingPhotos(0); setReview(null); setStatus(null); setInput(""); setError(""); setAsk(null);
    setChanging(false); setShowEstimate(false);
  }

  function startChange(what?: string) {
    setChanging(true);
    if (what) setInput(`Change the ${what.toLowerCase()}: `);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  // ---------- screens ----------
  if (view === "list")
    return (
      <Shell>
        <TopBar title="Estimates" business={businessName} />
        <div className="flex-1 overflow-y-auto"><EstimateList items={recent} onOpen={openEstimate} /></div>
        <BottomNav active="list" onNew={startOver} onList={showList} />
      </Shell>
    );

  const hasStatus = !!status && !!estimateId;
  const title = hasStatus
    ? (status!.cloverEstimateNumber ? `Estimate #${status!.cloverEstimateNumber}` : "Estimate")
    : review ? "Review estimate" : "New estimate";
  const showInput = !hasStatus && (!review || changing);
  const actionKey = status ? `${status.status}-${nextInvoice(status)?.kind ?? ""}-${nextInvoice(status)?.status ?? ""}` : "";
  const statusActions = hasStatus && (status!.status === "failed" || nextInvoice(status!));
  const canSend = !!input.trim() || pendingPhotos > 0;

  return (
    <Shell>
      <TopBar title={title} business={businessName}
        onBack={hasStatus || review ? () => (hasStatus ? showList() : startOver()) : undefined}
        right={!hasStatus && !review ? <ConnectionPill state={clover} /> : undefined} />

      <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-4 py-[18px]">
        {hasStatus ? (
          <>
            <StatusSummary data={status!} />
            <StatusBody id={estimateId!} data={status!} />
            {review && (
              <>
                <button onClick={() => setShowEstimate((v) => !v)} aria-expanded={showEstimate}
                  className="self-start text-sm font-semibold text-brand underline">{showEstimate ? "Hide the estimate" : "View the estimate"}</button>
                {showEstimate && <ReviewCard estimate={review.estimate} computed={review.computed} photos={photos} businessName={businessName} taxRate={taxRate} readOnly />}
              </>
            )}
          </>
        ) : (
          <>
            {msgs.map((m, i) => (
              <div key={i} className={m.role === "user"
                ? "max-w-[85%] self-end whitespace-pre-wrap rounded-[18px_18px_4px_18px] bg-ink px-3.5 py-3 text-[15px] leading-relaxed text-white"
                : "max-w-[88%] self-start whitespace-pre-wrap rounded-[18px_18px_18px_4px] border border-line bg-white px-3.5 py-3 text-[15px] leading-relaxed"}>
                {m.photos && m.photos.length > 0 && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <div className="mb-2 flex gap-1.5">{m.photos.map((p) => <img key={p} src={p} alt="Job photo" className="h-14 w-14 rounded-lg object-cover" />)}</div>
                )}
                {m.text}
              </div>
            ))}
            {ask && !busy && (ask.options.length > 0 || ask.datePicker) && (
              <div className="flex flex-wrap gap-2 self-start">
                {ask.options.map((o) => (
                  <button key={o} onClick={() => send(o)}
                    className="h-10 rounded-full border border-edge bg-white px-3.5 text-sm font-medium">{o}</button>
                ))}
                {ask.datePicker && (
                  <label className="relative flex h-10 items-center rounded-full border-2 border-brand bg-brand-soft px-3.5 text-sm font-semibold text-brand-dark">
                    Pick a date
                    <input type="date" aria-label="Pick a date" className="absolute inset-0 opacity-0"
                      onChange={(e) => { if (e.target.value) send(new Date(`${e.target.value}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })); }} />
                  </label>
                )}
              </div>
            )}
            {busy && <p className="self-start text-sm text-muted">Working on it…</p>}
            {review && <ReviewCard estimate={review.estimate} computed={review.computed} photos={photos} businessName={businessName} taxRate={taxRate} />}
          </>
        )}
        {error && <p className="text-sm font-medium text-bad">{error}</p>}
        <div ref={bottomRef} />
      </div>

      {/* Bottom action area */}
      {hasStatus && statusActions && (
        <div className="border-t border-line bg-white px-4 pb-2.5 pt-3">
          <StatusActions key={actionKey} id={estimateId!} data={status!} onRetry={retry} />
        </div>
      )}
      {!hasStatus && review && !changing && (
        <div className="flex flex-col gap-2.5 border-t border-line bg-white px-4 pb-2.5 pt-3">
          <button onClick={approve} disabled={busy} className={btnPrimary}>{busy ? "Working…" : `Approve and ${review.estimate.delivery === "both" ? "send by email and text" : review.estimate.delivery === "sms" ? "text it" : "email it"}`}</button>
          <button onClick={() => startChange()} disabled={busy} className={btnSecondary}>Change something</button>
        </div>
      )}
      {showInput && (
        <div className="flex flex-col gap-2 border-t border-line bg-white px-4 pb-2.5 pt-3">
          {changing && (
            <div className="flex items-center gap-2 overflow-x-auto">
              {CHANGE_CHOICES.map((w) => (
                <button key={w} onClick={() => startChange(w)} className="h-9 shrink-0 rounded-full border border-edge bg-white px-3 text-[13px] font-medium">{w}</button>
              ))}
              <button onClick={() => { setChanging(false); setInput(""); }} className="ml-auto h-9 shrink-0 px-2 text-[13px] font-semibold text-muted underline">Cancel</button>
            </div>
          )}
          {pendingPhotos > 0 && <p className="text-xs text-muted">{pendingPhotos} photo{pendingPhotos > 1 ? "s" : ""} ready to send</p>}
          {mic.problem && <p className="text-xs text-bad">{mic.problem}</p>}
          <div className="flex items-end gap-2.5">
            <button onClick={() => fileRef.current?.click()} disabled={busy || photos.length >= CLOVER_LIMITS.maxAttachments}
              aria-label="Add a photo" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-edge bg-white disabled:opacity-40">
              <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
            </button>
            <input ref={fileRef} type="file" accept="image/*,.heic,.heif" multiple hidden onChange={(e) => addPhotos(e.target.files)} />
            <label htmlFor="msg" className="sr-only">Message</label>
            <textarea id="msg" ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} rows={1}
              placeholder={mic.listening ? "Listening… tap the mic to stop" : changing ? "Tell me what to change" : mic.supported ? "Type, or tap the mic to talk" : "Describe the job"}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              className="max-h-32 min-h-11 min-w-0 flex-1 resize-none rounded-xl border border-edge px-3 py-[10px] text-base" />
            {mic.supported && (mic.listening || !canSend) ? (
              <button onClick={() => (mic.listening ? mic.stop() : mic.start(input))} disabled={busy}
                aria-label={mic.listening ? "Stop listening" : "Talk"} aria-pressed={mic.listening}
                className={`flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full disabled:opacity-50 ${mic.listening ? "ce-recording bg-bad" : "bg-brand"}`}>
                {mic.listening
                  ? <span aria-hidden="true" className="h-4 w-4 rounded-[3px] bg-white" />
                  : <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>}
              </button>
            ) : (
              <button onClick={() => send()} disabled={busy || !canSend} aria-label="Send"
                className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-brand disabled:opacity-40">
                <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5.5 11.5L12 5l6.5 6.5" /></svg>
              </button>
            )}
          </div>
        </div>
      )}
      <BottomNav active={hasStatus ? "list" : "new"} onNew={startOver} onList={showList} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto flex h-dvh max-w-md flex-col bg-paper">{children}</main>;
}

