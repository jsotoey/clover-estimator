import type { Page } from "playwright";
import { db, logEvent } from "./db";
import { newPage, useStore } from "./browser";
import { loadStores, storeById } from "./stores";
import { config } from "./config";
import { redactAria } from "./redact";
export { redactAria };

/**
 * Look-only scouting of Clover screens. A task lists steps (open a page, click a row/button/link by its text),
 * then the worker reports the URL, an accessibility outline and every field/button on screen.
 * It refuses to click anything that could send, save, pay, charge or delete.
 */
type Step = { goto?: string } | { click: string; role?: "button" | "link" | "row" | "text" | "tab" | "option" };

const BLOCKED = /\b(send|save|submit|pay|charge|delete|remove|refund|void|confirm|accept|decline|cancel)\b/i;

export async function runScoutTask(): Promise<boolean> {
  const { rows } = await db().query<{ id: number; payload: { steps?: Step[] }; merchant_id: number | null }>(
    `UPDATE worker_tasks SET status = 'running' WHERE id = (
       SELECT id FROM worker_tasks WHERE status = 'queued' AND kind = 'scout' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1
     ) RETURNING id, payload, merchant_id`
  );
  const task = rows[0];
  if (!task) return false;
  // Look-only tasks run in the store they were queued for (the first store if none was given).
  const store = (await storeById(task.merchant_id)) ?? (await loadStores())[0];
  if (store) await useStore(store);
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
  const aria = redactAria((await page.locator("body").ariaSnapshot({ timeout: 10_000 }).catch(() => "")).slice(0, 30_000));
  // Passed as text: the TypeScript runner adds helper names to inline functions that don't exist in the page.
  const controls = (await page.evaluate(`(() => {
    const out = [];
    const label = (el) => {
      const id = el.getAttribute("id");
      const byFor = id ? document.querySelector('label[for="' + CSS.escape(id) + '"]')?.textContent : null;
      return (el.getAttribute("aria-label") || byFor || el.closest("label")?.textContent || el.getAttribute("placeholder") || el.getAttribute("name") || "").trim().slice(0, 80);
    };
    for (const el of Array.from(document.querySelectorAll("input, select, textarea, button, [role=combobox], [role=checkbox], [role=switch], [role=radio]"))) {
      if (!el.offsetParent && el.tagName !== "SELECT") continue;
      const kind = el.tagName.toLowerCase() + (el.getAttribute("type") ? "[" + el.getAttribute("type") + "]" : "") + (el.getAttribute("role") ? "{" + el.getAttribute("role") + "}" : "");
      const text = el.tagName === "BUTTON" ? (el.innerText || "").trim().slice(0, 60) : label(el);
      // Never record what's typed in a password, email, code or PIN box (or anything on a login page).
      const secret = /password|passcode|pin|code|email|otp|token/i.test(String(el.getAttribute("type")) + " " + String(el.getAttribute("autocomplete")) + " " + String(el.getAttribute("name")) + " " + label(el)) || /login|sign-?in/i.test(location.pathname);
      const value = el.tagName === "BUTTON" || el.value === undefined || el.value === "" ? "" : secret ? ' = "[hidden]"' : ' = "' + String(el.value).slice(0, 40) + '"';
      const dis = el.disabled ? " (disabled)" : "";
      out.push(kind + " " + text + value + dis);
    }
    return out.slice(0, 200);
  })()`)) as string[];
  return { url, controls, aria };
}


// ---------------------------------------------------------------------------------------------
// Store setup tasks (kind 'setup'): add crew employees and the bookable install service in the
// store's own Clover. Queued by the admin. Payload: {actions: [{type:"employee",name,email} | {type:"service",name,minutes}]}
// ---------------------------------------------------------------------------------------------
import { createEmployee, createService, assignServiceEmployees } from "./clover/setup";
import { checkSession, assertRightStore } from "./clover/session";
import { capture } from "./browser";

type SetupAction = { type: "employee"; name: string; email: string } | { type: "service"; name: string; minutes?: number } | { type: "assign"; service: string; employees: string[] };

export async function runSetupTask(): Promise<boolean> {
  const { rows } = await db().query<{ id: number; payload: { actions?: SetupAction[] }; merchant_id: number | null }>(
    `UPDATE worker_tasks SET status = 'running' WHERE id = (
       SELECT id FROM worker_tasks WHERE status = 'queued' AND kind = 'setup' AND merchant_id IS NOT NULL ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1
     ) RETURNING id, payload, merchant_id`
  );
  const task = rows[0];
  if (!task) return false;
  const store = await storeById(task.merchant_id);
  const results: string[] = [];
  let failed = false;
  if (store) {
    await useStore(store);
    const page = await newPage();
    try {
      if (!(await checkSession(page))) throw new Error("This store isn't signed in to Clover");
      await assertRightStore(page);
      for (const a of task.payload.actions ?? []) {
        try {
          const r = a.type === "employee" ? await createEmployee(page, a.name, a.email)
            : a.type === "service" ? await createService(page, a.name, a.minutes ?? 120)
            : await assignServiceEmployees(page, a.service, a.employees);
          results.push(`${a.type} "${a.type === "assign" ? a.service : a.name}": ${r}`);
        } catch (e) {
          failed = true;
          results.push(`${a.type} "${a.type === "assign" ? a.service : a.name}": FAILED ${e instanceof Error ? e.message : e}`);
          const shot = await capture(page, `setup-failed`, { aria: true }).catch(() => "");
          if (shot) results.push(`screenshot ${shot}`);
        }
      }
    } catch (e) {
      failed = true;
      results.push(`FAILED ${e instanceof Error ? e.message : e}`);
    } finally {
      await page.close().catch(() => {});
    }
  } else { failed = true; results.push("store not found"); }
  await db().query(`UPDATE worker_tasks SET status = $2, result = $3, finished_at = now() WHERE id = $1`,
    [task.id, failed ? "failed" : "done", JSON.stringify({ results })]);
  await logEvent(null, "store_setup", { store: store?.slug, results });
  return true;
}
