"use client";
import { useState } from "react";

export interface StatusData {
  status: string; signInOpen?: boolean; error: string | null; cloverEstimateNumber: string | null; screenshots: string[];
}

export default function StatusBanner({ id, data, onRetry }: { id: string; data: StatusData; onRetry: () => void }) {
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const last = data.screenshots[data.screenshots.length - 1];

  if (data.status === "needs_login" || (data.status === "approved" && data.signInOpen))
    return (
      <div className="rounded-xl bg-amber-50 p-4 text-amber-900">
        <p className="font-semibold">Waiting for you to sign in to Clover</p>
        <p className="text-sm">Your estimate is saved and goes into Clover right after you sign in.</p>
        <a href="/clover" className="mt-2 inline-block rounded-lg bg-amber-700 px-4 py-2 font-semibold text-white">Finish signing in</a>
      </div>
    );

  if (data.status === "approved" || data.status === "sending")
    return <div className="rounded-xl bg-blue-50 p-4 text-blue-900">Putting it into Clover… this takes about a minute.</div>;

  if (data.status === "needs_code")
    return (
      <div className="rounded-xl bg-amber-50 p-4 text-amber-900">
        <p className="font-semibold">Clover sent a verification code</p>
        <p className="text-sm">Check the email or phone on the Clover login and type it here.</p>
        {sent ? <p className="mt-2 text-sm">Got it, continuing…</p> : (
          <div className="mt-2 flex gap-2">
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code"
              className="flex-1 rounded-lg border border-amber-300 bg-white px-3 py-2 text-lg tracking-widest" />
            <button className="rounded-lg bg-amber-700 px-4 font-semibold text-white" onClick={async () => {
              const r = await fetch(`/api/estimates/${id}/code`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
              if (r.ok) setSent(true);
            }}>Send</button>
          </div>
        )}
      </div>
    );

  if (data.status === "sent")
    return (
      <div className="rounded-xl bg-green-50 p-4 text-green-900">
        <p className="font-semibold">{data.error?.startsWith("dry run") ? "Test run done (not sent to customer)" : "Sent ✓"}</p>
        {data.cloverEstimateNumber && <p className="text-sm">Clover estimate #{data.cloverEstimateNumber}</p>}
        {data.error && !data.error.startsWith("dry run") && <p className="text-sm">{data.error}</p>}
        {data.error?.includes("test lock") && <p className="text-sm">Test lock is on: only your test contacts get real estimates.</p>}
        {last && <a href={last} target="_blank" className="text-sm underline">See screenshot</a>}
      </div>
    );

  if (data.status === "failed")
    return (
      <div className="rounded-xl bg-red-50 p-4 text-red-900">
        <p className="font-semibold">Didn&apos;t go through</p>
        <p className="text-sm">{data.error}</p>
        <div className="mt-2 flex gap-3">
          {last && <a href={last} target="_blank" className="text-sm underline">Screenshot</a>}
          <button onClick={onRetry} className="text-sm font-semibold underline">Try again</button>
        </div>
      </div>
    );
  return null;
}
