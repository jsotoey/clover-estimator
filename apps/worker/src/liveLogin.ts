import type { Page } from "playwright";
import { db, logEvent } from "./db";
import { config } from "./config";
import { newPage, VIEWPORT } from "./browser";
import { checkSession, prefillCredentials } from "./clover/session";

/** Ask the merchant to sign in (once; reuses an open request). Returns the request id. */
export async function requestLogin(reason: string): Promise<number> {
  const open = await db().query<{ id: number }>(
    `SELECT id FROM clover_login WHERE status IN ('requested','active') ORDER BY id DESC LIMIT 1`
  );
  if (open.rows[0]) return open.rows[0].id;
  const { rows } = await db().query<{ id: number }>(
    `INSERT INTO clover_login (status, reason) VALUES ('requested', $1) RETURNING id`, [reason]
  );
  await logEvent(null, "login_needed", { loginId: rows[0].id, reason });
  return rows[0].id;
}

/** Claim a pending sign-in request, if the merchant opened the Connect Clover screen. */
export async function claimLoginRequest(): Promise<number | null> {
  const { rows } = await db().query<{ id: number }>(
    `UPDATE clover_login SET status = 'active', updated_at = now(), message = 'Opening Clover…'
     WHERE id = (SELECT id FROM clover_login WHERE status = 'requested' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
     RETURNING id`
  );
  return rows[0]?.id ?? null;
}

/** Pages Clover only shows to a signed-in merchant. */
const SIGNED_IN_PATH = /^\/(dashboard|estimates|invoice-manager|orders|home|customers|inventory|reporting)(\/|$)/i;

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
      await page.mouse.click(Math.round(r.x * VIEWPORT.width), Math.round(r.y * VIEWPORT.height));
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
  const page = await newPage();
  const started = Date.now();
  try {
    if (await checkSession(page)) {
      await setLogin(id, { status: "done", message: "Already connected to Clover.", frame: null });
      await logEvent(null, "login_done", { loginId: id, seconds: 0, already: true });
      return true;
    }
    await page.goto(config.cloverLoginUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(1500);
    await prefillCredentials(page);
    await setLogin(id, { message: "Your email and password are filled in. Tap Log in, then enter any code Clover sends you." });

    while (Date.now() - started < config.liveLoginTimeoutMs) {
      if (await cancelled(id)) return false;
      await applyInputs(page, id);
      const shot = await page.screenshot({ type: "jpeg", quality: 55 });
      await setLogin(id, { frame: shot });
      // Signed in only once Clover shows a dashboard page (a code/verification step is NOT done yet).
      if (SIGNED_IN_PATH.test(new URL(page.url()).pathname)) {
        await page.waitForTimeout(1500);
        if (SIGNED_IN_PATH.test(new URL(page.url()).pathname)) {
          const seconds = Math.round((Date.now() - started) / 1000);
          await setLogin(id, { status: "done", message: "Connected to Clover.", frame: null });
          await logEvent(null, "login_done", { loginId: id, seconds });
          return true;
        }
      }
      await page.waitForTimeout(650);
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
    await page.close().catch(() => {});
  }
}
