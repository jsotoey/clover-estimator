# Clover Estimate Assistant

A merchant chats with an AI on their phone, reviews the estimate, taps **Approve and send**, and a cloud worker fills out and sends the estimate in their Clover dashboard. The app never touches money. Full spec: [KICKOFF.md](KICKOFF.md).

```
apps/web      Next.js app (Vercel): PIN, chat, photos, review card, status
apps/worker   Playwright worker (Railway): Clover login, RECON, fill estimate
packages/core Shared schema + pricing math (all customer-facing numbers)
db/schema.sql Postgres schema (applied automatically when the worker starts)
```

## Status
- [x] Milestone 1: scaffold, schema, pricing + tests
- [x] Milestone 2: worker login (with verification-code handoff) + RECON mode
- [ ] Milestone 3: web chat, photos, review card
- [ ] Milestone 4: fill the estimate (needs RECON output first)
- [ ] Milestone 5: polish

## Deploy from your phone

### 1. Railway: database (2 min)
1. railway.com → **New Project** → **Deploy PostgreSQL**.
2. Tap the Postgres service → **Variables** → copy `DATABASE_PUBLIC_URL`. That's `DATABASE_URL` for Vercel.

### 2. Vercel: photo/screenshot storage (1 min)
1. vercel.com → **Storage** → **Create** → **Blob**. Copy `BLOB_READ_WRITE_TOKEN`.

### 3. Railway: the worker (3 min)
1. Same Railway project → **+ New** → **GitHub Repo** → `clover-estimator`. Leave Root Directory **empty** (the repo's `railway.json` points at `apps/worker/Dockerfile`).
2. Service → **Settings** → **Volumes** → add a volume mounted at `/data` (keeps the Clover login between restarts).
3. Service → **Variables**:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (Railway's reference picker)
   - `BLOB_READ_WRITE_TOKEN` = from step 2
   - `CLOVER_EMAIL`, `CLOVER_PASSWORD` = the employee login on M&J's Clover account
   - `DRY_RUN` = `true`
   - `RECON` = `true` (first run only)
4. Deploy. Open **Deployments → View logs**. Every `[capture]` line is a screenshot URL.

### 4. If Clover asks for a verification code
The logs show `needs_code`. Until the web app has its code box (milestone 3), enter it from Railway: Postgres → **Data** → `verification_codes` → **+ Row**, `code` = the 6 digits (leave the other fields blank). The worker picks it up within a few seconds and asks Clover to remember the device.

### 5. After RECON
Paste the RECON screenshot / `.aria.yaml` URLs from the logs into the Claude Code session so it can write the real estimate-form selectors (milestone 4). Then set `RECON=false`.

### 6. Vercel: the web app (after milestone 3)
vercel.com → **Add New → Project** → `clover-estimator` → Root Directory `apps/web` → env vars: `ANTHROPIC_API_KEY`, `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, `MERCHANT_PIN`, `MERCHANT_TAX_RATE`, `PAYMENT_PROGRAM`.

## Changing the Clover login
Edit `CLOVER_EMAIL` / `CLOVER_PASSWORD` in Railway and redeploy. The worker notices the email changed, deletes the saved Clover session, and logs in fresh. Nothing else to change.

## Safety switches
- `DRY_RUN=true` (default): fills everything and screenshots, never clicks Send.
- Before sending, the worker compares Clover's total to our computed total and stops on any mismatch over $0.01.
- Screenshots go to Vercel Blob under random URLs. They can show customer details, so don't share the links.

## Local dev
```
pnpm install
pnpm test        # pricing + login-swap tests
pnpm typecheck
pnpm build:web
```
