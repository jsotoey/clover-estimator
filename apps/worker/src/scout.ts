import type { Page } from "playwright";
import { db, logEvent } from "./db";
import { newPage } from "./browser";
import { config } from "./config";

/**
 * Look-only scouting of Clover screens. A task lists steps (open a page, click a row/button/link by its text),
 * then the worker reports the URL, an accessibility outline and every field/button on screen.
 * It refuses to click anything that could send, save, pay, charge or delete.
 */
type Step = { goto?: string } | { click: string; role?: "button" | "link" | "row" | "text" | "tab" | "option" };

const BLOCKED = /\b(send|save|submit|pay|charge|delete|remove|refund|void|confirm|accept|decline|cancel)\b/i;

export async function runScoutTask(): Promise<boolean> {
  const { rows } = await db().query<{ id: number; payload: { steps?: Step[] } }>(
    `UPDATE worker_tasks SET status = 'running' WHERE id = (
       SELECT id FROM worker_tasks WHERE status = 'queued' AND kind = 'scout' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1
     ) RETURNING id, payload`
  );
  const task = rows[0];
  if (!task) return false;
  const page = await newPage();
  const log: string[] = [];
  try {
    for (const s of task.payload.steps ?? []) {
      if ("goto" in s && s.goto) {
        await page.goto(new URL(s.goto, config.cloverBaseUrl).toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
        log.push(`goto ${s.goto}`);
      } else if ("click" in s) {
        if (BLOCKED.test(s.click)) throw new Error(`refused to click "${s.click}" (look-only)`);
        const loc =
          s.role === "button" ? page.getByRole("button", { name: s.click }) :
          s.role === "link" ? page.getByRole("link", { name: s.click }) :
          s.role === "row" ? page.getByRole("row").filter({ hasText: s.click }) :
          s.role === "tab" ? page.getByRole("tab", { name: s.click }) :
          s.role === "option" ? page.getByRole("option", { name: s.click }) :
          page.getByText(s.click, { exact: false });
        await loc.first().click({ timeout: 15_000 });
        log.push(`click ${s.role ?? "text"} "${s.click}"`);
      }
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(1500);
    }
    const result = await describe(page);
    await db().query(`UPDATE worker_tasks SET status = 'done', result = $2, finished_at = now() WHERE id = $1`, [task.id, { log, ...result }]);
    await logEvent(null, "scout_done", { taskId: task.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 500) : String(e);
    const result = await describe(page).catch(() => ({}));
    await db().query(`UPDATE worker_tasks SET status = 'failed', result = $2, finished_at = now() WHERE id = $1`, [task.id, { log, error: msg, ...result }]);
    await logEvent(null, "scout_failed", { taskId: task.id, error: msg });
  } finally {
    await page.close().catch(() => {});
  }
  return true;
}

async function describe(page: Page) {
  const url = page.url();
  const aria = (await page.locator("body").ariaSnapshot({ timeout: 10_000 }).catch(() => "")).slice(0, 30_000);
  const controls = await page.evaluate(() => {
    const out: string[] = [];
    const label = (el: Element) => {
      const id = el.getAttribute("id");
      const byFor = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent : null;
      return (el.getAttribute("aria-label") || byFor || el.closest("label")?.textContent || el.getAttribute("placeholder") || el.getAttribute("name") || "").trim().slice(0, 80);
    };
    for (const el of Array.from(document.querySelectorAll("input, select, textarea, button, [role=combobox], [role=checkbox], [role=switch], [role=radio]"))) {
      const h = el as HTMLElement;
      if (!h.offsetParent && h.tagName !== "SELECT") continue; // hidden
      const kind = el.tagName.toLowerCase() + (el.getAttribute("type") ? `[${el.getAttribute("type")}]` : "") + (el.getAttribute("role") ? `{${el.getAttribute("role")}}` : "");
      const text = el.tagName === "BUTTON" ? (h.innerText || "").trim().slice(0, 60) : label(el);
      const value = (el as HTMLInputElement).value !== undefined && el.tagName !== "BUTTON" ? ` = "${String((el as HTMLInputElement).value).slice(0, 40)}"` : "";
      const dis = (el as HTMLButtonElement).disabled ? " (disabled)" : "";
      out.push(`${kind} ${text}${value}${dis}`);
    }
    return out.slice(0, 200);
  });
  return { url, controls, aria };
}
