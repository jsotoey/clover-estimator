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
  await review.click();
  await page.waitForLoadState("networkidle").catch(() => {});
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
  if (e.customer.phone) {
    const phone = await firstVisible([page.getByLabel(/phone/i)], 1500);
    if (phone) await phone.pressSequentially(e.customer.phone.replace(/\D/g, ""), { delay: 20 });
  }
  if (e.customer.job_address) {
    const addr = await firstVisible([page.getByLabel(/^address$/i)], 1500);
    if (addr) await addr.fill(e.customer.job_address);
  }
  const save = await must([
    page.getByRole("button", { name: /^(save|add|add customer|create)$/i }),
    page.getByRole("button", { name: /save customer|add customer/i }),
  ], "the save-customer button");
  await save.click();
  await page.waitForTimeout(1500);
}

async function setDate(page: Page, label: RegExp, iso: string, required: boolean) {
  const input = await firstVisible([page.getByLabel(label)], 3000);
  if (!input) {
    if (required) throw new FillError(`Could not find the ${label.source} field`);
    return; // optional; dates are also in the note
  }
  const tag = await input.evaluate((el) => (el as HTMLElement).tagName.toLowerCase()).catch(() => "");
  const type = await input.getAttribute("type").catch(() => null);
  try {
    if (tag === "input" && type === "date") await input.fill(iso);
    else if (tag === "input") {
      await input.click();
      await input.fill("");
      await input.pressSequentially(toUSDate(iso), { delay: 30 });
      await input.press("Tab").catch(() => {});
    }
  } catch (e) {
    if (required) throw new FillError(`Could not set ${label.source}: ${(e as Error).message}`);
  }
  if (required) {
    const v = await input.inputValue().catch(() => "");
    if (v.replace(/\D/g, "") !== toUSDate(iso).replace(/\D/g, "")) throw new FillError(`${label.source} did not take the value ${toUSDate(iso)} (shows "${v}")`);
  }
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

async function setDelivery(page: Page, e: Estimate) {
  const wantEmail = e.delivery === "email" || e.delivery === "both";
  const wantSms = e.delivery === "sms" || e.delivery === "both";
  // Real page (Nov 20): "Send estimate via email" (checked by default) and
  // "Send a link via SMS message" (greyed out when the customer has no phone).
  const email = await firstVisible([page.getByRole("checkbox", { name: /email/i })], 5000);
  const sms = await firstVisible([page.getByRole("checkbox", { name: /text|sms/i })], 1000);
  const smsUsable = !!sms && (await sms.isEnabled());
  const emailUsable = !!email && (await email.isEnabled());
  if (!email && !sms) throw new FillError("Could not find any delivery option on the send page");
  if (smsUsable) await (wantSms ? sms!.check({ force: true }) : sms!.uncheck({ force: true }));
  // Keep email on whenever text can't go out, so the customer always gets it.
  const keepEmail = wantEmail || !smsUsable;
  if (emailUsable) await (keepEmail ? email!.check({ force: true }) : email!.uncheck({ force: true }));
}

async function findEstimateNumber(page: Page, customerName: string, totalCents: number): Promise<string | undefined> {
  await page.goto(estimatesUrl(), { waitUntil: "domcontentloaded", timeout: T.nav }).catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
  const rows = page.getByRole("row").filter({ hasText: customerName }).filter({ hasText: formatCents(totalCents) });
  const text = await rows.last().innerText().catch(() => "");
  return text.match(/\b(\d{6})\b/)?.[1];
}
