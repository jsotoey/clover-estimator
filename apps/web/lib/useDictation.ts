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
const getCtor = (): Ctor | undefined => {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

/**
 * Tap the mic to talk, tap again to stop. Words are added after whatever is already in the box, so you
 * can record, fix, and record more.
 *
 * iPhone Safari is the hard case:
 * - after stop() it sometimes never fires "end", so waiting for the old recording forever left the mic dead
 *   (every later tap did nothing). We now wait at most ~1.2s, then abort it and move on.
 * - it can keep the mic tied to a page you left or refreshed, so the next page's first recording hears
 *   nothing. We abort on page hide/unload so the mic is let go, and if a recording doesn't really start
 *   within a few seconds we reset and say so instead of showing "Listening…" over silence.
 */
export function useDictation(onText: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [problem, setProblem] = useState("");
  const rec = useRef<SR | null>(null);
  const gen = useRef(0); // which recording owns the text box; a new tap takes over, stop() doesn't
  const cb = useRef(onText);
  cb.current = onText;

  useEffect(() => {
    setSupported(!!getCtor());
    // Let go of the mic when leaving, refreshing, or switching apps.
    const release = () => { const r = rec.current; rec.current = null; r?.abort(); setListening(false); };
    const onHide = () => { if (document.visibilityState === "hidden") release(); };
    window.addEventListener("pagehide", release);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", release);
      document.removeEventListener("visibilitychange", onHide);
      release();
    };
  }, []);

  // Must stay synchronous: iPhone Safari only allows the mic to start directly inside the tap. Any
  // await before r.start() (waiting for the last recording to end) silently breaks every later recording.
  function start(current: string, retry = true) {
    const C = getCtor();
    if (!C) return;
    setProblem("");
    if (rec.current) { const old = rec.current; rec.current = null; try { old.abort(); } catch { /* already gone */ } }

    const mine = ++gen.current;
    const r = new C();
    r.lang = "en-US"; r.continuous = true; r.interimResults = true;
    const base = current.trim() ? `${current.trim()} ` : "";
    let heard = false;
    let started = false;

    r.onstart = r.onaudiostart = () => { started = true; };
    r.onresult = (e) => {
      if (gen.current !== mine) return; // late words after Stop still land; an old recording's don't
      started = true;
      // Rebuild from every result each time: Safari's resultIndex isn't reliable on later recordings.
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0]?.transcript ?? "";
      if (text.trim()) heard = true;
      cb.current(`${base}${text}`.replace(/\s+/g, " ").trimStart());
    };
    r.onerror = (e) => {
      if (e.error === "aborted" || rec.current !== r) return;
      setProblem(e.error === "not-allowed" || e.error === "service-not-allowed"
        ? "Allow the microphone for this site: Settings › Apps › Safari › Microphone, or use the keyboard's mic."
        : e.error === "no-speech" ? "Didn't hear anything. Tap the mic and try again."
        : e.error === "audio-capture" ? "Another app or tab is using the mic. Close it and tap the mic again."
        : `The mic stopped (${e.error}). Tap it to try again.`);
    };
    r.onend = () => {
      if (rec.current !== r) return;
      rec.current = null; setListening(false);
      if (!heard) setProblem((p) => p || "Didn't catch that. Tap the mic and try again.");
    };
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      // The old recording hadn't let go yet. One quick retry; if that fails too, ask for another tap.
      rec.current = null;
      if (retry) { setListening(true); setTimeout(() => start(current, false), 400); return; }
      setListening(false);
      setProblem("The mic didn't start. Tap it again.");
      return;
    }
    // If the browser never actually starts listening, don't sit on "Listening…" over silence.
    setTimeout(() => {
      if (rec.current === r && !started) {
        rec.current = null; try { r.abort(); } catch { /* gone */ }
        setListening(false);
        setProblem("The mic didn't start. Tap it again, or use the mic on your keyboard.");
      }
    }, 4000);
  }

  function stop() {
    const r = rec.current;
    setListening(false);
    if (!r) return;
    rec.current = null;            // the next tap starts a fresh recording right away
    try { r.stop(); } catch { /* gone */ }
  }

  return { supported, listening, problem, start, stop };
}
