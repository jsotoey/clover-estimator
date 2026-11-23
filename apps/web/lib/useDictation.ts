"use client";
import { useEffect, useRef, useState } from "react";

/* Minimal typing for the browser's speech recognition (Safari/Chrome call it webkitSpeechRecognition). */
type SRResult = ArrayLike<{ transcript: string }> & { isFinal: boolean };
type SR = {
  lang: string; continuous: boolean; interimResults: boolean;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<SRResult> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
  onstart: (() => void) | null; onaudiostart: (() => void) | null;
};
type Ctor = new () => SR;
/** One recognizer for the whole page, kept even when the estimate screen remounts (new estimate). */
let shared: SR | null = null;
const getCtor = (): Ctor | undefined => {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

/**
 * Tap the mic to talk, tap again to stop. Words are added after whatever is already in the box.
 *
 * iPhone Safari quirks this works around:
 * - The mic may only be started directly inside a tap (no waiting first).
 * - A second `new webkitSpeechRecognition()` on the same page often never hears anything again until the
 *   page is reloaded. So we create ONE recognizer per page and reuse it for every recording.
 * - If it's still shutting down when you tap again, we finish the shutdown and start as soon as it ends.
 * Add ?mic=debug to the page address to see what the browser reports, step by step.
 */
export function useDictation(onText: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [problem, setProblem] = useState("");
  const [trail, setTrail] = useState<string[]>([]);
  const debug = typeof window !== "undefined" && /[?&]mic=debug/.test(window.location.search);

  const rec = useRef<SR | null>(null);
  const active = useRef(false);        // the recognizer is running (between start() and its "end")
  const wanted = useRef(false);        // the person wants to be recording
  const pending = useRef<string | null>(null); // start again as soon as the last one ends, with this text
  const base = useRef("");
  const heard = useRef(false);
  const began = useRef(false);
  const cb = useRef(onText);
  cb.current = onText;
  const log = (s: string) => setTrail((t) => [...t.slice(-11), `${new Date().toLocaleTimeString([], { minute: "2-digit", second: "2-digit" })} ${s}`]);

  function recognizer(): SR | null {
    if (!shared) {
      const C = getCtor();
      if (!C) return null;
      shared = new C();
      shared.lang = "en-US"; shared.continuous = true; shared.interimResults = true;
    }
    const r = shared;
    // (Re)attach this screen's handlers: the recognizer outlives a remount, the handlers don't.
    r.onstart = () => { began.current = true; log("start"); };
    r.onaudiostart = () => { began.current = true; log("audio on"); };
    r.onresult = (e) => {
      began.current = true;
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0]?.transcript ?? "";
      if (text.trim()) heard.current = true;
      cb.current(`${base.current}${text}`.replace(/\s+/g, " ").trimStart());
    };
    r.onerror = (e) => {
      log(`error: ${e.error}`);
      if (e.error === "aborted") return;
      setProblem(e.error === "not-allowed" || e.error === "service-not-allowed"
        ? "Allow the microphone for this site: Settings › Apps › Safari › Microphone, or use the keyboard's mic."
        : e.error === "no-speech" ? "Didn't hear anything. Tap the mic and try again."
        : e.error === "audio-capture" ? "Another app or tab is using the mic. Close it and tap the mic again."
        : `The mic stopped (${e.error}). Tap it to try again.`);
    };
    r.onend = () => {
      log("end");
      active.current = false;
      if (pending.current !== null) { const t = pending.current; pending.current = null; begin(t); return; }
      wanted.current = false;
      setListening(false);
      if (!heard.current) setProblem((p) => p || "Didn't catch that. Tap the mic and try again.");
    };
    rec.current = r;
    return r;
  }

  function begin(current: string) {
    const r = recognizer();
    if (!r) return;
    base.current = current.trim() ? `${current.trim()} ` : "";
    heard.current = false;
    began.current = false;
    wanted.current = true;
    setListening(true);
    try {
      r.start();
      active.current = true;
      log("tap → start()");
    } catch (err) {
      log(`start() refused: ${(err as Error)?.name ?? err}`);
      // Still running from last time: stop it fully and start the moment it ends.
      pending.current = current;
      try { r.abort(); } catch { /* ignore */ }
      return;
    }
    setTimeout(() => {
      if (wanted.current && active.current && !began.current) {
        log("never started: resetting");
        try { r.abort(); } catch { /* ignore */ }
        shared = null; rec.current = null; // next tap builds a fresh recognizer
        active.current = false; wanted.current = false;
        setListening(false);
        setProblem("The mic didn't start. Tap it again, or use the mic on your keyboard.");
      }
    }, 4000);
  }

  useEffect(() => {
    setSupported(!!getCtor());
    const release = () => { pending.current = null; wanted.current = false; try { rec.current?.abort(); } catch { /* ignore */ } setListening(false); };
    const onHide = () => { if (document.visibilityState === "hidden") release(); };
    window.addEventListener("pagehide", release);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", release);
      document.removeEventListener("visibilitychange", onHide);
      release();
    };
  }, []);

  function start(current: string) {
    setProblem("");
    if (active.current) {
      // Tapped again while the last recording is still closing: finish it, then start.
      pending.current = current;
      wanted.current = true;
      setListening(true);
      log("tap while closing: will start after end");
      try { rec.current?.stop(); } catch { /* ignore */ }
      return;
    }
    begin(current);
  }

  function stop() {
    wanted.current = false;
    pending.current = null;
    setListening(false);
    log("tap → stop()");
    try { rec.current?.stop(); } catch { /* ignore */ }
  }

  return { supported, listening, problem, start, stop, trail: debug ? trail : [] };
}
