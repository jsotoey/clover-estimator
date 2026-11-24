import { chromium, type Page } from "playwright";
import { db, logEvent } from "./db";
import { config } from "./config";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { closeContext, clearProfileLock, quietChromePrompts, forgetSavedSession, writeSavedSession, newPage, saveSession, VIEWPORT, workerProfileDir } from "./browser";
import { checkSession, prefillCredentials } from "./clover/session";

/** Ask the store's owner to sign in (once; reuses an open request for that store). Returns the request id. */
export async function requestLogin(reason: string, merchantId: number): Promise<number> {
  const open = await db().query<{ id: number }>(
    `SELECT id FROM clover_login WHERE status IN ('requested','active') AND merchant_id = $1 ORDER BY id DESC LIMIT 1`, [merchantId]
  );
  if (open.rows[0]) return open.rows[0].id;
  const { rows } = await db().query<{ id: number }>(
    `INSERT INTO clover_login (status, reason, merchant_id) VALUES ('requested', $1, $2) RETURNING id`, [reason, merchantId]
  );
  await logEvent(null, "login_needed", { loginId: rows[0].id, reason, merchantId });
  return rows[0].id;
}

/** Claim a pending sign-in request (any store), if someone opened the Clover screen. */
export async function claimLoginRequest(): Promise<{ id: number; merchantId: number } | null> {
  const { rows } = await db().query<{ id: number; merchant_id: number }>(
    `UPDATE clover_login SET status = 'active', updated_at = now(), message = 'Opening Clover…'
     WHERE id = (SELECT id FROM clover_login WHERE status = 'requested' AND merchant_id IS NOT NULL ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
     RETURNING id, merchant_id`
  );
  return rows[0] ? { id: rows[0].id, merchantId: rows[0].merchant_id } : null;
}

/**
 * The sign-in runs in a normal desktop-size window (Google's robot check needs the room), and the
 * picture sent to the phone is zoomed in on the part that matters: the robot check when it's open,
 * otherwise the login or code box. Taps are mapped back through the same zoom.
 */
type Clip = { x: number; y: number; width: number; height: number };
const FULL: Clip = { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height };
let clip: Clip = FULL;

function pad(b: Clip, by: number, minWidth: number): Clip {
  let width = Math.max(b.width + by * 2, minWidth);
  let x = b.x + b.width / 2 - width / 2;
  let y = b.y - by;
  let height = b.height + by * 2;
  x = Math.max(0, Math.min(x, VIEWPORT.width - width));
  y = Math.max(0, y);
  width = Math.min(width, VIEWPORT.width);
  height = Math.min(height, VIEWPORT.height - y);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

export async function focusArea(page: Page): Promise<Clip> {
  // Google's picture check (its own frame, shown on top of the page).
  for (const f of await page.locator('iframe[title*="challenge" i]').all()) {
    const b = await f.boundingBox().catch(() => null);
    if (b && b.width > 100 && b.height > 100 && b.y >= 0 && b.x >= 0 && (await f.isVisible().catch(() => false))) return pad(b, 8, 0);
  }
  // Otherwise the login / code form.
  for (const f of await page.locator("form").all()) {
    if (!(await f.isVisible().catch(() => false))) continue;
    const b = await f.boundingBox().catch(() => null);
    if (b && b.width > 150 && b.height > 80) return pad(b, 40, 420);
  }
  return FULL;
}

/** Tick Clover's "Remember this browser for 14 days" so it asks for a code less often. */
async function rememberBrowser(page: Page): Promise<boolean> {
  const box = page.getByLabel(/remember this browser/i).first();
  if (!(await box.isVisible().catch(() => false))) return false;
  if (!(await box.isChecked().catch(() => true))) await box.check({ timeout: 3000 }).catch(() => {});
  return true;
}

/** Pages Clover only shows to a signed-in merchant. */
const SIGNED_IN_PATH = /^\/(dashboard|estimates|invoice-manager|orders|home|customers|inventory|reporting)(\/|$)/i;

/** True when the focused element (including inside frames) is a box you type into. */
async function textBoxFocused(page: Page): Promise<boolean> {
  for (const f of page.frames()) {
    const yes = await f.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      if (!a || !document.hasFocus()) return false;
      if (a.tagName === "TEXTAREA" || a.isContentEditable) return true;
      if (a.tagName !== "INPUT") return false;
      return !["checkbox", "radio", "button", "submit", "image", "file", "range", "color", "hidden"].includes((a as HTMLInputElement).type);
    }).catch(() => false);
    if (yes) return true;
  }
  return false;
}

async function setTyping(id: number, typing: boolean) {
  await db().query(`UPDATE clover_login SET typing = $2 WHERE id = $1 AND typing <> $2`, [id, typing]);
}

async function setLogin(id: number, fields: { status?: string; message?: string; frame?: Buffer | null }) {
  await db().query(
    `UPDATE clover_login SET
       status = COALESCE($2, status),
       message = COALESCE($3, message),
       frame = CASE WHEN $4::boolean THEN $5 ELSE frame END,
       frame_at = CASE WHEN $4::boolean THEN now() ELSE frame_at END,
       finished_at = CASE WHEN $2 IN ('done','failed','cancelled') THEN now() ELSE finished_at END,
       updated_at = now()
     WHERE id = $1`,
    [id, fields.status ?? null, fields.message ?? null, fields.frame !== undefined, fields.frame ?? null]
  );
}

async function applyInputs(page: Page, id: number): Promise<void> {
  // Take and delete in one step, so typed text (which can include a code or password) is not kept.
  const { rows } = await db().query<{ kind: string; x: number | null; y: number | null; text: string | null }>(
    `WITH d AS (DELETE FROM clover_login_input WHERE login_id = $1 RETURNING id, kind, x, y, text)
     SELECT kind, x, y, text FROM d ORDER BY id`,
    [id]
  );
  for (const r of rows) {
    if (r.kind === "click" && r.x !== null && r.y !== null) {
      await page.mouse.click(Math.round(clip.x + r.x * clip.width), Math.round(clip.y + r.y * clip.height));
    } else if (r.kind === "type" && r.text) {
      await page.keyboard.type(r.text, { delay: 40 });
    } else if (r.kind === "key" && r.text && /^(Enter|Tab|Backspace|Escape)$/.test(r.text)) {
      await page.keyboard.press(r.text);
    }
  }
}

async function cancelled(id: number): Promise<boolean> {
  const { rows } = await db().query<{ status: string }>(`SELECT status FROM clover_login WHERE id = $1`, [id]);
  return rows[0]?.status === "cancelled";
}

/**
 * Live sign-in: stream the worker's Chrome to the app (about 1.5 frames/second) and apply the merchant's taps
 * and typing until Clover lets us in. Email and password are pre-filled; the person taps "Log in"
 * and handles any code or check Clover shows.
 */
export async function runLiveLogin(id: number): Promise<boolean> {
  const started = Date.now();
  let remembered = false;
  let page: Page | null = null;
  try {
    const { rows: why } = await db().query<{ reason: string | null }>(`SELECT reason FROM clover_login WHERE id = $1`, [id]);
    if (why[0]?.reason === "switch") {
      // Switching Clover logins: forget this store's session completely, so Clover asks who to sign in as.
      await closeContext();
      forgetSavedSession();
      fs.rmSync(workerProfileDir(), { recursive: true, force: true });
      await logEvent(null, "login_switch", { loginId: id });
    }
    page = await newPage();
    clip = FULL;
    if (await checkSession(page)) {
      await saveSession();
      await setLogin(id, { status: "done", message: "Already connected to Clover.", frame: null });
      await logEvent(null, "login_done", { loginId: id, seconds: 0, already: true });
      return true;
    }
    if (config.localSignin) {
      await page.close().catch(() => {});
      page = null;
      return await runLocalSignin(id, started);
    }
    await page.goto(config.cloverLoginUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(1500);
    await prefillCredentials(page);
    await setLogin(id, { message: "Your email and password are filled in. Tap Log in, then type the code Clover texts you." });

    while (Date.now() - started < config.liveLoginTimeoutMs) {
      if (await cancelled(id)) return false;
      await applyInputs(page, id);
      if (!remembered) remembered = await rememberBrowser(page);
      clip = await focusArea(page);
      const shot = await page.screenshot({ type: "jpeg", quality: 80, clip });
      await setLogin(id, { frame: shot });
      await setTyping(id, await textBoxFocused(page));
      // Signed in only once Clover shows a dashboard page (a code/verification step is NOT done yet).
      if (SIGNED_IN_PATH.test(new URL(page.url()).pathname)) {
        await page.waitForTimeout(1500);
        if (SIGNED_IN_PATH.test(new URL(page.url()).pathname)) {
          const seconds = Math.round((Date.now() - started) / 1000);
          await saveSession();
          await setLogin(id, { status: "done", message: "Connected to Clover.", frame: null });
          await logEvent(null, "login_done", { loginId: id, seconds });
          return true;
        }
      }
      await page.waitForTimeout(400);
    }
    await setLogin(id, { status: "failed", message: "Timed out. Open Connect Clover to try again.", frame: null });
    await logEvent(null, "login_timeout", { loginId: id });
    return false;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await setLogin(id, { status: "failed", message: `Problem opening Clover: ${msg.slice(0, 200)}`, frame: null });
    await logEvent(null, "login_failed", { loginId: id, error: msg });
    return false;
  } finally {
    await page?.close().catch(() => {});
  }
}

const LOCAL_DEBUG_PORT = 9333;

export const LOCAL_SIGNIN_MESSAGE =
  "Sign in on the Mac: a normal Chrome window opened there. Log in like you always do (tick Remember this browser), then tap I'm signed in here.";

/**
 * Sign-in with the merchant's own, ordinary Google Chrome (no automation attached), on the worker's profile.
 * The worker's browser is closed meanwhile; afterwards it reopens the same profile and uses the sign-in.
 */
async function runLocalSignin(id: number, started: number): Promise<boolean> {
  const dir = workerProfileDir();
  await closeContext();
  clearProfileLock(dir);
  quietChromePrompts(dir);
  // Plain Chrome, nothing attached while you sign in. The local-only debug port lets the worker copy the
  // sign-in out of this window afterwards (Clover keeps it in cookies that Chrome drops when it closes).
  const chrome = spawn(config.chromeApp, [
    `--user-data-dir=${dir}`, `--remote-debugging-port=${LOCAL_DEBUG_PORT}`, "--remote-debugging-address=127.0.0.1",
    "--no-first-run", "--no-default-browser-check", "--new-window", config.cloverLoginUrl,
  ], { stdio: "ignore" });
  let exited = false;
  chrome.on("exit", () => (exited = true));
  chrome.on("error", () => (exited = true));
  await setLogin(id, { message: LOCAL_SIGNIN_MESSAGE, frame: null });

  while (!exited && Date.now() - started < config.liveLoginTimeoutMs) {
    if (await cancelled(id)) { chrome.kill("SIGTERM"); return false; }
    const done = await db().query(
      `DELETE FROM clover_login_input WHERE login_id = $1 AND kind = 'key' AND text = 'SigninDone' RETURNING id`, [id]
    );
    if (done.rowCount) break;
    await new Promise((r) => setTimeout(r, 400)); // short, so "I'm signed in" is picked up right away
  }
  // Copy the sign-in (all cookies, including the temporary ones) before Chrome closes.
  let copied = 0;
  if (!exited) {
    try {
      const b = await chromium.connectOverCDP(`http://127.0.0.1:${LOCAL_DEBUG_PORT}`, { timeout: 10_000 });
      const ctx = b.contexts()[0];
      if (ctx) {
        const cookies = await ctx.cookies();
        writeSavedSession(cookies);
        copied = cookies.length;
      }
      await b.close().catch(() => {}); // disconnects only
    } catch (e) {
      console.error("could not copy the sign-in from Chrome:", e instanceof Error ? e.message : e);
    }
  }
  if (!exited) {
    chrome.kill("SIGTERM");
    for (let i = 0; i < 40 && !exited; i++) await new Promise((r) => setTimeout(r, 250));
  }
  await new Promise((r) => setTimeout(r, 300)); // let Chrome release the profile

  if (!copied) forgetSavedSession(); // nothing fresh copied: don't let an old copy overwrite the profile
  const page = await newPage(); // restores the copied sign-in on launch
  try {
    if (await checkSession(page)) {
      await saveSession();
      const seconds = Math.round((Date.now() - started) / 1000);
      await setLogin(id, { status: "done", message: "Connected to Clover.", frame: null });
      await logEvent(null, "login_done", { loginId: id, seconds, local: true });
      return true;
    }
    await setLogin(id, { status: "failed", message: "Clover still shows the login page. Tap Sign in to Clover to try again.", frame: null });
    await logEvent(null, "login_failed", { loginId: id, local: true });
    return false;
  } finally {
    await page.close().catch(() => {});
  }
}
