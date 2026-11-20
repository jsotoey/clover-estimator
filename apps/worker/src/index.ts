import { config } from "./config";
import { ensureProfileForLogin } from "./session";
import { newPage } from "./browser";
import { checkSession } from "./clover/session";
import { runRecon } from "./recon";
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
async function handleLoginRequest(): Promise<boolean> {
  const loginId = await claimLoginRequest();
  if (!loginId) return false;
  const ok = await runLiveLogin(loginId);
  if (ok) await releaseWaitingEstimates();
  return true;
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
    const res = await fillEstimate(page, job.estimate, job.computed, {
      dryRun: config.dryRun,
      taxRate: config.taxRate,
      photoUrls: job.photo_urls,
      onStep: async (step, url) => {
        await addScreenshot(id, url);
        await logEvent(id, "fill_step", { step });
      },
    });
    await setStatus(id, "sent", { cloverNumber: res.cloverNumber, error: res.sent ? undefined : "dry run: not sent" });
    await logEvent(id, "done", { sent: res.sent, cloverTotalCents: res.cloverTotalCents, cloverNumber: res.cloverNumber });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await setStatus(id, "failed", { error: msg });
    await logEvent(id, "failed", { error: msg });
  } finally {
    await page.close().catch(() => {});
  }
  return true;
}

async function main() {
  // Missing login: wait quietly instead of crash-looping (Railway emails on every crash).
  if (!process.env.CLOVER_EMAIL || !process.env.CLOVER_PASSWORD) {
    console.log("Waiting for CLOVER_EMAIL and CLOVER_PASSWORD. Add them in Railway > Variables; the service redeploys on its own.");
    for (;;) await sleep(60 * 60 * 1000);
  }
  if (ensureProfileForLogin(config.dataDir, config.cloverEmail())) {
    await logEvent(null, "login_changed", { note: "CLOVER_EMAIL changed; saved Clover session cleared" });
  }
  console.log(`worker starting: dryRun=${config.dryRun} recon=${config.recon} headless=${config.headless}`);

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

  for (;;) {
    try {
      if (await handleLoginRequest()) continue;
      if (await processEstimate()) continue;
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
