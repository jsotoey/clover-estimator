import type { Page } from "playwright";
import { capture } from "../browser";
import { config } from "../config";
import { FillError, firstVisible, must } from "./fillEstimate";

/**
 * One-time store setup in Clover, run by the worker inside the store's own signed-in session
 * (so nobody types a password). Only these two actions exist; each checks first and never duplicates.
 */

async function merchantPath(page: Page): Promise<string> {
  // Clover's links carry the merchant id: /employees/m/<id>/employees
  await page.goto(`${config.cloverBaseUrl}/dashboard`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  const href = await page.getByRole("link", { name: /^employees$/i }).first().getAttribute("href").catch(() => null);
  const m = href?.match(/\/m\/([A-Z0-9]+)\//);
  if (!m) throw new FillError("Couldn't find this store's Clover merchant id on the dashboard.");
  return m[1];
}

// New employee (/employees/m/<id>/employees/new), mapped Nov 22: "Full name*", "Nickname", "Phone number",
// "Email address", "Role*" (default Employee), wages, "Device passcode (6 digits)" (Clover assigns one if blank),
// Cancel | Save (disabled until required fields are filled).
export async function createEmployee(page: Page, name: string, email: string): Promise<"created" | "exists"> {
  const mid = await merchantPath(page);
  await page.goto(`${config.cloverBaseUrl}/employees/m/${mid}/employees`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByRole("table", { name: /employees/i }).waitFor({ timeout: 15_000 }).catch(() => {});
  if (await page.getByRole("link", { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") }).first().isVisible().catch(() => false))
    return "exists";
  await page.goto(`${config.cloverBaseUrl}/employees/m/${mid}/employees/new`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await (await must([page.getByRole("textbox", { name: /^full name/i })], "the employee name box", 15_000)).fill(name);
  const mail = await firstVisible([page.getByRole("textbox", { name: /^email address/i })], 3000);
  if (mail) await mail.fill(email);
  await capture(page, `setup-employee-${name}`, { aria: true });
  const save = page.getByRole("button", { name: /^save$/i });
  for (let i = 0; i < 10 && !(await save.isEnabled().catch(() => false)); i++) await page.waitForTimeout(300);
  if (!(await save.isEnabled().catch(() => false))) throw new FillError(`Clover wouldn't save employee "${name}" (Save stayed greyed out).`);
  await save.click();
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(1000);
    if (!/\/employees\/new/.test(page.url())) return "created";
    const err = await page.locator('[role="alert"]').filter({ hasText: /\S/ }).first().innerText().catch(() => "");
    if (err) throw new FillError(`Clover didn't save employee "${name}": ${err.slice(0, 140)}`);
  }
  throw new FillError(`Clicked Save for employee "${name}" but Clover didn't confirm. Check Employees before retrying.`);
}

// Add item (/inventory/m/<id>/items/add), mapped Nov 22, step 1: "Service or item type*" radios
// ("Service" = bookable on the appointment calendar, "Item"), "Name*", "Price*", "Add items with variants",
// Cancel | Next. Step 2 (duration etc.) wasn't mapped yet: we fill a duration if a box for it is there,
// then press the form's save-type button, and report clearly if anything doesn't match.
export async function createService(page: Page, name: string, minutes: number): Promise<"created" | "exists"> {
  const mid = await merchantPath(page);
  await page.goto(`${config.cloverBaseUrl}/inventory/m/${mid}/items`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  const search = await firstVisible([page.getByRole("combobox", { name: /search items/i }), page.getByPlaceholder(/search/i)], 8000);
  if (search) { await search.fill(name); await page.waitForTimeout(1500); }
  if (await page.getByRole("button", { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") }).first().isVisible().catch(() => false))
    return "exists";

  await page.goto(`${config.cloverBaseUrl}/inventory/m/${mid}/items/add`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await (await must([page.getByRole("radio", { name: /^service/i })], 'the "Service" choice', 15_000)).check({ force: true });
  await (await must([page.getByRole("textbox", { name: /^name/i })], "the service name box")).fill(name);
  const price = await firstVisible([page.getByRole("textbox", { name: /^price/i })], 2000);
  if (price) { await price.fill("0.00"); await price.press("Tab").catch(() => {}); }
  await capture(page, `setup-service-1`, { aria: true });
  const next = page.getByRole("button", { name: /^next$/i });
  for (let i = 0; i < 10 && !(await next.isEnabled().catch(() => false)); i++) await page.waitForTimeout(300);
  if (!(await next.isEnabled().catch(() => false))) throw new FillError(`Clover wouldn't continue adding service "${name}" (Next stayed greyed out, maybe it needs a price above $0).`);
  await next.click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);

  // Step 2: duration if asked (hours / minutes boxes or a single duration box).
  const h = Math.floor(minutes / 60), m = minutes % 60;
  const hours = await firstVisible([page.getByRole("textbox", { name: /^hours?$/i }), page.getByRole("spinbutton", { name: /^hours?$/i })], 1500);
  const mins = await firstVisible([page.getByRole("textbox", { name: /^min(ute)?s?$/i }), page.getByRole("spinbutton", { name: /^min(ute)?s?$/i })], 1500);
  if (hours) await hours.fill(String(h));
  if (mins) await mins.fill(String(m));
  if (!hours && !mins) {
    const dur = await firstVisible([page.getByRole("textbox", { name: /duration/i }), page.getByRole("spinbutton", { name: /duration/i })], 1500);
    if (dur) await dur.fill(String(minutes));
  }
  await capture(page, `setup-service-2`, { aria: true });
  const save = await firstVisible([
    page.getByRole("button", { name: /^(save|create|create service|add service|save item|done)$/i }),
  ], 5000);
  if (!save) throw new FillError(`Couldn't find the button to finish adding service "${name}". See the screenshot.`);
  for (let i = 0; i < 10 && !(await save.isEnabled().catch(() => false)); i++) await page.waitForTimeout(300);
  if (!(await save.isEnabled().catch(() => false))) throw new FillError(`Clover wouldn't save service "${name}" (button greyed out). See the screenshot.`);
  await save.click();
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(1000);
    if (!/\/items\/add/.test(page.url())) { await capture(page, `setup-service-3`, { aria: true }); return "created"; }
    const err = await page.locator('[role="alert"]').filter({ hasText: /\S/ }).first().innerText().catch(() => "");
    if (err) throw new FillError(`Clover didn't save service "${name}": ${err.slice(0, 140)}`);
  }
  await capture(page, `setup-service-unclear`, { aria: true });
  throw new FillError(`Clicked save for service "${name}" but Clover didn't confirm. Check Items and services.`);
}
