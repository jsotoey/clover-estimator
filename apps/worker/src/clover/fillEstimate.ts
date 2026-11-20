import type { Page } from "playwright";

/**
 * Milestone 4. Intentionally not implemented until RECON output shows the real form.
 * Contract: fill every field, compare Clover's displayed total to computed.totalCents
 * (abort on > 1 cent difference), screenshot, and click Send only when DRY_RUN=false.
 */
export async function fillEstimate(_page: Page, _estimate: unknown, _computed: unknown, _opts: { dryRun: boolean }): Promise<{ cloverNumber?: string }> {
  throw new Error("fillEstimate is not built yet (milestone 4, waiting on RECON selectors)");
}
