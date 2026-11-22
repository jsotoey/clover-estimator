import type { Locator, Page } from "playwright";
import { EstimateSchema, type Estimate } from "@ce/core";
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

async function pickOption(page: Page, name: string): Promise<boolean> {
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

async function chooseService(page: Page, service: string) {
  const box = await firstVisible([
    page.getByRole("combobox", { name: /service/i }),
    page.getByRole("button", { name: /select (a )?service|choose (a )?service|^services?\*?$/i }),
    page.getByLabel(/service/i),
  ], 6000);
  if (!box) throw new FillError(`Couldn't find Clover's service picker on the appointment form. Nothing was booked.`);
  await box.click();
  const tag = await box.evaluate((el) => el.tagName).catch(() => "");
  if (tag === "INPUT") await box.fill(service).catch(() => {});
  if (!(await pickOption(page, service)))
    throw new FillError(`Clover has no bookable service named "${service}". Add it in Items and services (or change the store's install service in Settings). Nothing was booked.`);
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
  page: Page, rawEstimate: unknown, a: AppointmentFill,
  opts: { dryRun: boolean; onStep?: (step: string, url: string) => Promise<void> }
): Promise<{ booked: boolean }> {
  const estimate: Estimate = EstimateSchema.parse(rawEstimate);
  const step = async (name: string) => opts.onStep?.(name, await capture(page, `appointment-${name}`, { aria: true }));

  await page.goto(`${config.cloverBaseUrl}/appointments/calendar`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  (await must([page.getByRole("button", { name: /^create appointment$/i })], '"Create appointment"', 15_000)).click();
  await must([page.getByRole("heading", { name: /create appointment/i })], "the appointment form", 15_000);
  if (await page.getByText(/services are required for an appointment/i).first().isVisible().catch(() => false))
    throw new FillError(`Clover needs at least one bookable service before it can book appointments. Add "${a.service}" in Items and services. Nothing was booked.`);
  await step("01-form");

  await selectOrCreateCustomer(page, estimate);
  await chooseService(page, a.service);
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
  if (notes) await notes.fill(a.note.slice(0, 250));
  await step("02-filled");

  const shown = await date.inputValue().catch(() => "");
  if (shown && shown !== toUSDate(a.date)) throw new FillError(`Clover changed the date to ${shown} (wanted ${toUSDate(a.date)}). Nothing was booked.`);
  const save = page.getByRole("button", { name: /^save$/i });
  if (!(await enabled(save, 4000))) throw new FillError("Clover's Save stayed greyed out, so a required field is missing. See the screenshot. Nothing was booked.");
  if (opts.dryRun) return { booked: false };

  await save.click();
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(1000);
    const stillOpen = await page.getByRole("heading", { name: /create appointment/i }).isVisible().catch(() => false);
    if (!stillOpen) { await step("03-saved"); return { booked: true }; }
    const err = await page.locator('[role="alert"]').filter({ hasText: /\S/ }).first().innerText().catch(() => "");
    if (err) throw new FillError(`Clover didn't save the appointment: ${err.slice(0, 140)}`);
  }
  await step("03-unclear");
  throw new FillError("Clicked Save on the appointment, but Clover didn't confirm it. Check the Clover calendar before trying again.");
}
