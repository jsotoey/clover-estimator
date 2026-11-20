import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { profileDir } from "./session";
import { config } from "./config";
import { saveArtifact } from "./artifacts";

/** The live view and the click mapping both use this size. */
export const VIEWPORT = { width: 1280, height: 800 };

let shared: Promise<BrowserContext> | null = null;

/**
 * Clover keeps the sign-in in session cookies, which Chrome drops when it restarts (every deploy).
 * We save all cookies to the volume after a good sign-in or session check, and put them back on launch.
 */
const cookieFile = () => path.join(config.dataDir, "clover-cookies.json");

/** Forget the saved copy (e.g. before using a fresh sign-in done in normal Chrome, so old cookies don't overwrite it). */
export function forgetSavedSession() {
  fs.rmSync(cookieFile(), { force: true });
}

export function writeSavedSession(cookies: unknown[]) {
  const tmp = `${cookieFile()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cookies), { mode: 0o600 });
  fs.renameSync(tmp, cookieFile());
}

export async function saveSession(ctx?: BrowserContext): Promise<void> {
  try {
    const c = ctx ?? (await getContext());
    writeSavedSession(await c.cookies());
  } catch (e) {
    console.error("saveSession failed", e instanceof Error ? e.message : e);
  }
}

async function restoreSession(ctx: BrowserContext): Promise<void> {
  try {
    if (!fs.existsSync(cookieFile())) return;
    const saved = JSON.parse(fs.readFileSync(cookieFile(), "utf8")) as Parameters<BrowserContext["addCookies"]>[0];
    const now = Date.now() / 1000;
    const live = saved.filter((c) => c.expires === undefined || c.expires === -1 || c.expires > now);
    if (live.length) await ctx.addCookies(live);
    console.log(`restored ${live.length} saved cookies`);
  } catch (e) {
    console.error("restoreSession failed", e instanceof Error ? e.message : e);
  }
}

/**
 * One long-lived Chrome for the whole worker, so the Clover session survives between estimates.
 * It runs as a normal (headed) Chrome inside a virtual display on the server; no fake browser identity.
 */
export function getContext(): Promise<BrowserContext> {
  if (!shared) {
    // The worker is the only Chrome using this profile. A redeploy can leave Chrome's lock files behind
    // (from the old container), which makes Chrome refuse to start, so clear them first.
    const dir = workerProfileDir();
    fs.mkdirSync(dir, { recursive: true });
    clearProfileLock(dir);
    quietChromePrompts(dir);
    shared = chromium
      .launchPersistentContext(dir, {
        headless: config.headless,
        // With the installed Google Chrome, use the Mac's real keychain so a sign-in done in normal Chrome carries over.
        ...(config.chromeChannel ? { channel: config.chromeChannel, ignoreDefaultArgs: ["--use-mock-keychain"] } : {}),
        executablePath: process.env.CHROME_PATH || undefined,
        viewport: VIEWPORT,
        // Keep the default 1x scale: at 2x, Google's robot-check frame renders at half size in screenshots.
        locale: "en-US",
        timezoneId: "America/New_York",
      })
      .then(async (ctx) => {
        ctx.on("close", () => (shared = null));
        await restoreSession(ctx);
        return ctx;
      })
      .catch((e) => {
        shared = null;
        throw e;
      });
  }
  return shared;
}

/** The installed Google Chrome gets its own profile folder (it can't open one made by a newer test Chromium). */
export function workerProfileDir(): string {
  return profileDir(config.dataDir) + (config.chromeChannel ? "-chrome" : "");
}

/** Turn off Chrome's own "Save address?" / "Save card?" / "Save password?" offers in the worker's profile. */
export function quietChromePrompts(dir: string) {
  try {
    const file = path.join(dir, "Default", "Preferences");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const prefs = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
    prefs.autofill = { ...(prefs.autofill ?? {}), profile_enabled: false, credit_card_enabled: false };
    prefs.credentials_enable_service = false;
    prefs.profile = { ...(prefs.profile ?? {}), password_manager_enabled: false };
    fs.writeFileSync(file, JSON.stringify(prefs));
  } catch { /* not critical */ }
}

export function clearProfileLock(dir: string) {
  for (const f of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    try { fs.rmSync(path.join(dir, f), { force: true }); } catch { /* not there */ }
  }
}

/** Close the worker's browser (e.g. so the merchant can use the same profile in normal Chrome). */
export async function closeContext(): Promise<void> {
  const c = shared;
  shared = null;
  if (c) await (await c.catch(() => null))?.close().catch(() => {});
}

/** Kept for RECON and tests. */
export const openContext = getContext;

export async function newPage(): Promise<Page> {
  const ctx = await getContext();
  return ctx.newPage();
}

/** Screenshot + optional HTML + ARIA snapshot of the current page. Returns the screenshot URL. */
export async function capture(page: Page, label: string, opts: { html?: boolean; aria?: boolean } = {}): Promise<string> {
  const shot = await page.screenshot({ fullPage: true, scale: "css" });
  const url = await saveArtifact(`${label}.png`, shot, "image/png");
  if (opts.html) await saveArtifact(`${label}.html`, await page.content(), "text/html");
  if (opts.aria) {
    const aria = await page.locator("body").ariaSnapshot().catch((e) => `ariaSnapshot failed: ${e}`);
    await saveArtifact(`${label}.aria.yaml`, `# ${page.url()}\n${aria}`, "text/yaml");
    console.log(`[aria:${label}] ${page.url()}\n${aria}\n[/aria:${label}]`);
  }
  console.log(`[capture] ${label} -> ${url}`);
  return url;
}
