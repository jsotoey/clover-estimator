import { chromium, type BrowserContext, type Page } from "playwright";
import { profileDir } from "./session";
import { config } from "./config";
import { saveArtifact } from "./artifacts";

export async function openContext(): Promise<BrowserContext> {
  return chromium.launchPersistentContext(profileDir(config.dataDir), {
    headless: true,
    executablePath: process.env.CHROME_PATH || undefined, // optional; the Docker image ships its own browser
    viewport: { width: 1366, height: 900 },
    locale: "en-US",
    timezoneId: "America/New_York",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
}

/** Screenshot + optional HTML + ARIA snapshot of the current page. Returns the screenshot URL. */
export async function capture(page: Page, label: string, opts: { html?: boolean; aria?: boolean } = {}): Promise<string> {
  const shot = await page.screenshot({ fullPage: true });
  const url = await saveArtifact(`${label}.png`, shot, "image/png");
  if (opts.html) await saveArtifact(`${label}.html`, await page.content(), "text/html");
  if (opts.aria) {
    const aria = await page.locator("body").ariaSnapshot().catch((e) => `ariaSnapshot failed: ${e}`);
    await saveArtifact(`${label}.aria.yaml`, `# ${page.url()}\n${aria}`, "text/yaml");
  }
  console.log(`[capture] ${label} -> ${url}`);
  return url;
}
