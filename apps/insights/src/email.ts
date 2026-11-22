import type { Merchant } from "./types.js";
import type { Draft } from "./write.js";
import { usd, type WeeklyReport } from "./metrics.js";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const md = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
export const weekLabel = (start: string, end: string) => {
  const [a, b] = [md(start), md(end)];
  return a.slice(0, 3) === b.slice(0, 3) ? `${a} to ${b.slice(4)}` : `${a} to ${b}`;
};

/** Email-safe HTML (tables + inline styles, works in Gmail/Outlook/iPhone Mail). */
export function emailHtml(m: Merchant, d: Draft, r: WeeklyReport): string {
  const w = r.week;
  const max = Math.max(...w.byDay, 1);
  const bars = w.byDay.map((c, i) => {
    const h = Math.max(4, Math.round((c / max) * 72));
    return `<td valign="bottom" align="center" style="padding:0 3px;font:11px Arial,sans-serif;color:#5C665F">
      <div style="height:${h}px;width:26px;background:${i === w.byDay.indexOf(max) ? "#1F6B45" : "#A9C9B5"};border-radius:4px 4px 0 0"></div>${DAYS[i]}</td>`;
  }).join("");
  const stat = (label: string, value: string, sub: string) =>
    `<td width="33%" style="padding:12px;background:#F6F5F1;border-radius:10px;font-family:Arial,sans-serif">
      <div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#5C665F;font-weight:bold">${label}</div>
      <div style="font-size:20px;font-weight:bold;color:#16201B;margin-top:4px">${value}</div>
      <div style="font-size:12px;color:#5C665F;margin-top:2px">${sub}</div></td>`;
  const vs = (p: number | null) => (p === null ? "first week tracked" : `${p >= 0 ? "▲" : "▼"} ${Math.abs(p)}% vs prior week`);
  const items = r.topItems.slice(0, 3).map((t) =>
    `<tr><td style="padding:6px 0;font:14px Arial,sans-serif;color:#16201B">${esc(t.name)}</td>
     <td align="right" style="padding:6px 0;font:14px Arial,sans-serif;color:#5C665F">${t.qty} sold · ${usd(t.cents)}</td></tr>`).join("");
  return `<!doctype html><html><body style="margin:0;background:#EDEBE5;padding:24px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:16px">
<tr><td style="padding:28px 28px 8px;font:15px/1.55 Arial,sans-serif;color:#16201B">
  <div style="font-size:12px;color:#5C665F;font-weight:bold">${esc(m.name)} · ${weekLabel(w.start, w.end)}</div>
  <p style="margin:14px 0 0">${esc(d.greeting)}</p>
  <p style="margin:10px 0 0">${esc(d.intro)}</p>
</td></tr>
<tr><td style="padding:16px 22px 0"><table role="presentation" width="100%" cellspacing="6" cellpadding="0"><tr>
  ${stat("Sales", usd(w.salesCents), vs(r.salesVsPrevPct))}
  ${stat("Orders", String(w.orders), vs(r.ordersVsPrevPct))}
  ${stat("Avg order", usd(w.avgTicketCents), vs(r.ticketVsPrevPct))}
</tr></table></td></tr>
<tr><td style="padding:18px 28px 0;font:15px/1.55 Arial,sans-serif;color:#16201B">
  <ul style="margin:0;padding-left:20px">${d.highlights.map((h) => `<li style="margin:0 0 6px">${esc(h)}</li>`).join("")}</ul>
</td></tr>
<tr><td style="padding:14px 28px 0"><div style="font:bold 11px Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#5C665F;margin-bottom:8px">Sales by day</div>
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>${bars}</tr></table></td></tr>
<tr><td style="padding:16px 28px 0"><div style="font:bold 11px Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#5C665F">Top sellers</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items}</table></td></tr>
<tr><td style="padding:16px 28px 0"><div style="padding:14px 16px;background:#E3EFE7;border-radius:10px;font:14px/1.5 Arial,sans-serif;color:#14492F"><b>One idea:</b> ${esc(d.idea)}</div></td></tr>
<tr><td style="padding:18px 28px 28px;font:15px/1.55 Arial,sans-serif;color:#16201B;white-space:pre-line">${esc(d.signoff)}</td></tr>
</table></td></tr></table></body></html>`;
}

export function emailText(d: Draft): string {
  return [d.greeting, "", d.intro, "", ...d.highlights.map((h) => `- ${h}`), "", `One idea: ${d.idea}`, "", d.signoff].join("\n");
}
