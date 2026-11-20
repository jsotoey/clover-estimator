import { config } from "./config";
import { ensureProfileForLogin } from "./session";
import { openContext } from "./browser";
import { ensureLoggedIn } from "./clover/login";
import { runRecon } from "./recon";
import { fillEstimate } from "./clover/fillEstimate";
import { addScreenshot, claimNext, logEvent, setStatus, waitForCode } from "./db";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // Missing login: wait quietly instead of crash-looping (Railway emails on every crash).
  // Adding the variables in Railway redeploys the service automatically.
  if (!process.env.CLOVER_EMAIL || !process.env.CLOVER_PASSWORD) {
    console.log("Waiting for CLOVER_EMAIL and CLOVER_PASSWORD. Add them in Railway > Variables; the service redeploys on its own.");
    for (;;) await sleep(60 * 60 * 1000);
  }
  const email = config.cloverEmail();
  if (ensureProfileForLogin(config.dataDir, email)) {
    await logEvent(null, "login_changed", { note: "CLOVER_EMAIL changed; saved Clover session cleared" });
  }
  console.log(`worker starting: dryRun=${config.dryRun} recon=${config.recon}`);

  if (config.recon) {
    const ctx = await openContext();
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    const since = new Date().toISOString();
    const res = await ensureLoggedIn(page, {
      onNeedCode: async () => {
        await logEvent(null, "needs_code", { note: "Enter the Clover code in the app (or insert into verification_codes)" });
        return waitForCode(null, since, config.codeWaitMs);
      },
    });
    if (!res.ok) {
      await logEvent(null, "recon_login_failed", { reason: res.reason });
    } else {
      await runRecon(page);
    }
    await ctx.close();
    console.log("RECON finished. Set RECON=false and redeploy. Idling.");
    for (;;) await sleep(60 * 60 * 1000); // stay up so Railway does not restart-loop
  }

  for (;;) {
    let job = null;
    try {
      job = await claimNext();
    } catch (e) {
      console.error("poll failed", e);
    }
    if (!job) {
      await sleep(config.pollMs);
      continue;
    }
    const id = job.id;
    await logEvent(id, "claimed");
    const ctx = await openContext();
    try {
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      const since = new Date().toISOString();
      const login = await ensureLoggedIn(page, {
        onNeedCode: async () => {
          await setStatus(id, "needs_code");
          const code = await waitForCode(id, since, config.codeWaitMs);
          if (code) await setStatus(id, "sending");
          return code;
        },
        onStep: async (step, url) => {
          await addScreenshot(id, url);
          await logEvent(id, "login_step", { step });
        },
      });
      if (!login.ok) throw new Error(login.reason);
      const res = await fillEstimate(page, job.estimate, job.computed, { dryRun: config.dryRun });
      await setStatus(id, "sent", { cloverNumber: res.cloverNumber, error: config.dryRun ? "dry run: not sent" : undefined });
      await logEvent(id, "done", { dryRun: config.dryRun });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await setStatus(id, "failed", { error: msg });
      await logEvent(id, "failed", { error: msg });
    } finally {
      await ctx.close().catch(() => {});
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
