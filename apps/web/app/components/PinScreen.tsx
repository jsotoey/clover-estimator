"use client";
import { useState } from "react";
import { FixroMark, btnPrimary } from "./ui";

export default function PinScreen({ businessName }: { businessName?: string }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const r = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin }) });
    setBusy(false);
    if (r.ok) location.reload(); else setError("That PIN didn't match. Try again.");
  }
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col">
      <section className="flex flex-col gap-6 bg-[#111111] px-6 pb-10 pt-16">
        <FixroMark />
        {businessName && <p className="text-[15px] text-[#C9C9C4]">Estimates for <span className="font-semibold text-white">{businessName}</span></p>}
      </section>
      <form onSubmit={submit} className="flex flex-1 flex-col gap-3 p-6">
        <label htmlFor="pin" className="text-sm font-semibold text-muted">Your PIN</label>
        <input id="pin" value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" type="password" autoFocus autoComplete="current-password"
          className="h-14 w-full rounded-[14px] border border-edge bg-white px-4 text-2xl tracking-[0.4em]" />
        {error && <p className="text-sm font-medium text-bad">{error}</p>}
        <button disabled={busy || !pin} className={btnPrimary}>{busy ? "Checking…" : "Open"}</button>
      </form>
    </main>
  );
}
