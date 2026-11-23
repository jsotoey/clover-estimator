import type { Locator, Page } from "playwright";
import type { Estimate } from "@ce/core";
import { capture } from "../browser";
import { config } from "../config";
import { FillError, firstVisible, must, selectOrCreateCustomer, toUSDate } from "./fillEstimate";

// ---------------------------------------------------------------------------------------------
// Clover "Create appointment" (/appointments/calendar → "Create appointment"), mapped Nov 22 by a
// look-only check of the demo account:
//   Customer information: "Select customer*" combobox (+ Add new customer), same as the estimate form
//   Appointment details: Services* (needs at least one bookable service, else Clover shows
//     "Services are required for an appointment"), Price, "Employee" button (default "Any available"),
//     "Date* (mm/dd/yyyy)" and "Time* HH:MM AM/PM" combobox (both disabled until a service is chosen),
//     "Find availability" link, Extra time
//   Notes (collapsible), then Cancel | Save
// The service and employee pickers couldn't be opened yet (the demo had no services), so those two
// steps try the likely controls and stop with a clear message if they don't match. Nothing is saved
// unless every field was set.
// ---------------------------------------------------------------------------------------------

export interface AppointmentFill {
  date: string;            // YYYY-MM-DD
  time: string;            // "9:00 AM"
  service: string;         // bookable service name in Clover, e.g. "Installation"
  employee: string | null; // crew = Clover employee name, e.g. "Team 1"; null = Any available
  note: string;
}

export async function pickOption(page: Page, name: string): Promise<boolean> {
  const re = new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  const opt = await firstVisible([
    page.getByRole("option", { name: re }), page.getByRole("menuitem", { name: re }),
    page.getByRole("menuitemradio", { name: re }), page.getByRole("radio", { name: re }),
    page.getByRole("checkbox", { name: re }), page.getByRole("button", { name: re }),
  ], 4000);
  if (!opt) return false;
  await opt.click();
  return true;
}

/**
 * For a customer with a phone, Clover shows a "Confirm consent" box (automated appointment texts) when
 * the customer is picked and again on Save, and won't save until it's confirmed. The bot confirms only
 * when the customer agreed on our booking page (consented = true); otherwise it closes the box, and Save
 * will then be refused with a clear message.
 */
async function handleTextConsent(page: Page, consented: boolean, waitMs = 3000): Promise<boolean> {
  const dialog = page.getByRole("dialog", { name: /confirm consent/i });
  // It shows up a moment after the click, so wait for it (isVisible doesn't wait).
  if (!(await dialog.waitFor({ state: "visible", timeout: waitMs }).then(() => true).catch(() => false))) return false;
  const btn = consented ? dialog.getByRole("button", { name: /^confirm$/i }) : dialog.getByRole("button", { name: /^close$/i });
  await btn.click().catch(() => {});
  await dialog.waitFor({ state: "hidden", timeout: 4000 }).catch(() => {});
  if (await dialog.isVisible().catch(() => false)) await page.keyboard.press("Escape").catch(() => {});
  return true;
}

async function chooseService(page: Page, service: string, consented: boolean) {
  // Mapped Nov 23 from the live form: the service picker is a search combobox labeled "Item".
  const box = await firstVisible([
    page.getByRole("combobox", { name: /^\s*item\b/i }),
    page.getByRole("combobox", { name: /service/i }),
    page.getByRole("button", { name: /select (a )?service|choose (a )?service|^services?\*?$/i }),
    page.getByLabel(/service/i),
  ], 6000);
  if (!box) throw new FillError(`Couldn't find Clover's service picker on the appointment form. Nothing was booked.`);
  await handleTextConsent(page, consented, 500);
  await box.click();
  const tag = await box.evaluate((el) => el.tagName).catch(() => "");
  const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const wanted = new RegExp(`^\\s*${esc(service)}`, "i");
  // Search with the start of the name (symbols like "&" can trip up Clover's search), then pick the exact one.
  for (const q of [service.split(/[&,(/]/)[0].trim(), service, ""]) {
    await handleTextConsent(page, consented, 300);
    if (tag === "INPUT") {
      await box.fill(q).catch(() => {});
      await page.waitForTimeout(1500);
      // Clover's list ("1 option is available") opens on arrow-down if typing didn't open it.
      if (!(await page.getByRole("option").first().isVisible().catch(() => false))) await box.press("ArrowDown").catch(() => {});
    }
    if (await pickOption(page, service)) return;
    const any = page.locator('[role="option"], [role="listbox"] li, [role="menuitem"], [role="listbox"] [role="button"]').filter({ hasText: wanted });
    for (let i = 0; i < (await any.count()); i++) {
      if (await any.nth(i).isVisible().catch(() => false)) { await any.nth(i).click(); return; }
    }
    // Clover's dropdown may be plain divs: click the innermost visible text that starts with the name
    // (not the search box itself, not the form's own labels).
    const texts = page.getByText(wanted);
    for (let i = (await texts.count()) - 1; i >= 0; i--) {
      const t = texts.nth(i);
      if (!(await t.isVisible().catch(() => false))) continue;
      const inForm = await t.evaluate((el) => !!el.closest("input, textarea, label, [role='combobox']")).catch(() => true);
      if (inForm) continue;
      await t.click();
      await page.waitForTimeout(800);
      const chosen = await box.inputValue().catch(() => "");
      if (!chosen || wanted.test(chosen) || !(await t.isVisible().catch(() => false))) return;
    }
  }
  const shot = await capture(page, "appointment-service-list", { aria: true }).catch(() => "");
  const offered = (await page.locator('[role="option"], [role="listbox"] li, [role="menuitem"]').allInnerTexts().catch(() => []))
    .map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 8);
  const err = new FillError(`Clover's service list didn't show "${service}"${offered.length ? ` (it showed: ${offered.join("; ")})` : " (the list was empty)"}. Check the service is turned on for appointments in Items and services. Nothing was booked.`);
  (err as FillError & { screenshot?: string }).screenshot = shot;
  throw err;
}

async function chooseEmployee(page: Page, employee: string) {
  const btn = await must([page.getByRole("button", { name: /^employee/i }), page.getByRole("combobox", { name: /employee/i })], "the Employee picker", 6000);
  await btn.click();
  if (!(await pickOption(page, employee)))
    throw new FillError(`No employee named "${employee}" in this Clover. Add the crew in Employees (named exactly like in the app's store settings). Nothing was booked.`);
}

async function enabled(loc: Locator, ms = 6000): Promise<boolean> {
  for (let t = 0; t < ms; t += 300) {
    if (await loc.isEnabled().catch(() => false)) return true;
    await loc.page().waitForTimeout(300);
  }
  return false;
}

export async function bookAppointment(
  page: Page, who: { customer: Estimate["customer"] }, a: AppointmentFill,
  opts: { dryRun: boolean; textConsent?: boolean; onStep?: (step: string, url: string) => Promise<void> }
): Promise<{ booked: boolean }> {
  // A failed screenshot never stops the booking; the step is still logged.
  const step = async (name: string) => opts.onStep?.(name, await capture(page, `appointment-${name}`, { aria: true }).catch(() => ""));

  await page.goto(`${config.cloverBaseUrl}/appointments/calendar`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  (await must([page.getByRole("button", { name: /^create appointment$/i })], '"Create appointment"', 15_000)).click();
  await must([page.getByRole("heading", { name: /create appointment/i })], "the appointment form", 15_000);
  if (await page.getByText(/services are required for an appointment/i).first().isVisible().catch(() => false))
    throw new FillError(`Clover needs at least one bookable service before it can book appointments. Add "${a.service}" in Items and services. Nothing was booked.`);
  await step("01-form");

  await selectOrCreateCustomer(page, who, () => page.getByRole("button", { name: /edit customer/i }).first().isVisible().catch(() => false));
  if (!(await page.getByRole("button", { name: /edit customer/i }).first().isVisible({ timeout: 3000 }).catch(() => false)))
    await page.waitForTimeout(1500); // a newly added customer takes a moment to show
  if (!(await page.getByRole("button", { name: /edit customer/i }).first().isVisible().catch(() => false)))
    throw new FillError(`Clover didn't let us pick the customer (${who.customer.email}). If Clover has them as "Name Unknown", add their name in Clover's Customers, then tap Try again. Nothing was booked.`);
  await handleTextConsent(page, !!opts.textConsent);
  await chooseService(page, a.service, !!opts.textConsent);
  if (a.employee) await chooseEmployee(page, a.employee);

  const date = page.getByRole("textbox", { name: /^date/i });
  if (!(await enabled(date))) throw new FillError("Clover didn't let us set the appointment date (it unlocks after a service is picked). Nothing was booked.");
  await date.fill(toUSDate(a.date));
  await date.press("Tab").catch(() => {});
  const time = page.getByRole("combobox", { name: /^time/i });
  if (await enabled(time, 3000)) {
    await time.click();
    await time.fill(a.time).catch(() => {});
    if (!(await pickOption(page, a.time))) await time.press("Enter").catch(() => {});
  }

  const notesToggle = await firstVisible([page.getByRole("button", { name: /^notes$/i })], 2000);
  if (notesToggle && (await notesToggle.getAttribute("aria-expanded")) !== "true") await notesToggle.click().catch(() => {});
  const notes = await firstVisible([page.getByRole("textbox", { name: /note/i }), page.getByPlaceholder(/note/i), page.locator("textarea")], 3000);
  if (notes) await notes.fill(a.note.slice(0, 200)); // Clover: "152 of 200 characters"
  await step("02-filled");

  const shown = await date.inputValue().catch(() => "");
  if (shown && shown !== toUSDate(a.date)) throw new FillError(`Clover changed the date to ${shown} (wanted ${toUSDate(a.date)}). Nothing was booked.`);
  const save = page.getByRole("button", { name: /^save$/i });
  if (!(await enabled(save, 4000))) throw new FillError("Clover's Save stayed greyed out, so a required field is missing. See the screenshot. Nothing was booked.");
  if (opts.dryRun) return { booked: false };

  await opts.onStep?.("02b-saving", "");
  await save.click({ timeout: 15_000 });
  await opts.onStep?.("02c-save-clicked", "");
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(1000);
    if (await handleTextConsent(page, !!opts.textConsent, 200)) {
      if (!opts.textConsent)
        throw new FillError("Clover needs the customer's OK for appointment texts before it saves, and this customer didn't give it. Nothing was booked.");
      continue;
    }
    const stillOpen = await page.getByRole("heading", { name: /create appointment/i }).isVisible().catch(() => false);
    if (!stillOpen) { await opts.onStep?.("03-saved", ""); await step("03-saved-calendar"); return { booked: true }; }
    const err = await page.locator('[role="alert"]').filter({ hasText: /\S/ }).first().innerText().catch(() => "");
    if (err) throw new FillError(`Clover didn't save the appointment: ${err.slice(0, 140)}`);
  }
  await step("03-unclear");
  throw new FillError("Clicked Save on the appointment, but Clover didn't confirm it. Check the Clover calendar before trying again.");
}
