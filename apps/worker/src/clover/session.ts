import type { Page } from "playwright";
import { config } from "../config";
import { activeStore } from "../stores";
import { FillError } from "./fillEstimate";

/** True when the saved Clover session is still good (no redirect to /login). Never submits a password. */
export async function checkSession(page: Page): Promise<boolean> {
  await page.goto(`${config.cloverBaseUrl}/estimates`, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
  // Clover redirects signed-out visitors to /login after the app shell loads.
  for (let i = 0; i < 10; i++) {
    if (/\/login/i.test(page.url())) return false;
    if (await page.getByRole("button", { name: /create new estimate/i }).first().isVisible().catch(() => false)) return true;
    await page.waitForTimeout(1000);
  }
  return !/\/login/i.test(page.url());
}

/**
 * Put the saved email and password into Clover's login form so the person only has to tap
 * "Log in" and enter the code. It does NOT submit: a real person completes the sign-in.
 */
export async function prefillCredentials(page: Page): Promise<void> {
  const email = page.getByLabel(/^email$/i).or(page.locator('input[type="email"]')).first();
  const st = activeStore();
  if (st.email && (await email.isVisible().catch(() => false))) await email.fill(st.email);
  const pw = page.getByLabel(/^password$/i).or(page.locator('input[type="password"]')).first();
  if (st.password && (await pw.isVisible().catch(() => false))) await pw.fill(st.password);
}

const norm = (t: string) => t.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Store guard: before filling anything in, make sure the Clover dashboard is showing the store this
 * estimate belongs to (its name sits at the top of every Clover page). For any store but the first,
 * a mismatch stops the job. The first store (the original single-store setup) only logs a warning.
 */
export async function assertRightStore(page: Page): Promise<void> {
  const st = activeStore();
  const want = norm(st.cloverName);
  for (let i = 0; i < 10; i++) {
    const text = norm(await page.locator("body").innerText({ timeout: 2000 }).catch(() => ""));
    if (want && text.includes(want)) return;
    await page.waitForTimeout(800);
  }
  const msg = `Clover didn't show the store name "${st.cloverName}", so this may be the wrong store's login.`;
  if (st.primary) { console.warn(`[store guard] ${msg} (first store: continuing)`); return; }
  throw new FillError(`${msg} Nothing was filled in. Check which store this Clover login opens, or fix the store's Clover name in Stores.`);
}
