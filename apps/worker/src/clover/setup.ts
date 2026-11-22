import type { Page } from "playwright";
import { capture } from "../browser";
import { config } from "../config";
import { FillError, firstVisible, must } from "./fillEstimate";
import { pickOption } from "./appointments";

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
  // Choosing "Service" adds required "Hours*" and "Minutes*" drop-downs (mapped Nov 22).
  const h = Math.floor(minutes / 60), m = minutes % 60;
  const pickDropdown = async (label: RegExp, values: string[], what: string) => {
    const btn = await firstVisible([page.getByRole("button", { name: label }), page.getByRole("combobox", { name: label })], 3000);
    if (!btn) return;
    await btn.click();
    for (const v of values) if (await pickOption(page, v)) return;
    await page.keyboard.press("Escape").catch(() => {});
    throw new FillError(`Couldn't set the service ${what} in Clover. See the screenshot.`);
  };
  await pickDropdown(/^hours/i, [String(h), String(h).padStart(2, "0"), `${h} hr`, `${h} hour`], "hours");
  await pickDropdown(/^minutes/i, [String(m), String(m).padStart(2, "0"), `${m} min`], "minutes");
  await capture(page, `setup-service-1`, { aria: true });
  const next = page.getByRole("button", { name: /^next$/i });
  for (let i = 0; i < 10 && !(await next.isEnabled().catch(() => false)); i++) await page.waitForTimeout(300);
  if (!(await next.isEnabled().catch(() => false))) throw new FillError(`Clover wouldn't continue adding service "${name}" (Next stayed greyed out, maybe it needs a price above $0).`);
  await next.click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);
  // Clover creates the service on Next and opens its edit page ("Item successfully created").
  if (await page.getByText(/item successfully created/i).first().isVisible().catch(() => false)) {
    await capture(page, `setup-service-created`, { aria: true });
    return "created";
  }

  // Step 2: duration if asked again (hours / minutes boxes or a single duration box).
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

// Service edit page, "Bookable employees" section (mapped Nov 22): "Assign employees" button, a table of
// assigned employees ("You have not added any employee to this service"), and Cancel | Save at the bottom.
// The assign dialog itself wasn't mapped yet: we tick rows/checkboxes named like each crew and confirm.
export async function assignServiceEmployees(page: Page, service: string, employees: string[]): Promise<string> {
  const mid = await merchantPath(page);
  await page.goto(`${config.cloverBaseUrl}/inventory/m/${mid}/items`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  const search = await firstVisible([page.getByRole("combobox", { name: /search items/i })], 8000);
  if (search) { await search.fill(service); await page.waitForTimeout(1500); }
  const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await (await must([page.getByRole("button", { name: new RegExp(`^${esc(service)}$`, "i") })], `the "${service}" service`, 8000)).click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await (await must([page.getByRole("button", { name: /assign employees/i })], '"Assign employees"', 15_000)).click();
  await page.waitForTimeout(1200);
  await capture(page, `setup-assign-dialog`, { aria: true });
  const dialog = page.getByRole("dialog").last();
  const scope = (await dialog.isVisible().catch(() => false)) ? dialog : page.locator("body");
  for (const name of employees) {
    const re = new RegExp(esc(name), "i");
    const box = await firstVisible([
      scope.getByRole("checkbox", { name: re }),
      scope.getByRole("row", { name: re }).getByRole("checkbox"),
      scope.getByRole("option", { name: re }),
    ], 4000);
    if (!box) throw new FillError(`Couldn't find "${name}" in Clover's Assign employees list. See the screenshot.`);
    const role = await box.getAttribute("role").catch(() => null);
    if (role === "option") await box.click();
    else if (!(await box.isChecked().catch(() => false))) await box.check({ force: true }).catch(async () => box.click());
  }
  const confirm = await firstVisible([scope.getByRole("button", { name: /^(assign|done|save|apply|add|confirm)$/i })], 4000);
  if (!confirm) throw new FillError("Couldn't find the button to confirm the employees. See the screenshot.");
  await confirm.click();
  await page.waitForTimeout(1500);
  const save = page.getByRole("button", { name: /^save$/i }).last();
  for (let i = 0; i < 10 && !(await save.isEnabled().catch(() => false)); i++) await page.waitForTimeout(300);
  if (await save.isEnabled().catch(() => false)) { await save.click(); await page.waitForTimeout(2500); }
  await capture(page, `setup-assign-done`, { aria: true });
  const listed = await Promise.all(employees.map((n) => page.getByRole("cell", { name: new RegExp(esc(n), "i") }).first().isVisible().catch(() => false)));
  return listed.every(Boolean) ? "assigned" : "saved (check the list)";
}
