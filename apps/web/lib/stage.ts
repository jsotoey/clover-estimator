/**
 * Where an estimate is in its life, for the progress bar and the "what's next" line.
 * One place so the list, the estimate screen and Today all say the same thing.
 */
export type StageInput = {
  status: string;
  error: string | null;
  acceptedAt: string | null;
  invoices: { kind: string; status: string }[];
  install: string | null; // installs.status, or null when no install yet
};
export type Tone = "good" | "warn" | "bad" | "plain";
export type Group = "needs" | "waiting" | "paid" | "other";

export const isPaid = (s: string) => s === "paid" || s === "paid_in_person";

export function stage(x: StageInput): {
  steps: string[]; done: number; tone: Tone; tag: string; next: string; group: Group;
} {
  const inv = x.invoices ?? [];
  const hasDeposit = !inv.length || inv.some((i) => i.kind === "deposit") || !!x.install;
  const steps = hasDeposit ? ["Sent", "Accepted", "Deposit", "Install", "Paid"] : ["Sent", "Accepted", "Paid"];
  const r = (done: number, tone: Tone, tag: string, next: string, group: Group) => ({ steps, done, tone, tag, next, group });

  switch (x.status) {
    case "failed": return r(0, "bad", "Needs you", "Didn't go into Clover. Open to retry.", "needs");
    case "needs_login": case "needs_code": return r(0, "bad", "Needs you", "Clover sign-in needed", "needs");
    case "approved": case "sending": return r(0, "warn", "Working", "Going into Clover now", "waiting");
    case "ready_for_review": return r(0, "plain", "Draft", "Ready to approve and send", "other");
    case "drafting": return r(0, "plain", "Draft", "Not finished", "other");
  }
  if (x.status !== "sent") return r(0, "plain", x.status, "", "other");
  if ((x.error ?? "").startsWith("dry run")) return r(1, "plain", "Test", "Test run, nothing went to the customer", "other");

  if (inv.some((i) => i.status === "failed")) return r(x.acceptedAt ? 2 : 1, "bad", "Needs you", "An invoice didn't go through", "needs");
  if (x.install === "failed") return r(3, "bad", "Needs you", "Install didn't book in Clover", "needs");
  if (inv.length && inv.every((i) => isPaid(i.status)) && inv.some((i) => i.kind === "balance"))
    return r(steps.length, "good", "Paid", "Paid in full", "paid");
  if (!x.acceptedAt) return r(1, "warn", "Waiting", "Waiting for the customer to accept", "waiting");

  const dep = inv.find((i) => i.kind === "deposit");
  const bal = inv.find((i) => i.kind === "balance");
  if (hasDeposit) {
    if (!dep || !isPaid(dep.status)) {
      if (dep?.status === "sent") return r(2, "warn", "Deposit sent", "Waiting for the deposit", "waiting");
      if (dep && ["approved", "sending", "waiting"].includes(dep.status)) return r(2, "warn", "Working", "Deposit invoice going out", "waiting");
      return r(2, "good", "Accepted", "Send the deposit invoice", "needs");
    }
    if (x.install !== "booked") {
      if (x.install && ["to_book", "booking", "to_reschedule"].includes(x.install)) return r(3, "warn", "Deposit paid", "Booking the install in Clover", "waiting");
      return r(3, "good", "Deposit paid", "Install next", "waiting");
    }
    if (bal?.status === "sent") return r(4, "warn", "Install booked", "Waiting for the balance", "waiting");
    if (bal && ["approved", "sending", "waiting"].includes(bal.status)) return r(4, "warn", "Working", "Balance invoice going out", "waiting");
    return r(4, "good", "Install booked", "Send the balance after the install", "waiting");
  }
  if (bal?.status === "sent") return r(2, "warn", "Invoiced", "Waiting for payment", "waiting");
  return r(2, "good", "Accepted", "Send the invoice", "needs");
}

export const initials = (name: string | null | undefined) =>
  (name ?? "?").replace(/^test\s+/i, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
