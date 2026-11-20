# Project rules for Claude Code
- Read KICKOFF.md and prompts/estimate-assistant.md before changing anything.
- All customer-facing numbers come from packages/core/pricing.ts. The AI never calculates or invents prices.
- Never commit secrets. Credentials come only from env vars.
- Clover selectors: prefer getByRole/getByLabel; update them from RECON output, never guess silently.
- Keep DRY_RUN defaulting to true.
- Run `pnpm test && pnpm typecheck` before every commit.
