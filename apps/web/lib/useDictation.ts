"use client";
import { useEffect, useRef, useState } from "react";

/* Minimal typing for the browser's speech recognition (Safari/Chrome call it webkitSpeechRecognition). */
type SRResult = ArrayLike<{ transcript: string }> & { isFinal: boolean };
type SR = {
  lang: string; continuous: boolean; interimResults: boolean;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<SRResult> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
};
type Ctor = new () => SR;
const getCtor = (): Ctor | undefined => {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

/**
 * Tap the mic to talk, tap again to stop. Words are added after whatever is already in the box, so you
 * can record, fix, and record more. Each recording gets a fresh recognizer; if the last one is still
 * shutting down (iPhone Safari is slow to let go of the mic), we wait for it first, otherwise the new
 * recording silently captures nothing.
 */
export function useDictation(onText: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [problem, setProblem] = useState("");
  const rec = useRef<SR | null>(null);
  const ending = useRef<Promise<void> | null>(null);
  const cb = useRef(onText);
  cb.current = onText;

  useEffect(() => {
    setSupported(!!getCtor());
    return () => { rec.current?.abort(); };
  }, []);

  async function start(current: string) {
    const C = getCtor();
    if (!C) return;
    setProblem("");
    if (ending.current) await ending.current;          // let the previous recording fully end
    if (rec.current) { rec.current.abort(); rec.current = null; }

    const r = new C();
    r.lang = "en-US"; r.continuous = true; r.interimResults = true;
    const base = current.trim() ? `${current.trim()} ` : "";
    let heard = false;
    let done!: () => void;
    ending.current = new Promise<void>((res) => (done = res));

    r.onresult = (e) => {
      if (rec.current !== r) return;
      // Rebuild from every result each time: Safari's resultIndex isn't reliable on later recordings.
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0]?.transcript ?? "";
      if (text.trim()) heard = true;
      cb.current(`${base}${text}`.replace(/\s+/g, " ").trimStart());
    };
    r.onerror = (e) => {
      if (e.error === "aborted") return;
      setProblem(e.error === "not-allowed" || e.error === "service-not-allowed"
        ? "Allow the microphone for this site in your phone's settings, or use the keyboard's mic."
        : e.error === "no-speech" ? "Didn't hear anything. Tap the mic and try again." : "The mic stopped. Tap it to try again.");
    };
    r.onend = () => {
      if (rec.current === r) { rec.current = null; setListening(false); if (!heard) setProblem((p) => p || "Didn't catch that. Tap the mic and try again."); }
      ending.current = null;
      done();
    };
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      rec.current = null; ending.current = null; done();
      setListening(false);
      setProblem("The mic didn't start. Tap it again.");
    }
  }

  function stop() {
    rec.current?.stop();      // onend finishes the cleanup
    setListening(false);
  }

  return { supported, listening, problem, start, stop };
}
