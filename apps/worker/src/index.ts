import { config } from "./config";
import { newPage, saveSession, useStore } from "./browser";
import { checkSession, assertRightStore } from "./clover/session";
import { loadStores, signedIn, storeById } from "./stores";
import { processInstall, planMissingInstalls } from "./installPlan";
import { processBooking } from "./bookings";
import { runSetupTask } from "./scout";
import { FillError, deliveryNote } from "./clover/fillEstimate";
import { runRecon } from "./recon";
import { runScoutTask } from "./scout";
import { checkAcceptances, createInvoiceRows, processInvoice } from "./invoices";
import { fillEstimate } from "./clover/fillEstimate";
import { addScreenshot, claimNext, db, logEvent, setStatus } from "./db";
import { claimLoginRequest, requestLogin, runLiveLogin } from "./liveLogin";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** After a successful sign-in, send every estimate of that store that was waiting for it. */
async function releaseWaitingEstimates(merchantId: number) {
  const { rowCount } = await db().query(
    `UPDATE estimates SET status = 'approved', error = NULL, updated_at = now() WHERE status = 'needs_login' AND merchant_id = $1`, [merchantId]
  );
  if (rowCount) await logEvent(null, "resumed_after_login", { count: rowCount, merchantId });
}

/**
 * On a Mac started with scripts/mac-autorun.sh: when a newer version is published, exit between jobs
 * so the runner downloads it and starts again (the Clover sign-in is saved, so nothing is lost).
 */
let lastUpdateCheck = Date.now();
async function newerVersionPublished(): Promise<boolean> {
  const mine = process.env.BUILD_SHA;
  if (!mine || Date.now() - lastUpdateCheck < 5 * 60_000) return false;
  lastUpdateCheck = Date.now();
  try {
    const r = await fetch("https://api.github.com/repos/jsotoey/clover-estimator/commits/claude/milestones-1-2", {
      headers: { accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return false;
    const latest = ((await r.json()) as { sha?: string }).sha;
    return !!latest && latest !== mine;
  } catch {
    return false;
  }
}

/** Handle a pending "Sign in to Clover" request for any store. Returns true if one ran. */
async function handleLoginRequest(): Promise<boolean> {
  const req = await claimLoginRequest();
  if (!req) return false;
  const store = await storeById(req.merchantId);
  if (!store) {
    await db().query(`UPDATE clover_login SET status = 'failed', message = 'Store not found', finished_at = now() WHERE id = $1`, [req.id]);
    return true;
  }
  await useStore(store);
  const ok = await runLiveLogin(req.id);
  if (ok) {
    signedIn.set(store.id, true);
    await releaseWaitingEstimates(store.id);
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
  // Only the "Clicked Send" error happens after the Send button; everything else stops before it.
  const mayHaveSent = /clicked send/i.test(msg);
  const base = e instanceof FillError ? msg
    : /timeout/i.test(msg) ? "Clover didn't respond the way we expected (a button or field didn't show up in time)."
    : "Something unexpected happened while filling in Clover.";
  const end = mayHaveSent ? "" : " Nothing was sent to the customer, so it's safe to tap Try again.";
  return `${base.replace(/\s*$/, "").replace(/([^.])$/, "$1.")}${end}`;
}

async function processEstimate() {
  const job = await claimNext();
  if (!job) return false;
  const id = job.id;
  await logEvent(id, "claimed");
  const store = await storeById(job.merchant_id);
  if (!store) {
    await setStatus(id, "failed", { error: "This estimate's store wasn't found. Nothing was sent." });
    return true;
  }
  await useStore(store);
  const page = await newPage();
  try {
    if (!(await checkSession(page))) {
      // Saved Clover session expired: park the estimate and ask the store to sign in.
      signedIn.set(store.id, false);
      await setStatus(id, "needs_login", { error: "Clover needs you to sign in" });
      await requestLogin("estimate", store.id);
      await logEvent(id, "session_expired");
      return true;
    }
    signedIn.set(store.id, true);
    await saveSession();
    await assertRightStore(page);
    const locked = !config.dryRun && !allowedToSend(job.estimate);
    const res = await fillEstimate(page, job.estimate, job.computed, {
      dryRun: config.dryRun || locked,
      taxRate: store.taxRate,
      photoUrls: job.photo_urls,
      onStep: async (step, url) => {
        await addScreenshot(id, url);
        await logEvent(id, "fill_step", { step });
      },
    });
    await saveSession();
    if (res.sent) {
      await db().query(`UPDATE estimates SET sent_at = now() WHERE id = $1`, [id]);
      await createInvoiceRows(id, job.estimate, job.computed);
    }
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
  // Stores and their sign-ins come from the database now; Clover passwords are only needed for the
  // older picture-on-the-phone sign-in. Wait for the web app to create the first store if needed.
  while (!(await loadStores(true)).length) {
    console.log("No stores yet. Open the web app once (it creates the first store), then the worker starts.");
    await sleep(30_000);
  }
  console.log(`worker starting: stores=${(await loadStores()).map((x) => x.name).join(" | ")} dryRun=${config.dryRun} recon=${config.recon} headless=${config.headless}${config.sendOnlyTo.length ? ` testLock=${config.sendOnlyTo.join(",")}` : ""}`);
  // A sign-in that was open when the worker restarted can't continue; let the merchant start a fresh one.
  await db().query(
    `UPDATE clover_login SET status = 'failed', message = 'Interrupted by an app update. Tap Sign in to Clover again.', frame = NULL, finished_at = now(), updated_at = now() WHERE status = 'active'`
  ).catch(() => {});

  if (config.recon) {
    // Scouting run: needs a signed-in session first (sign in from the app's Connect Clover screen).
    await useStore((await loadStores())[0]);
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
      await requestLogin("recon", (await loadStores())[0].id);
      console.log("RECON waiting for you to sign in: open the app > Connect Clover.");
      while (!(await handleLoginRequest().catch(() => false))) await sleep(2000);
    }
  }

  const lastKeepAlive = new Map<number, number>();
  for (;;) {
    try {
      if (await newerVersionPublished()) {
        console.log("A newer version is available. Restarting to update...");
        await saveSession().catch(() => {});
        process.exit(42);
      }
      if (await handleLoginRequest()) continue;
      if (await processEstimate()) continue;
      if (await processInvoice(allowedToSend).catch((e) => { console.error("invoice error", e); return false; })) continue;
      await planMissingInstalls().catch((e) => console.error("install sweep error", e));
      if (await processInstall(allowedToSend).catch((e) => { console.error("install error", e); return false; })) continue;
      if (await processBooking(allowedToSend).catch((e) => { console.error("booking error", e); return false; })) continue;
      if (await checkAcceptances().catch((e) => { console.error("acceptance check error", e); return false; })) continue;
      if (await runSetupTask().catch((e) => { console.error("setup error", e); return false; })) continue;
      if (await runScoutTask().catch((e) => { console.error("scout error", e); return false; })) continue;
      // While idle, visit each signed-in store's Clover every 10 minutes so an idle sign-out doesn't happen.
      // Not for signed-out stores: loading Clover's login page over and over only adds suspicion.
      for (const store of await loadStores()) {
        if (signedIn.get(store.id) === false) continue;
        if (Date.now() - (lastKeepAlive.get(store.id) ?? 0) < 10 * 60 * 1000) continue;
        lastKeepAlive.set(store.id, Date.now());
        await useStore(store);
        const page = await newPage();
        try {
          const ok = await checkSession(page);
          signedIn.set(store.id, ok);
          if (ok) await saveSession();
          await logEvent(null, "keepalive", { store: store.slug, signedIn: ok });
        } finally {
          await page.close().catch(() => {});
        }
        break; // one store per pass, so new work is never kept waiting
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
