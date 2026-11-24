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
- [x] Milestone 3: web chat (Claude + submit_estimate tool), PIN, photos (HEIC→JPEG), review card, status banner with code entry
- [x] Milestone 4: fill the estimate (tested against a local replica of the Clover form; first real run still to confirm selectors)
- [ ] Milestone 5: polish

## Deploy (all on Railway)

One Railway project ("insightful-manifestation") with three services: **Postgres**, **worker**, **web**. Photos and screenshots are stored in Postgres, so there is no other storage to set up. Non-secret settings are already filled in; see `.env.example` for the full list.

### Secrets only Jon sets (Railway → service → Variables)
- **worker:** `CLOVER_EMAIL`, `CLOVER_PASSWORD`
- **web:** `ANTHROPIC_API_KEY` (console.anthropic.com → API Keys), `MERCHANT_PIN` (any number you'll remember)

Adding a variable redeploys the service on its own (tap **Deploy** if Railway shows a staged change).

### Signing in to Clover (Connect Clover)
Clover's login is protected by reCAPTCHA and asks for codes, so a person signs in, not the server. Open the app → **Clover** (top right) → **Sign in to Clover**. You'll see the worker's browser live: the email and password are already filled in, so tap **Log in** on the picture, type the code in the box, and tap **Enter**. The worker keeps that session. When Clover signs it out, estimates wait as "Clover needs you to sign in" and send automatically right after you do. The Clover screen keeps a sign-in history so you can see how often it happens.

### If Clover asks for a verification code
During an estimate, the app shows a code box. During RECON (no estimate yet): Railway → **Postgres → Data → verification_codes → + Row**, `code` = the digits. The worker picks it up within a few seconds and asks Clover to remember the device.

### RECON (one-time scouting of the Clover form)
Set `RECON=true` on the worker. Its logs print the page structure between `[aria:…]` markers and the screenshots are viewable in the web app at `/api/files/<id>`. Then set `RECON=false`.

## Changing the Clover login
Edit `CLOVER_EMAIL` / `CLOVER_PASSWORD` in Railway and redeploy. The worker notices the email changed, deletes the saved Clover session, and logs in fresh. Nothing else to change.

## Safety switches
- `DRY_RUN=true` (default): fills everything and screenshots, never clicks Send.
- Before sending, the worker compares Clover's total to our computed total and stops on any mismatch over $0.01.
- Photos and screenshots are stored in Postgres and only served to someone signed in with the PIN.

## Local dev
```
pnpm install
pnpm test        # pricing + login-swap tests
pnpm typecheck
pnpm build:web
```
