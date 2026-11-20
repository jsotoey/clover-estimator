import type { Page } from "playwright";
import { config } from "../config";

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
  if (await email.isVisible().catch(() => false)) await email.fill(config.cloverEmail());
  const pw = page.getByLabel(/^password$/i).or(page.locator('input[type="password"]')).first();
  if (await pw.isVisible().catch(() => false)) await pw.fill(config.cloverPassword());
}
