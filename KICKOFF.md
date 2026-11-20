# KICKOFF: Clover Estimate Assistant (MVP, target: working Saturday)

## Setup status (Jon, read first)
Accounts Jon has signed in to: GitHub (this repo), claude.ai/code, Railway, Vercel, Anthropic Console.

Only Jon can do these, from his phone (no laptop needed). Claude Code cannot create cloud resources or handle secrets for him:
- [ ] Make this repo **private** (GitHub → Settings → General → Danger Zone → Change visibility).
- [ ] Anthropic Console: create an API key and add credit.
- [ ] Railway: new project → add **Postgres** → copy its public `DATABASE_URL`.
- [ ] Vercel: Storage → create a **Blob** store → copy `BLOB_READ_WRITE_TOKEN`.
- [ ] Clover login: for testing, use one of Jon's own emails added as an employee on M&J's Clover account (with access to estimates). Swap to a dedicated bot login later by changing `CLOVER_EMAIL` / `CLOVER_PASSWORD` in Railway; the worker resets its saved session automatically.
- [ ] After milestones 1–2 are merged: Vercel → import repo, root `apps/web`, add the web env vars. Railway → new service from the repo, root `apps/worker`, volume at `/data`, add the worker env vars, `RECON=true`.

Claude Code: do the milestones below. In the README, write the deploy steps above as tap-by-tap instructions Jon can follow on his phone.

---

Read this whole file before writing code. Also read `prompts/estimate-assistant.md`, the AI system prompt; do not change its rules.

## What we're building
A mobile-first web app for a field-service merchant (first user: M&J Painting and Reno, a Clover merchant in NJ). The merchant chats with an AI (voice through the iPhone keyboard mic, or text), attaches photos, reviews a finished estimate, and taps **Approve and send**. A background worker then logs in to the merchant's **Clover web dashboard** with a headless browser, fills out a new **estimate**, and sends it to the customer by email and/or SMS.

- The app **never takes or moves money.** Clover handles all payments.
- Clover's public REST API has no estimate or invoice endpoints, so the worker drives the dashboard UI with Playwright.
- It must work with the merchant alone, from their phone, on any network. **Nothing runs on anyone's laptop.**

## Stack (keep it boring)
- pnpm workspace monorepo:
  - `apps/web`: Next.js (App Router, TypeScript, Tailwind), deployed on **Vercel**
  - `apps/worker`: Node + TypeScript + Playwright, deployed on **Railway** from a Dockerfile based on the official `mcr.microsoft.com/playwright` image, with a Railway volume mounted at `/data`
  - `packages/core`: shared types, zod schemas, pricing math (pure functions, unit-tested with vitest)
- **Database:** Railway Postgres. The "queue" is the `estimates` table: the worker polls for `status = 'approved'` with `SELECT … FOR UPDATE SKIP LOCKED`. No Redis.
- **Photos:** Vercel Blob.
- **AI:** Anthropic SDK, model `claude-sonnet-5-5`, with the `submit_estimate` tool defined in `prompts/estimate-assistant.md`. Inject today's date (America/New_York) into the system prompt on every request.
- **Auth for MVP:** one merchant; a PIN screen (`MERCHANT_PIN` env) that sets an httpOnly cookie. No user accounts yet.

## Data model
- `estimates`: id, status (`drafting | ready_for_review | approved | sending | needs_code | sent | failed`), conversation (jsonb), estimate (jsonb, matches `submit_estimate`), computed (jsonb: line totals, tax, total, deposit, balance), clover_estimate_number, error, screenshot_urls (text[]), created_at, updated_at
- `verification_codes`: estimate_id, code, created_at (for Clover 2FA prompts)
- `events`: estimate_id, type, detail, created_at (audit log of every worker step)

## Pricing (packages/core/pricing.ts). Code does ALL math; the AI does none.
- Input: line items (merchant's exact prices), `taxable`, `taxRate` (ONE rate from the `MERCHANT_TAX_RATE` env, e.g. 0.06625), `paymentProgram` (`none | surcharge | cash_discount`, from env `PAYMENT_PROGRAM`, default `none`), `depositPercent`
- `cash_discount`: card price = base ÷ 0.96 per line (never × 1.04). `surcharge`: no change to the estimate prices; Clover applies the surcharge at payment.
- tax = subtotal × taxRate if taxable, else 0. total = subtotal + tax. deposit = round(total × depositPercent/100) to cents, half-up. balance = total − deposit.
- Unit tests required, including: $1,000, taxable at 6.625%, 50% deposit → tax 66.25, total 1,066.25, deposit 533.13, balance 533.12. And the cash-discount case: $1,000 → $1,041.67.

## The web app (one screen, phone-first)
1. PIN screen → chat.
2. Chat thread with a text box and a photo button. Keep it big, fast and thumb-friendly.
3. **Photos:** convert HEIC → JPEG in the browser (`heic2any`), compress (`browser-image-compression`), max 3, 25 MB total, upload to Blob.
4. When the AI calls `submit_estimate`, validate with zod; then show a **Review card**: customer, lines, subtotal, tax, total, deposit and due date, balance, dates, the 200-character note (with a character count), photos, and delivery method. Buttons: **Approve and send** and **Change something** (back to chat).
5. After approval: a status banner that polls `/api/estimates/:id`: Sending… → Sent ✓ (with the Clover estimate number and the final screenshot) | **Needs code** (shows a 6-digit input that writes `verification_codes`) | Failed (shows the error and screenshot, with a Retry button).
6. Spanish and English both work (the system prompt handles language; UI labels can stay English for now).

## The worker (apps/worker)
- Loop: every 5 s, claim one `approved` estimate → `sending`.
- Browser: Playwright **persistent context** at `/data/clover-profile` so the login and the trusted device survive restarts.
- **The login must be swappable.** For testing, Jon is using one of his own emails; it will be replaced by a dedicated bot login later. Nothing may hard-code it: it comes only from `CLOVER_EMAIL` / `CLOVER_PASSWORD`. The worker stores the email it last logged in with in `/data/last-login.txt`; if the env email differs on startup, it wipes `/data/clover-profile` and logs in fresh. Changing the login = edit two env vars in Railway + redeploy. Document this in the README.
- **Login:** if signed out, sign in with `CLOVER_EMAIL` / `CLOVER_PASSWORD` (a dedicated employee login the merchant created for this app). If Clover asks for a verification code: set `needs_code`, wait up to 10 min for a row in `verification_codes`, enter it, continue. Timeout → `failed`.
- **Fill the estimate.** Prefer `getByRole` / `getByLabel` / text selectors over CSS. Fields, as seen in the dashboard: customer (search existing by phone/email, else create), service date, expiration date, payment due, line items (custom items: description + price), the ONE tax rate (and confirm no second tax is applied), the note (≤ 200 chars), up to 3 attachments, and delivery (email/SMS).
- **Safety check before sending:** read the total Clover shows and compare it to `computed.total`. Mismatch of more than $0.01 → do NOT send; set `failed` with both numbers and a screenshot.
- `DRY_RUN=true` (the default) fills everything, screenshots, and stops before Send (status `sent` with the note "dry run"). Only when `DRY_RUN=false` does it click Send.
- Screenshot after every major step, upload it to Blob, and log an `events` row.
- **RECON mode** (`RECON=true`): log in, open the new-estimate form, and save screenshots plus an accessibility snapshot (`page.accessibility.snapshot()`) and the HTML of each step to Blob, then exit. We use its output to write correct selectors, because nobody coding this can see the Clover dashboard directly.

## Milestones (do them in this order; commit after each)
1. **Scaffold:** monorepo, the three packages, the DB schema and migration script, the Dockerfile for the worker, a README with deploy steps and every env var. `pnpm test` passes for pricing.
2. **Worker login + RECON** (this is the riskiest part, so it goes first).
3. **Web:** PIN, chat with Claude + the tool call, the review card, photos.
4. **Approve → worker fills the estimate (dry run) → status banner**, including the needs-code flow.
5. **Polish:** error states, retry, and a "new estimate" button.
(Later, not now: the deposit invoice after the customer accepts, multiple merchants, the price sheet.)

## Rules
- Never commit secrets; everything comes from env vars. Ship a `.env.example`.
- You cannot reach Clover or run Playwright against it from this coding environment: write the worker code and tests that don't need Clover, and leave live verification to Railway (RECON mode).
- The AI must never invent or change prices (see the prompt). Every number the customer sees comes from `packages/core/pricing.ts`.
- Keep the UI simple and fast on an iPhone. No extra features.

## Env vars
**Vercel (apps/web):** `ANTHROPIC_API_KEY`, `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, `MERCHANT_PIN`, `MERCHANT_TAX_RATE`, `PAYMENT_PROGRAM`
**Railway (apps/worker):** `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, `CLOVER_EMAIL`, `CLOVER_PASSWORD`, `DRY_RUN=true`, `RECON=false`
