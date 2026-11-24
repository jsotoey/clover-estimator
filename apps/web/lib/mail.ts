import type { Email } from "@ce/core";

/**
 * Sends email through Postmark. Needs, in Railway → web → Variables:
 *   POSTMARK_SERVER_TOKEN  the server's API token
 *   MAIL_FROM              a sender Postmark has verified, e.g. "Fixro Bookings <bookings@getfixro.com>"
 *   SEND_ONLY_TO           (testing) comma list of emails/phones; anything else is skipped, like the worker
 * Missing token or sender: nothing is sent and the reason is returned (bookings still work).
 */
export async function sendEmail(e: Email): Promise<{ sent: boolean; reason?: string }> {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  const from = process.env.MAIL_FROM;
  if (!token || !from) return { sent: false, reason: "email not set up (POSTMARK_SERVER_TOKEN / MAIL_FROM)" };
  const lock = (process.env.SEND_ONLY_TO ?? "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
  if (lock.length && !lock.includes(e.to.trim().toLowerCase())) return { sent: false, reason: "test lock: recipient not on SEND_ONLY_TO" };
  try {
    const r = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", "X-Postmark-Server-Token": token },
      body: JSON.stringify({
        From: from, To: e.to, ReplyTo: e.replyTo, Subject: e.subject, TextBody: e.text, HtmlBody: e.html,
        Attachments: e.attachments, MessageStream: "outbound",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (r.ok) return { sent: true };
    const j = (await r.json().catch(() => ({}))) as { Message?: string };
    return { sent: false, reason: `Postmark ${r.status}: ${j.Message ?? "error"}` };
  } catch (err) {
    return { sent: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
