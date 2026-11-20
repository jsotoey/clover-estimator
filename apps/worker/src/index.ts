import { config } from "./config";
import { ensureProfileForLogin } from "./session";
import { newPage, saveSession } from "./browser";
import { checkSession } from "./clover/session";
import { FillError, deliveryNote } from "./clover/fillEstimate";
import { runRecon } from "./recon";
import { runScoutTask } from "./scout";
import { fillEstimate } from "./clover/fillEstimate";
import { addScreenshot, claimNext, db, logEvent, setStatus } from "./db";
import { claimLoginRequest, requestLogin, runLiveLogin } from "./liveLogin";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** After a successful sign-in, send every estimate that was waiting for it. */
async function releaseWaitingEstimates() {
  const { rowCount } = await db().query(
    `UPDATE estimates SET status = 'approved', error = NULL, updated_at = now() WHERE status = 'needs_login'`
  );
  if (rowCount) await logEvent(null, "resumed_after_login", { count: rowCount });
}

/** Handle a pending "Connect Clover" request, if any. Returns true if one ran. */
let signedIn = true; // until a check says otherwise

async function handleLoginRequest(): Promise<boolean> {
  const loginId = await claimLoginRequest();
  if (!loginId) return false;
  const ok = await runLiveLogin(loginId);
  if (ok) {
    signedIn = true;
    await releaseWaitingEstimates();
  }
  return true;
}

/** With the test lock on, only send when the customer's email or phone is on the list. */
function allowedToSend(raw: unknown): boolean {
  const e = raw as { customer: { email?: string; phone?: string } };
  if (!config.sendOnlyTo.length) return true;
  const email = e.customer.email?.trim().toLowerCase();
  const phone = e.customer.phone?.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return config.sendOnlyTo.some((v) => v === email || (phone && v.replace(/\D/g, "") === phone));
}

/** Our own errors are already plain English; browser-tool errors get a short summary. */
function friendlyError(e: unknown, msg: string): string {
  if (e instanceof FillError) return msg;
  if (/timeout/i.test(msg)) return "Clover didn't respond the way we expected (a button or field didn't show up in time). See the screenshot.";
  return "Something went wrong filling in Clover. See the screenshot, then tap Try again.";
}

async function processEstimate() {
  const job = await claimNext();
  if (!job) return false;
  const id = job.id;
  await logEvent(id, "claimed");
  const page = await newPage();
  try {
    if (!(await checkSession(page))) {
      // Saved Clover session expired: park the estimate and ask the merchant to sign in.
      await setStatus(id, "needs_login", { error: "Clover needs you to sign in" });
      await requestLogin("estimate");
      await logEvent(id, "session_expired");
      return true;
    }
    await saveSession();
    const locked = !config.dryRun && !allowedToSend(job.estimate);
    const res = await fillEstimate(page, job.estimate, job.computed, {
      dryRun: config.dryRun || locked,
      taxRate: config.taxRate,
      photoUrls: job.photo_urls,
      onStep: async (step, url) => {
        await addScreenshot(id, url);
        await logEvent(id, "fill_step", { step });
      },
    });
    await saveSession();
    await setStatus(id, "sent", { cloverNumber: res.cloverNumber, error: res.sent ? deliveryNote ?? undefined : locked ? "dry run: not sent (test lock: only sends to the test contacts)" : "dry run: not sent" });
    await logEvent(id, "done", { sent: res.sent, cloverTotalCents: res.cloverTotalCents, cloverNumber: res.cloverNumber });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logEvent(id, "failed", { error: msg }); // full detail for us
    await setStatus(id, "failed", { error: friendlyError(e, msg) }); // short version for the phone
  } finally {
    await page.close().catch(() => {});
  }
  return true;
}

async function main() {
  // Lets another machine (e.g. a computer at the shop) be the only worker. Nothing here touches Clover.
  if (/^(1|true|yes)$/i.test(process.env.WORKER_PAUSED ?? "")) {
    console.log("WORKER_PAUSED=true: another computer is running the worker. Idling.");
    for (;;) await sleep(60 * 60 * 1000);
  }
  // Missing login: wait quietly instead of crash-looping (Railway emails on every crash).
  if (!process.env.CLOVER_EMAIL || !process.env.CLOVER_PASSWORD) {
    console.log("Waiting for CLOVER_EMAIL and CLOVER_PASSWORD. Add them in Railway > Variables; the service redeploys on its own.");
    for (;;) await sleep(60 * 60 * 1000);
  }
  if (ensureProfileForLogin(config.dataDir, config.cloverEmail())) {
    await logEvent(null, "login_changed", { note: "CLOVER_EMAIL changed; saved Clover session cleared" });
  }
  console.log(`worker starting: dryRun=${config.dryRun} recon=${config.recon} headless=${config.headless}${config.sendOnlyTo.length ? ` testLock=${config.sendOnlyTo.join(",")}` : ""}`);
  // A sign-in that was open when the worker restarted can't continue; let the merchant start a fresh one.
  await db().query(
    `UPDATE clover_login SET status = 'failed', message = 'Interrupted by an app update. Tap Sign in to Clover again.', frame = NULL, finished_at = now(), updated_at = now() WHERE status = 'active'`
  ).catch(() => {});

  if (config.recon) {
    // Scouting run: needs a signed-in session first (sign in from the app's Connect Clover screen).
    for (;;) {
      const page = await newPage();
      const ok = await checkSession(page);
      if (ok) {
        await runRecon(page);
        await page.close();
        console.log("RECON finished. Set RECON=false. Idling.");
        for (;;) await sleep(60 * 60 * 1000);
      }
      await page.close();
      await requestLogin("recon");
      console.log("RECON waiting for you to sign in: open the app > Connect Clover.");
      while (!(await handleLoginRequest().catch(() => false))) await sleep(2000);
    }
  }

  let lastKeepAlive = Date.now();
  for (;;) {
    try {
      if (await handleLoginRequest()) continue;
      if (await processEstimate()) continue;
      if (signedIn && (await runScoutTask().catch((e) => { console.error("scout error", e); return false; }))) continue;
      // While idle, visit Clover every 10 minutes so an idle sign-out doesn't happen, and save the session.
      // Only while signed in: when signed out, don't keep loading Clover's login page (it only adds suspicion).
      if (signedIn && Date.now() - lastKeepAlive > 10 * 60 * 1000) {
        lastKeepAlive = Date.now();
        const page = await newPage();
        try {
          const ok = await checkSession(page);
          signedIn = ok;
          if (ok) await saveSession();
          await logEvent(null, "keepalive", { signedIn: ok });
        } finally {
          await page.close().catch(() => {});
        }
      }
    } catch (e) {
      console.error("loop error", e);
    }
    await sleep(Math.min(config.pollMs, 2000));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
