"use client";
import { useEffect, useRef, useState } from "react";

/* Minimal typing for the browser's speech recognition (Safari/Chrome call it webkitSpeechRecognition). */
type SR = {
  lang: string; continuous: boolean; interimResults: boolean;
  start(): void; stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
};

/**
 * Tap the mic to talk, tap again to stop. Words go into the message box as you speak, so you can
 * fix anything before sending. Returns supported=false where the browser has no speech recognition.
 */
export function useDictation(onText: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [problem, setProblem] = useState("");
  const rec = useRef<SR | null>(null);
  const base = useRef("");
  const cb = useRef(onText);
  cb.current = onText;

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    setSupported(!!(w.SpeechRecognition ?? w.webkitSpeechRecognition));
  }, []);

  function start(current: string) {
    const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = "en-US"; r.continuous = true; r.interimResults = true;
    base.current = current.trim() ? `${current.trim()} ` : "";
    let finalText = "";
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript; else interim += res[0].transcript;
      }
      cb.current(`${base.current}${finalText}${interim}`.replace(/\s+/g, " "));
    };
    r.onerror = (e) => {
      setProblem(e.error === "not-allowed" || e.error === "service-not-allowed"
        ? "Allow the microphone for this site in your phone's settings, or use the keyboard's mic."
        : e.error === "no-speech" ? "Didn't hear anything. Tap the mic and try again." : "");
    };
    r.onend = () => setListening(false);
    rec.current = r;
    setProblem("");
    try { r.start(); setListening(true); } catch { setListening(false); }
  }
  function stop() { rec.current?.stop(); setListening(false); }

  return { supported, listening, problem, start, stop };
}
