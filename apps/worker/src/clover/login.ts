import type { Page } from "playwright";
import { config } from "../config";
import { capture } from "../browser";

/**
 * Selectors here are best guesses, written without seeing the Clover dashboard.
 * Run RECON=true on Railway, then tighten them from the saved screenshots/ARIA snapshots.
 */
const CODE_PROMPT = /verification code|enter (the )?code|security code|one-time|verify (it'?s|your)/i;

async function waitForLoginOutcome(page: Page, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!/\/login/i.test(page.url())) return;
    const text = (await page.locator("body").innerText().catch(() => "")) ?? "";
    if (CODE_PROMPT.test(text)) return;
    if (/incorrect|invalid|try again|doesn.t match/i.test(text)) return;
    await page.waitForTimeout(1000);
  }
}

export type LoginResult = { ok: true } | { ok: false; reason: string };

export interface LoginHooks {
  /** Called when Clover asks for a verification code. Resolve with the code, or null to give up. */
  onNeedCode: () => Promise<string | null>;
  onStep?: (step: string, screenshotUrl: string) => Promise<void>;
}

async function isLoggedIn(page: Page): Promise<boolean> {
  const url = page.url();
  if (/\/login|\/signin|\/oauth|\/auth/i.test(url)) return false;
  return /clover\.com\/(dashboard|home|merchant|m\/)/i.test(url) || (await page.getByRole("navigation").count()) > 0;
}

async function fillFirst(page: Page, candidates: ReturnType<Page["locator"]>[], value: string): Promise<boolean> {
  for (const c of candidates) {
    if (await c.first().isVisible().catch(() => false)) {
      await c.first().fill(value);
      return true;
    }
  }
  return false;
}

async function clickFirst(page: Page, candidates: ReturnType<Page["locator"]>[]): Promise<boolean> {
  for (const c of candidates) {
    if (await c.first().isVisible().catch(() => false)) {
      await c.first().click();
      return true;
    }
  }
  return false;
}

export async function ensureLoggedIn(page: Page, hooks: LoginHooks): Promise<LoginResult> {
  const step = async (name: string) => {
    const url = await capture(page, `login-${name}`, { aria: true }); // always capture, even with no hook
    await hooks.onStep?.(name, url);
  };

  await page.goto(config.cloverLoginUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  if (await isLoggedIn(page)) {
    await step("already-signed-in");
    return { ok: true };
  }
  await step("login-page");

  const emailOk = await fillFirst(page, [
    page.getByLabel(/email|username/i),
    page.getByPlaceholder(/email/i),
    page.locator('input[type="email"], input[name*="email" i], input[name="username"]'),
  ], config.cloverEmail());
  if (!emailOk) return { ok: false, reason: "Could not find the email field on the Clover login page" };

  // Some flows ask for email first, then password on the next screen.
  if (!(await page.locator('input[type="password"]').first().isVisible().catch(() => false))) {
    await clickFirst(page, [page.getByRole("button", { name: /next|continue/i })]);
    await page.waitForTimeout(1500);
  }

  const pwOk = await fillFirst(page, [page.getByLabel(/password/i), page.locator('input[type="password"]')], config.cloverPassword());
  if (!pwOk) return { ok: false, reason: "Could not find the password field on the Clover login page" };

  await clickFirst(page, [
    page.getByRole("button", { name: /^(log ?in|sign ?in)$/i }),
    page.getByRole("button", { name: /log ?in|sign ?in|continue/i }),
    page.locator('button[type="submit"]'),
  ]);
  // Clover's login spins ("Loading") for a while; wait up to 30s for it to leave /login or ask for a code.
  await waitForLoginOutcome(page, 30_000);
  await step("after-submit");

  // Verification code (new device / new location).
  const bodyText = (await page.locator("body").innerText().catch(() => "")) ?? "";
  if (CODE_PROMPT.test(bodyText)) {
    await step("needs-code");
    const code = await hooks.onNeedCode();
    if (!code) return { ok: false, reason: "No verification code entered within 10 minutes" };
    const codeOk = await fillFirst(page, [
      page.getByLabel(/code/i),
      page.getByPlaceholder(/code/i),
      page.locator('input[autocomplete="one-time-code"], input[inputmode="numeric"], input[name*="code" i]'),
    ], code);
    if (!codeOk) return { ok: false, reason: "Could not find the verification code field" };
    // Ask Clover to remember this device when it offers to.
    const remember = page.getByLabel(/remember|trust/i);
    if (await remember.first().isVisible().catch(() => false)) await remember.first().check().catch(() => {});
    await clickFirst(page, [page.getByRole("button", { name: /verify|submit|continue|confirm/i }), page.locator('button[type="submit"]')]);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2000);
    await step("after-code");
  }

  if (await isLoggedIn(page)) return { ok: true };
  const text = (await page.locator("body").innerText().catch(() => "")).slice(0, 300);
  if (/incorrect|invalid|doesn.t match/i.test(text)) return { ok: false, reason: "Clover says the email or password is wrong. Check CLOVER_EMAIL / CLOVER_PASSWORD in Railway." };
  if (/loading/i.test(text) && /recaptcha/i.test(text))
    return { ok: false, reason: "Clover's login did not finish (stuck on Loading; the page is protected by reCAPTCHA). The server browser may be blocked from logging in." };
  return { ok: false, reason: `Still not signed in. Page says: ${text}` };
}
