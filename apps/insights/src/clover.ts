import type { Order } from "./types.js";

/**
 * Pull paid orders from Clover's REST API with a merchant's read-only token.
 * Not yet run against a live account: field names follow Clover's v3 Orders API docs.
 */
type CloverOrder = {
  id: string; createdTime: number; state?: string; total?: number;
  lineItems?: { elements?: { name?: string; price?: number; unitQty?: number; refunded?: boolean; isRevenue?: boolean }[] };
  payments?: { elements?: { amount?: number; tipAmount?: number; result?: string }[] };
  refunds?: { elements?: { amount?: number }[] };
};

export async function cloverOrders(merchantId: string, token: string, from: Date, to: Date, base = process.env.CLOVER_API_BASE ?? "https://api.clover.com"): Promise<Order[]> {
  const out: Order[] = [];
  const limit = 1000;
  for (let offset = 0; offset < 100_000; offset += limit) {
    const url = new URL(`${base}/v3/merchants/${merchantId}/orders`);
    url.searchParams.append("filter", `createdTime>=${from.getTime()}`);
    url.searchParams.append("filter", `createdTime<${to.getTime()}`);
    url.searchParams.set("expand", "lineItems,payments,refunds");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 2000)); offset -= limit; continue; }
    if (!res.ok) throw new Error(`Clover ${res.status} for ${merchantId}: ${(await res.text()).slice(0, 200)}`);
    const page = (await res.json()) as { elements?: CloverOrder[] };
    const els = page.elements ?? [];
    for (const o of els) {
      const pays = (o.payments?.elements ?? []).filter((p) => (p.result ?? "SUCCESS") === "SUCCESS");
      if (!pays.length) continue; // open/unpaid orders don't count as sales
      const paid = pays.reduce((a, p) => a + (p.amount ?? 0), 0);
      out.push({
        id: o.id,
        createdAt: new Date(o.createdTime),
        totalCents: paid,
        tipCents: pays.reduce((a, p) => a + (p.tipAmount ?? 0), 0),
        refundCents: (o.refunds?.elements ?? []).reduce((a, r) => a + (r.amount ?? 0), 0),
        lines: (o.lineItems?.elements ?? [])
          .filter((l) => !l.refunded && l.isRevenue !== false)
          .map((l) => {
            const qty = l.unitQty ? l.unitQty / 1000 : 1; // Clover stores unit qty in thousandths
            return { name: (l.name ?? "Item").trim(), qty, cents: Math.round((l.price ?? 0) * qty) };
          }),
      });
    }
    if (els.length < limit) break;
  }
  return out;
}
