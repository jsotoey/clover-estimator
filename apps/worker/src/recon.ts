import type { Page } from "playwright";
import { capture } from "./browser";
import { logEvent } from "./db";

/**
 * RECON: map the Clover dashboard's estimate flow so real selectors can be written.
 * Saves a screenshot, HTML and ARIA snapshot at each step. Never saves or sends anything.
 */
export async function runRecon(page: Page): Promise<void> {
  const snap = async (label: string) => {
    const url = await capture(page, `recon-${label}`, { html: true, aria: true });
    await logEvent(null, "recon", { label, page: page.url(), screenshot: url });
  };

  await snap("01-home");

  // Find the estimates area: try links/menu items first, then search the page.
  const estimateLink = page.getByRole("link", { name: /estimates?/i }).or(page.getByRole("menuitem", { name: /estimates?/i }));
  if (await estimateLink.first().isVisible().catch(() => false)) {
    await estimateLink.first().click();
  } else {
    // Many dashboards nest it under Transactions / Invoices / Virtual Terminal.
    for (const parent of [/transactions/i, /invoic/i, /virtual terminal/i, /customers/i]) {
      const p = page.getByRole("link", { name: parent }).or(page.getByRole("button", { name: parent }));
      if (await p.first().isVisible().catch(() => false)) {
        await p.first().click();
        await page.waitForTimeout(1500);
        if (await estimateLink.first().isVisible().catch(() => false)) {
          await estimateLink.first().click();
          break;
        }
      }
    }
  }
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);
  await snap("02-estimates-list");

  const create = page.getByRole("button", { name: /(create|new|add).*estimate|^create$|^new$/i })
    .or(page.getByRole("link", { name: /(create|new|add).*estimate/i }));
  if (await create.first().isVisible().catch(() => false)) {
    await create.first().click();
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2000);
    await snap("03-new-estimate-form");
    // Scroll through the form so lower fields (tax, note, attachments, delivery) get captured.
    for (let i = 1; i <= 3; i++) {
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(800);
      await snap(`04-form-scroll-${i}`);
    }
  } else {
    await logEvent(null, "recon", { label: "no-create-button-found", page: page.url() });
  }
  // Leave the form without saving.
  await logEvent(null, "recon_done", { page: page.url() });
}
