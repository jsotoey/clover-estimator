import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Locator, Page } from "playwright";
import { EstimateSchema, formatCents, type Estimate, type PricingResult } from "@ce/core";
import { capture } from "../browser";
import { config } from "../config";
import { loadFile } from "../artifacts";

/**
 * Fills out a new estimate in the Clover web dashboard.
 *
 * Built from what we saw in M&J's dashboard (Nov 19): the invoice form uses
 *   "Select customer*" search ("Search by email, phone or name") + "+ Add new customer",
 *   "Add custom item" panel (Item name / Price / Tax rate checkboxes / Quantity / Add),
 *   "Note" textarea (200 chars), "Attachments" section, "Review & Send" -> review page
 *   with "Email ... to <address>" checkbox and a "Send" button.
 * The estimate form is assumed to share these parts. Selectors are label/role based;
 * anything not found fails loudly with a screenshot, and RECON output is used to tighten them.
 */

export interface FillOptions {
  dryRun: boolean;
  /** Merchant's one tax rate, e.g. 0.06625, used to pick the right tax checkbox. */
  taxRate?: number;
  photoUrls?: string[];
  onStep?: (step: string, screenshotUrl: string) => Promise<void>;
}

export interface FillResult {
  cloverNumber?: string;
  cloverTotalCents: number;
  sent: boolean;
}

export class FillError extends Error {}

const estimatesUrl = () => `${config.cloverBaseUrl}/estimates`;
const T = { short: 5_000, nav: 30_000 };

/** "$1,110.68" -> 111068 */
export function parseMoneyToCents(text: string): number | null {
  const m = text.replace(/\s/g, "").match(/([\d,]+)\.(\d{2})/);
  if (!m) return null;
  const cents = Number(m[1].replace(/,/g, "")) * 100 + Number(m[2]);
  return /-/.test(text) ? -cents : cents;
}

/** 0.06625 -> matches "(6.63%)" or "(6.625%)" in a tax label */
export function taxLabelPattern(rate: number): RegExp {
  const pct = rate * 100;
  const variants = new Set([pct.toFixed(3).replace(/0+$/, "").replace(/\.$/, ""), pct.toFixed(2), pct.toFixed(1)]);
  return new RegExp(`\\((${[...variants].map((v) => v.replace(".", "\\.")).join("|")})%\\)`);
}

export function toUSDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

async function firstVisible(cands: Locator[], timeout = T.short): Promise<Locator | null> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const c of cands) {
      const f = c.first();
      if (await f.isVisible().catch(() => false)) return f;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

async function must(cands: Locator[], what: string, timeout = T.short): Promise<Locator> {
  const l = await firstVisible(cands, timeout);
  if (!l) throw new FillError(`Could not find ${what} on the Clover page`);
  return l;
}

export async function fillEstimate(page: Page, rawEstimate: unknown, rawComputed: unknown, opts: FillOptions): Promise<FillResult> {
  const estimate: Estimate = EstimateSchema.parse(rawEstimate);
  const computed = rawComputed as PricingResult;
  if (!computed?.lines?.length) throw new FillError("Estimate has no computed prices");
  const step = async (name: string) => {
    const url = await capture(page, `fill-${name}`, { aria: true });
    await opts.onStep?.(name, url);
  };

  // 1. Open a new estimate.
  await page.goto(estimatesUrl(), { waitUntil: "domcontentloaded", timeout: T.nav });
  await page.waitForLoadState("networkidle").catch(() => {});
  const create = await must([
    page.getByRole("button", { name: /create new estimate/i }),
    page.getByRole("link", { name: /create new estimate/i }),
    page.getByRole("button", { name: /(create|new) estimate/i }),
  ], '"Create new estimate"', 15_000);
  await create.click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await step("01-new-form");

  // 2. Customer: search by email, then phone, then name; otherwise add new.
  await selectOrCreateCustomer(page, estimate);
  await step("02-customer");

  // 3. Dates (best effort: the note also carries them).
  await setDate(page, /service date/i, estimate.service_date, false);
  await setDate(page, /expiration date/i, estimate.expiration_date, true);
  // Clover pre-fills the next estimate number (e.g. 000002); keep it for the app.
  const numberField = await firstVisible([page.getByLabel(/estimate number/i)], 2000);
  const cloverNumber = numberField ? (await numberField.inputValue().catch(() => "")) || undefined : undefined;

  // 4. Line items: one custom item per line, exact card price from our pricing code, ONE tax.
  for (const line of computed.lines) {
    await addCustomItem(page, line.description, line.priceCents, estimate.taxable, opts.taxRate);
  }
  await step("03-items");

  // 5. Note (<= 200 chars, enforced by our schema too).
  const note = await must([page.getByLabel(/^note$/i), page.getByPlaceholder(/add a note/i), page.locator("textarea")], "the note box");
  await note.fill(estimate.note);

  // 6. Photos.
  if (opts.photoUrls?.length) await attachPhotos(page, opts.photoUrls);

  // 7. Safety check: Clover's total must match ours to the cent.
  const cloverTotal = await readTotalCents(page);
  if (cloverTotal === null) throw new FillError("Could not read the total on the Clover form");
  if (Math.abs(cloverTotal - computed.totalCents) > 1) {
    await step("04-total-mismatch");
    throw new FillError(
      `Total mismatch, not sending: Clover shows ${formatCents(cloverTotal)}, app computed ${formatCents(computed.totalCents)}. ` +
      `Check for a second tax or a wrong tax rate on the account.`
    );
  }
  await step("04-form-complete");

  // 8. Review page: delivery method.
  const review = await must([
    page.getByRole("button", { name: /^preview$/i }),
    page.getByRole("button", { name: /review\s*&?\s*(and\s*)?send/i }),
  ], '"Preview"');
  if (!(await review.isEnabled().catch(() => false))) {
    // Clover greys out Preview while something on the form is flagged; say what it is.
    const msgs = await page.locator('[role="alert"], [aria-live] , [class*="error" i]')
      .filter({ hasText: /\S/ }).allInnerTexts().catch(() => [] as string[]);
    const said = [...new Set(msgs.map((m) => m.trim()).filter((m) => m && m.length < 120))].slice(0, 3);
    throw new FillError(said.length ? `Clover won't continue yet. It says: ${said.join("; ")}` : "Clover won't continue yet: a field on the form is still flagged. See the screenshot.");
  }
  await openSendPage(page, review, !!opts.photoUrls?.length);
  await setDelivery(page, estimate);
  await step("05-review");

  if (opts.dryRun) return { cloverNumber, cloverTotalCents: cloverTotal, sent: false };

  // 9. Send.
  const send = await must([page.getByRole("button", { name: /^send estimate$/i }), page.getByRole("button", { name: /^send$/i })], "the Send estimate button");
  await send.click();
  await page.waitForLoadState("networkidle").catch(() => {});
  // Real page: returns to /estimates with "Estimate emailed successfully."
  const confirmed = await page.getByText(/estimate (emailed|sent).*successfully/i).first().waitFor({ timeout: 15_000 }).then(() => true).catch(() => false);
  await step("06-sent");
  if (!confirmed) throw new FillError("Clicked Send, but Clover did not confirm it was sent. Check the screenshot and the Estimates list before retrying.");
  return { cloverNumber: cloverNumber ?? (await findEstimateNumber(page, estimate.customer.name, computed.totalCents)), cloverTotalCents: cloverTotal, sent: true };
}

async function selectOrCreateCustomer(page: Page, e: Estimate) {
  const search = await must([
    page.getByPlaceholder(/search by email, phone or name/i),
    page.getByLabel(/select customer/i),
    page.getByRole("combobox", { name: /customer/i }),
  ], "the customer search box", 15_000);

  const terms = [e.customer.email, e.customer.phone?.replace(/\D/g, ""), e.customer.name].filter(Boolean) as string[];
  for (const term of terms) {
    await search.fill("");
    await search.fill(term);
    await page.waitForTimeout(1500);
    const options = page.getByRole("option").or(page.locator('[role="listbox"] [role="option"], [role="listbox"] li'));
    const n = await options.count();
    for (let i = 0; i < n; i++) {
      const text = (await options.nth(i).innerText().catch(() => "")).toLowerCase();
      const emailMatch = e.customer.email && text.includes(e.customer.email.toLowerCase());
      const nameMatch = text.includes(e.customer.name.toLowerCase());
      if (emailMatch || (nameMatch && !e.customer.email)) {
        await options.nth(i).click();
        return;
      }
    }
  }

  // Not found: add a new customer.
  const add = await must([page.getByRole("link", { name: /add new customer/i }), page.getByRole("button", { name: /add new customer/i })], '"+ Add new customer"');
  await add.click();
  await page.waitForTimeout(800);
  const [first, ...rest] = e.customer.name.trim().split(/\s+/);
  const last = rest.join(" ");
  const fullName = await firstVisible([page.getByLabel(/^(full )?name$/i)], 1500);
  if (fullName) await fullName.fill(e.customer.name);
  else {
    await (await must([page.getByLabel(/first name/i)], "the first name field")).fill(first);
    const lastF = await firstVisible([page.getByLabel(/last name/i)], 1500);
    if (lastF) await lastF.fill(last || "-"); // Clover requires a last name
  }
  if (!e.customer.email) throw new FillError("Clover needs an email to create a new customer");
  await (await must([page.getByLabel(/^email/i)], "the customer email field")).fill(e.customer.email);
  let phoneField: Locator | null = null;
  if (e.customer.phone) {
    phoneField = await firstVisible([page.getByLabel(/phone/i)], 1500);
    if (phoneField) await phoneField.pressSequentially(e.customer.phone.replace(/\D/g, ""), { delay: 20 });
    // Clover's text-message consent box. Only ticked when the owner chose to send by text.
    if (phoneField && (e.delivery === "sms" || e.delivery === "both")) {
      const consent = await firstVisible([page.getByRole("checkbox", { name: /text messages|consent/i }), page.getByLabel(/text messages|consent/i)], 1500);
      if (consent && !(await consent.isChecked().catch(() => true))) await consent.check().catch(() => {});
    }
  }
  const addressFields = e.customer.job_address ? await fillAddress(page, e.customer.job_address) : [];

  const save = await must([
    page.getByRole("button", { name: /^(save|add|add customer|create)$/i }),
    page.getByRole("button", { name: /save customer|add customer/i }),
  ], "the save-customer button");

  // If Clover still won't allow Save, drop optional details one at a time (address, then phone).
  if (!(await enabledSoon(save)) && addressFields.length) {
    for (const f of addressFields) await f.fill("").catch(() => {});
    await logNote(page, "address left off the Clover customer (Clover would not accept it)");
  }
  if (!(await enabledSoon(save)) && phoneField) {
    await phoneField.fill("").catch(() => {});
    await logNote(page, "phone left off the Clover customer (Clover would not accept it without text consent)");
  }
  if (!(await enabledSoon(save))) throw new FillError("Clover won't let us save the new customer. Check the screenshot for the missing field.");
  await save.click();
  await page.waitForTimeout(1500);
}

async function enabledSoon(btn: Locator, ms = 1500): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await btn.isEnabled().catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function logNote(_page: Page, note: string) {
  console.log(`[note] ${note}`);
}

const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico",
};

/** "14 Park St, Montclair, NJ 07042" -> parts. Returns null when it doesn't look like a US address. */
export function parseUsAddress(raw: string): { street: string; city: string; stateCode: string; zip?: string } | null {
  const s = raw.replace(/\s+/g, " ").replace(/,?\s*(USA|United States)$/i, "").trim();
  const names = Object.entries(US_STATES);
  const m = s.match(/^(.+?),\s*([^,]+?),?\s+([A-Za-z]{2}|[A-Za-z][A-Za-z ]+?)\.?\s*(\d{5}(?:-\d{4})?)?$/);
  if (!m) return null;
  const st = m[3].trim();
  const code = st.length === 2 ? st.toUpperCase() : names.find(([, n]) => n.toLowerCase() === st.toLowerCase())?.[0];
  if (!code || !US_STATES[code]) return null;
  return { street: m[1].trim(), city: m[2].trim(), stateCode: code, zip: m[4] };
}

/** Clover's customer form splits the address: Address, Country, State / Province, Zip, City. */
async function fillAddress(page: Page, raw: string): Promise<Locator[]> {
  const filled: Locator[] = [];
  const addr = await firstVisible([page.getByLabel(/^address( line 1)?$/i), page.getByLabel(/^street/i)], 1500);
  if (!addr) return filled;
  const p = parseUsAddress(raw);
  await addr.fill(p ? p.street : raw);
  filled.push(addr);
  if (!p) return filled;
  await page.waitForTimeout(600); // let any address suggestions settle; we fill the parts ourselves
  await chooseValue(page, /^country/i, ["United States", "United States of America", "USA", "US"]);
  await chooseValue(page, /state|province/i, [US_STATES[p.stateCode], p.stateCode]);
  for (const [label, value] of [[/zip|postal/i, p.zip], [/city|town/i, p.city]] as const) {
    if (!value) continue;
    const f = await firstVisible([page.getByLabel(label)], 1000);
    if (f) { await f.fill(value); filled.push(f); }
  }
  return filled;
}

/** Fill a field that may be a dropdown (select), a searchable list, or plain text. */
async function chooseValue(page: Page, label: RegExp, values: string[]) {
  const f = await firstVisible([page.getByLabel(label), page.getByRole("combobox", { name: label })], 1000);
  if (!f) return;
  const tag = await f.evaluate((el) => (el as HTMLElement).tagName.toLowerCase()).catch(() => "");
  if (tag === "select") {
    for (const v of values) if (await f.selectOption({ label: v }).then(() => true).catch(() => false)) return;
    return;
  }
  for (const v of values) {
    await f.click().catch(() => {});
    await f.fill(v).catch(() => {});
    await page.waitForTimeout(500);
    const opt = page.getByRole("option", { name: new RegExp(`^${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") }).first();
    if (await opt.isVisible().catch(() => false)) { await opt.click(); return; }
    if (tag === "input" && (await f.inputValue().catch(() => "")) === v) {
      const list = page.getByRole("listbox");
      if (!(await list.isVisible().catch(() => false))) return; // plain text box: typed value stands
    }
  }
}

export async function setDate(page: Page, label: RegExp, iso: string, required: boolean): Promise<string | null> {
  const input = await firstVisible([page.getByLabel(label)], 3000);
  if (!input) {
    if (required) throw new FillError(`Could not find the ${label.source} field`);
    return null; // optional; dates are also in the note
  }
  const tag = await input.evaluate((el) => (el as HTMLElement).tagName.toLowerCase()).catch(() => "");
  const type = await input.getAttribute("type").catch(() => null);

  // Clover can reject a typed date ("Enter a valid date"). Try typing it two ways; for the expiration date,
  // fall back to slightly earlier dates (it may cap how far out an estimate can be valid).
  const candidates = required ? [iso, addDays(iso, -1), addDays(todayIso(), 29), addDays(todayIso(), 14)] : [iso];
  for (const d of candidates) {
    for (const style of ["slashes", "digits"] as const) {
      try {
        if (tag === "input" && type === "date") await input.fill(d);
        else {
          await input.click();
          await input.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => {});
          await input.press("Backspace").catch(() => {});
          await input.fill("").catch(() => {});
          const us = toUSDate(d);
          await input.pressSequentially(style === "slashes" ? us : us.replace(/\D/g, ""), { delay: 40 });
          await input.press("Tab").catch(() => {});
        }
      } catch { continue; }
      await page.waitForTimeout(400);
      const v = await input.inputValue().catch(() => "");
      const matches = v.replace(/\D/g, "") === toUSDate(d).replace(/\D/g, "");
      if (matches && !(await dateErrorShown(input))) {
        if (d !== iso) console.log(`[note] ${label.source}: Clover rejected ${toUSDate(iso)}, used ${toUSDate(d)}`);
        return d;
      }
    }
  }
  if (required) throw new FillError(`Clover rejected the ${label.source} (it says "Enter a valid date" for ${toUSDate(iso)}).`);
  return null;
}

/** Is Clover showing a date error under this field? */
async function dateErrorShown(input: Locator): Promise<boolean> {
  const invalid = await input.getAttribute("aria-invalid").catch(() => null);
  if (invalid === "true") return true;
  const box = input.locator("xpath=ancestor::*[self::div or self::fieldset][3]");
  return box.getByText(/enter a valid date|invalid date/i).first().isVisible().catch(() => false);
}

function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function addCustomItem(page: Page, name: string, priceCents: number, taxable: boolean, taxRate?: number) {
  const open = await must([page.getByRole("button", { name: /add custom item/i })], '"Add custom item"', 10_000);
  await open.click();
  const panel = page.getByRole("dialog").filter({ hasText: /custom item/i }).first();
  const scope = (await panel.isVisible().catch(() => false)) ? panel : page.locator("body");

  await (await must([scope.getByLabel(/item name/i), scope.getByPlaceholder(/item name/i)], "the item name field")).fill(name.slice(0, 80));
  const price = await must([scope.getByLabel(/^price$/i), scope.getByLabel(/price/i)], "the price field");
  await price.fill("");
  await price.type((priceCents / 100).toFixed(2));

  // Exactly one tax: the merchant's rate when taxable, "No tax rate" otherwise.
  const boxes = scope.getByRole("checkbox");
  const count = await boxes.count();
  const labels: string[] = [];
  for (let i = 0; i < count; i++) {
    const b = boxes.nth(i);
    const lbl = (await b.evaluate((el) => {
      const id = el.getAttribute("id");
      const byFor = id ? document.querySelector(`label[for="${id}"]`)?.textContent : null;
      return byFor ?? el.closest("label")?.textContent ?? el.getAttribute("aria-label") ?? el.parentElement?.textContent ?? "";
    })) || "";
    labels.push(lbl.trim());
  }
  const taxIdx = labels.map((l, i) => ({ l, i })).filter(({ l }) => /tax/i.test(l) && !/add to inventory/i.test(l));
  const noTax = taxIdx.find(({ l }) => /no tax/i.test(l));
  const realTaxes = taxIdx.filter(({ l }) => !/no tax/i.test(l));
  let want: number | undefined;
  if (!taxable) want = noTax?.i;
  else {
    const pattern = taxRate ? taxLabelPattern(taxRate) : null;
    want = (pattern ? realTaxes.find(({ l }) => pattern.test(l)) : undefined)?.i ?? realTaxes[0]?.i;
    if (want === undefined) throw new FillError("Taxable job, but no tax rate is set up on this Clover account");
  }
  for (const { i } of taxIdx) {
    const b = boxes.nth(i);
    if (i !== want && (await b.isChecked().catch(() => false))) await b.uncheck({ force: true });
  }
  if (want !== undefined) {
    const b = boxes.nth(want);
    if (!(await b.isChecked().catch(() => false))) {
      if (!(await b.isEnabled())) await page.waitForTimeout(500);
      if (await b.isEnabled()) await b.check({ force: true });
    }
  }

  const add = await must([scope.getByRole("button", { name: /^add$/i })], 'the "Add" button for the item');
  await add.click();
  await page.waitForTimeout(800);
}

async function attachPhotos(page: Page, urls: string[]) {
  const toggle = await firstVisible([page.getByRole("button", { name: /attachments/i }), page.getByText(/^attachments$/i)], 2000);
  if (toggle) await toggle.click().catch(() => {});
  const input = page.locator('input[type="file"]').first();
  if (!(await input.count())) throw new FillError("Could not find where to attach photos");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ce-photos-"));
  const files: string[] = [];
  for (const [i, url] of urls.slice(0, 3).entries()) {
    let data: Buffer | null = null;
    const stored = await loadFile(url).catch(() => null);
    if (stored) data = stored.data;
    else if (/^https?:\/\//.test(url)) {
      const res = await fetch(url);
      if (res.ok) data = Buffer.from(await res.arrayBuffer());
    }
    if (!data) throw new FillError(`Could not load photo ${i + 1}`);
    const file = path.join(dir, `photo-${i + 1}.jpg`);
    fs.writeFileSync(file, data);
    files.push(file);
  }
  await input.setInputFiles(files);
  await page.waitForTimeout(2000);
}

/** Reads the amount on the "Total" row of the form. */
export async function readTotalCents(page: Page): Promise<number | null> {
  const fromRow = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("body *")) as HTMLElement[];
    const label = els.find((el) => el.children.length === 0 && /^\s*total\s*$/i.test(el.textContent ?? ""));
    if (!label) return null;
    let node: HTMLElement | null = label;
    for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
      const m = (node.textContent ?? "").match(/total\s*\$?\s*([\d,]+\.\d{2})/i);
      if (m) return m[1];
    }
    return null;
  });
  return fromRow ? parseMoneyToCents(`$${fromRow}`) : null;
}

/** The send page has the "Send estimate via email" box. */
function sendPageBox(page: Page): Locator {
  return page.getByRole("checkbox", { name: /email|text|sms/i });
}

/**
 * Click Preview and make sure the send page actually opened. Nov 21: with a photo attached,
 * the first Preview click was ignored and the form just sat there, so we wait for uploads to
 * settle, then retry the click a few times before giving up with a clear message.
 */
async function openSendPage(page: Page, preview: Locator, hadPhotos: boolean) {
  if (hadPhotos) await waitForUploads(page);
  const formUrl = page.url();
  for (let attempt = 1; attempt <= 3; attempt++) {
    await preview.click().catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
    const opened = await firstVisible([sendPageBox(page)], 15_000);
    if (opened) return;
    if (page.url() !== formUrl && !(await preview.isVisible().catch(() => false))) {
      // Left the form but no delivery boxes yet: give the page a little longer.
      if (await firstVisible([sendPageBox(page)], 10_000)) return;
      break;
    }
    console.log(`[fill] Preview didn't open the send page (try ${attempt}), retrying`);
    if (hadPhotos) await waitForUploads(page);
    await page.waitForTimeout(2000 * attempt);
  }
  const msgs = await page.locator('[role="alert"], [aria-live], [class*="error" i]')
    .filter({ hasText: /\S/ }).allInnerTexts().catch(() => [] as string[]);
  const said = [...new Set(msgs.map((m) => m.trim()).filter((m) => m && m.length < 120))].slice(0, 3);
  throw new FillError(
    "Clover didn't open the send page after Preview" + (hadPhotos ? " (a photo may still have been uploading)" : "") +
    (said.length ? `. Clover says: ${said.join("; ")}` : "")
  );
}

/** Wait (up to 45s) until Clover stops showing upload spinners/progress for attachments. */
async function waitForUploads(page: Page) {
  const busy = page.locator('[role="progressbar"], [aria-busy="true"]').or(page.getByText(/uploading/i));
  const deadline = Date.now() + 45_000;
  await page.waitForTimeout(1500);
  while (Date.now() < deadline) {
    const n = await busy.count().catch(() => 0);
    let visible = false;
    for (let i = 0; i < n && !visible; i++) visible = await busy.nth(i).isVisible().catch(() => false);
    if (!visible) return;
    await page.waitForTimeout(1000);
  }
  console.log("[fill] attachments still look busy after 45s; trying Preview anyway");
}

async function setDelivery(page: Page, e: Estimate) {
  deliveryNote = null;
  const wantEmail = e.delivery === "email" || e.delivery === "both";
  const wantSms = e.delivery === "sms" || e.delivery === "both";
  // Real page (Nov 20): "Send estimate via email" (checked by default) and
  // "Send a link via SMS message" (greyed out when the customer has no phone).
  const email = await firstVisible([page.getByRole("checkbox", { name: /email/i })], 5000);
  const sms = await firstVisible([page.getByRole("checkbox", { name: /text|sms/i })], 1000);
  const smsUsable = !!sms && (await sms.isEnabled());
  const emailUsable = !!email && (await email.isEnabled());
  if (!email && !sms) throw new FillError("Could not find any delivery option on the send page");
  if (smsUsable) await setBox(page, sms!, wantSms, /send a link via sms/i);
  const smsOn = smsUsable && (await sms!.isChecked().catch(() => false));
  // Keep email on whenever text can't go out, so the customer always gets it.
  const keepEmail = wantEmail || !smsOn;
  if (emailUsable) await setBox(page, email!, keepEmail, /send estimate via email/i);
  if (wantSms && !smsOn) {
    deliveryNote = smsUsable
      ? "Clover didn't take the text option, so it went by email only."
      : "Clover wouldn't allow a text for this customer (likely no text consent on their Clover profile), so it went by email only.";
    console.log(`[note] ${deliveryNote}`);
  }
}

/** Notes about delivery for the last estimate (read by the caller). */
export let deliveryNote: string | null = null;

/** Tick or untick a checkbox; Clover's custom boxes sometimes need a click on their label instead. */
async function setBox(page: Page, box: Locator, want: boolean, labelText: RegExp) {
  if ((await box.isChecked().catch(() => !want)) === want) return;
  await (want ? box.check({ force: true }) : box.uncheck({ force: true })).catch(() => {});
  if ((await box.isChecked().catch(() => !want)) === want) return;
  await page.getByText(labelText).first().click().catch(() => {});
  await page.waitForTimeout(300);
}

async function findEstimateNumber(page: Page, customerName: string, totalCents: number): Promise<string | undefined> {
  await page.goto(estimatesUrl(), { waitUntil: "domcontentloaded", timeout: T.nav }).catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
  const rows = page.getByRole("row").filter({ hasText: customerName }).filter({ hasText: formatCents(totalCents) });
  const text = await rows.last().innerText().catch(() => "");
  return text.match(/\b(\d{6})\b/)?.[1];
}

// ---------------------------------------------------------------------------------------------
// Invoices (deposit / balance). Real form, mapped Nov 20 by the look-only scout:
//   /invoice-manager/create: "Select customer*" combobox, "Payment due date" (Upon Receipt),
//   "Itemized invoice" | "Quick charge", "Add custom item", Note (200), Attachments, "Review & Send".
//   /invoice-manager/review: "Email invoice to" (always on), "Copy and share invoice link", Message,
//   "Back" | "Send". No drafts and no text option for invoices.
// ---------------------------------------------------------------------------------------------
export interface InvoiceFill {
  itemName: string;
  note: string;
  subtotalCents: number;
  totalCents: number;
}

export async function fillInvoice(
  page: Page, rawEstimate: unknown, inv: InvoiceFill,
  opts: { dryRun: boolean; taxRate?: number; onStep?: (step: string, url: string) => Promise<void> }
): Promise<{ sent: boolean; cloverTotalCents: number; payLink?: string }> {
  const estimate: Estimate = EstimateSchema.parse(rawEstimate);
  const step = async (name: string) => {
    const url = await capture(page, `invoice-${name}`, { aria: true });
    await opts.onStep?.(name, url);
  };

  // Count matching invoices first, so after Send we can tell a new one appeared (deposit and balance can look alike).
  const before = opts.dryRun ? 0 : await countListedInvoices(page, estimate.customer.name, inv.totalCents);
  await page.goto(`${config.cloverBaseUrl}/invoice-manager/create`, { waitUntil: "domcontentloaded", timeout: T.nav });
  await page.waitForLoadState("networkidle").catch(() => {});
  await must([page.getByRole("combobox", { name: /select customer/i }), page.getByLabel(/select customer/i)], "the invoice form", 15_000);
  await step("01-new-invoice");

  await selectOrCreateCustomer(page, estimate);
  const itemized = await firstVisible([page.getByRole("radio", { name: /itemized invoice/i })], 1500);
  if (itemized && !(await itemized.isChecked().catch(() => true))) await itemized.click().catch(() => {});
  await addCustomItem(page, inv.itemName, inv.subtotalCents, estimate.taxable, opts.taxRate);
  const note = await firstVisible([page.getByLabel(/^note$/i), page.getByPlaceholder(/add a note/i)], 3000);
  if (note) await note.fill(inv.note.slice(0, 200));
  await step("02-filled");

  const cloverTotal = await readTotalCents(page);
  if (cloverTotal === null) throw new FillError("Could not read the total on the Clover invoice form");
  if (Math.abs(cloverTotal - inv.totalCents) > 1) {
    throw new FillError(`Invoice total mismatch, not sending: Clover shows ${formatCents(cloverTotal)}, app computed ${formatCents(inv.totalCents)}.`);
  }

  const review = await must([page.getByRole("button", { name: /review\s*(&|and)\s*send/i })], '"Review & Send"');
  if (!(await review.isEnabled().catch(() => false))) throw new FillError("Clover won't continue to Review & Send yet. See the screenshot.");
  await review.click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await must([page.getByRole("heading", { name: /review and send invoice/i }), page.getByRole("button", { name: /^send$/i })], "the invoice review page", 15_000);
  // Ask Clover for a shareable link too, so the merchant can text it from their own phone.
  const share = await firstVisible([page.getByRole("checkbox", { name: /share invoice link/i })], 2000);
  if (share) await setBox(page, share, true, /copy and share invoice link/i);
  await step("03-review");
  if (opts.dryRun) return { sent: false, cloverTotalCents: cloverTotal };

  const send = await must([page.getByRole("button", { name: /^send$/i })], 'the invoice "Send" button');
  await send.click();
  await page.waitForLoadState("networkidle").catch(() => {});
  // Clover's signals after Send vary: leave the review page, a success message, a share link, or Send going away.
  let payLink: string | undefined;
  let confirmed = false;
  for (let i = 0; i < 15 && !confirmed; i++) {
    await page.waitForTimeout(1000);
    payLink = payLink ?? (await findPayLink(page));
    confirmed =
      !/\/invoice-manager\/review/.test(page.url()) ||
      (await page.getByText(/invoice (sent|emailed|created)|successfully/i).first().isVisible().catch(() => false)) ||
      !!payLink ||
      !(await send.isVisible().catch(() => false));
  }
  await step("04-sent");
  if (!confirmed) {
    // Last word: Clover's own Invoices list.
    const after = await countListedInvoices(page, estimate.customer.name, inv.totalCents);
    confirmed = after > before;
  }
  if (!confirmed) throw new FillError("Clicked Send on the invoice, but couldn't confirm it in Clover. Check Clover's Invoices page before retrying.");
  return { sent: true, cloverTotalCents: cloverTotal, payLink };
}

/** How many invoices in Clover's list are for this customer and amount. */
async function countListedInvoices(page: Page, customerName: string, totalCents: number): Promise<number> {
  try {
    await page.goto(`${config.cloverBaseUrl}/invoice-manager`, { waitUntil: "domcontentloaded", timeout: T.nav });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.getByRole("row").nth(1).waitFor({ timeout: 10_000 }).catch(() => {});
    const amount = formatCents(totalCents);
    const first = customerName.trim().split(/\s+/)[0].toLowerCase();
    const rows = await page.getByRole("row").allInnerTexts();
    return rows.filter((r) => r.includes(amount) && r.toLowerCase().includes(first)).length;
  } catch {
    return 0;
  }
}

/** After sending, Clover may show the invoice link (shared-link option). Grab it if it's on screen. */
async function findPayLink(page: Page): Promise<string | undefined> {
  const fromInputs = await page.locator("input").evaluateAll((els) =>
    els.map((e) => (e as HTMLInputElement).value).find((v) => /^https:\/\/\S*clover\.com\/\S+/i.test(v || ""))
  ).catch(() => undefined);
  if (fromInputs) return fromInputs;
  const text = await page.locator("body").innerText().catch(() => "");
  return text.match(/https:\/\/\S*clover\.com\/(?:p|pay|invoice|i)\S*/i)?.[0];
}

/** Read Clover's estimates list: estimate number -> status text (e.g. "Accepted"). */
export async function readEstimateStatuses(page: Page): Promise<Map<string, string>> {
  await page.goto(estimatesUrl(), { waitUntil: "domcontentloaded", timeout: T.nav });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByRole("table").first().waitFor({ timeout: 15_000 }).catch(() => {});
  const rows = await page.getByRole("row").allInnerTexts().catch(() => [] as string[]);
  const out = new Map<string, string>();
  for (const r of rows) {
    const num = r.match(/\b(\d{6})\b/)?.[1];
    const status = r.match(/\b(Draft|Pending|Accepted|Declined|Cancell?ed|Converted|Expired)\b/i)?.[1];
    if (num && status) out.set(num, status);
  }
  return out;
}
