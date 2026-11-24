# Weekly client snapshot (prototype)

Once a week, for each store in `merchants.json`:
1. Pull the last 5 weeks of paid orders from Clover (read-only token per store), or sample data.
2. Do all the math in code (`src/metrics.ts`): sales, orders, average order, top sellers,
   items climbing or dipping vs their usual week, best day, busiest hour, tips, refunds.
3. The AI writes a short, friendly email from Jon using **only** those numbers. Every number in its
   draft is checked against the facts; if one doesn't match (or it uses an em dash) the draft is thrown
   out and a plain template is used instead.
4. Saves drafts to `out/<date>/` (HTML email, plain text, and the facts used). **Nothing is sent.**

Run:
```
pnpm --filter insights weekly                    # sample store if there's no merchants.json
NOW=2026-11-23 pnpm --filter insights weekly     # pretend it's a given Monday
```
Real stores: copy `merchants.example.json` to `merchants.json` (git-ignored) and put each store's
token in the env var it names. `ANTHROPIC_API_KEY` turns on the AI writer.

Not done yet: tested against a live Clover account, sending (Gmail drafts or an email service),
the weekly schedule, comparing to the same week last year.
