# Backlog

Things to build next, in rough priority order. Newest notes at the bottom of each item.

## Payments and follow-up
- [ ] **Paid status on invoices.** Show "Paid ✓" (with date) on the deposit and balance cards once the customer pays in Clover. The worker can read status from Clover's Invoices list on the same check it already does for accepted estimates.
- [ ] **Reminders to resend.** If a deposit invoice is still unpaid after N days (or close to the start date), remind the merchant in the app with a one-tap "Resend" and a ready message like "Quick reminder: we can't lock in your start date until the deposit is in." Same idea for estimates not yet accepted.
- [ ] **Paid in person** end-to-end test (button exists, not yet tried on a real estimate).

## Customer contact
- [ ] **Text delivery for estimates.** Clover only texts customers with text consent on their profile. New customers created by the app get consent ticked when sending by text; existing customers (e.g. Jon Soto) need it ticked in Clover. Consider having the worker tick it when editing an existing customer, with the merchant's say-so.
- [ ] **Text the invoice link.** Clover invoices are email-only; the app shows "Text the payment link" only when Clover hands back a share link. Confirm whether Clover gives one, otherwise find it in the sent invoice.

## Input
- [ ] **Voice.** The greeting says "talk or type," but voice isn't working on the phone. Add a microphone button in the app (speech-to-text in the browser), so it doesn't depend on the keyboard's dictation key.

## App layout
- [x] **Static top menu.** Header stays the same on every screen (Estimates title; Recent, Clover, + New), the Recent list opens under it instead of replacing it. (Nov 20)

## Platform
- [ ] **Multi-merchant:** one assistant employee login per merchant on the Mac mini, merchant tag on estimates, per-merchant PIN and standard terms, sign-in due dates on the Clover page.
- [ ] **Auto-delete our copy** of an estimate's details once it's in Clover and the job is closed (Clover is the record).
- [ ] **Mac mini** (always on) to replace the laptop as the worker; Chrome Remote Desktop for sign-ins from the road.
- [ ] **Least-privilege role** for the assistant employee (try Manager instead of Admin).
- [ ] **Deposit auto-send** setting per merchant (DEPOSIT_AUTO_SEND exists globally today).
