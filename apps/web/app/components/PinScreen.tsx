"use client";
import { useState } from "react";

export default function PinScreen() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const r = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin }) });
    setBusy(false);
    if (r.ok) location.reload(); else setError("Wrong PIN");
  }
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center p-6">
      <h1 className="text-3xl font-semibold">Estimates</h1>
      <p className="mt-1 text-neutral-500">Enter your PIN</p>
      <form onSubmit={submit} className="mt-6 space-y-3">
        <input value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" type="password" autoFocus
          className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-4 text-2xl tracking-widest" />
        {error && <p className="text-red-600">{error}</p>}
        <button disabled={busy || !pin} className="w-full rounded-xl bg-green-800 py-4 text-lg font-semibold text-white disabled:opacity-50">
          {busy ? "Checking…" : "Open"}
        </button>
      </form>
    </main>
  );
}
