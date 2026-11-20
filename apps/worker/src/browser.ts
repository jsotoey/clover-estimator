import { chromium, type BrowserContext, type Page } from "playwright";
import { profileDir } from "./session";
import { config } from "./config";
import { saveArtifact } from "./artifacts";

/** The live view and the click mapping both use this size. */
export const VIEWPORT = { width: 1280, height: 800 };

let shared: Promise<BrowserContext> | null = null;

/**
 * One long-lived Chrome for the whole worker, so the Clover session survives between estimates.
 * It runs as a normal (headed) Chrome inside a virtual display on the server; no fake browser identity.
 */
export function getContext(): Promise<BrowserContext> {
  if (!shared) {
    shared = chromium
      .launchPersistentContext(profileDir(config.dataDir), {
        headless: config.headless,
        executablePath: process.env.CHROME_PATH || undefined,
        viewport: VIEWPORT,
        locale: "en-US",
        timezoneId: "America/New_York",
      })
      .then((ctx) => {
        ctx.on("close", () => (shared = null));
        return ctx;
      })
      .catch((e) => {
        shared = null;
        throw e;
      });
  }
  return shared;
}

/** Kept for RECON and tests. */
export const openContext = getContext;

export async function newPage(): Promise<Page> {
  const ctx = await getContext();
  return ctx.newPage();
}

/** Screenshot + optional HTML + ARIA snapshot of the current page. Returns the screenshot URL. */
export async function capture(page: Page, label: string, opts: { html?: boolean; aria?: boolean } = {}): Promise<string> {
  const shot = await page.screenshot({ fullPage: true });
  const url = await saveArtifact(`${label}.png`, shot, "image/png");
  if (opts.html) await saveArtifact(`${label}.html`, await page.content(), "text/html");
  if (opts.aria) {
    const aria = await page.locator("body").ariaSnapshot().catch((e) => `ariaSnapshot failed: ${e}`);
    await saveArtifact(`${label}.aria.yaml`, `# ${page.url()}\n${aria}`, "text/yaml");
    console.log(`[aria:${label}] ${page.url()}\n${aria}\n[/aria:${label}]`);
  }
  console.log(`[capture] ${label} -> ${url}`);
  return url;
}
