# Backlog

Things to build next, in rough priority order. Newest notes at the bottom of each item.

## Payments and follow-up
- [ ] **Paid status on invoices.** Show "Paid ✓" (with date) on the deposit and balance cards once the customer pays in Clover. The worker can read status from Clover's Invoices list on the same check it already does for accepted estimates.
- [ ] **Reminders to resend.** If a deposit invoice is still unpaid after N days (or close to the start date), remind the merchant in the app with a one-tap "Resend" and a ready message like "Quick reminder: we can't lock in your start date until the deposit is in." Same idea for estimates not yet accepted.
- [ ] **Paid in person** end-to-end test (button exists, not yet tried on a real estimate).

## Labor-only estimates with materials TBD (Jon, Nov 21)
Some contractors want to send the estimate with **labor priced** and **materials as "TBD"** because the materials are special order, and finding out the real cost can take up to 2 weeks. Two versions of this:
- **Customer buys the materials.** The estimate is labor only, with a line saying materials are on the customer, so the customer knows the job price before shopping around. Nothing more to add later.
- **Contractor buys the materials, price comes later.** The estimate goes out with a "Materials: TBD" line. Once the cost is known, the contractor **updates the original estimate** (not an invoice) to add it and resends it to the customer for approval.

To build:
- [ ] Let the assistant take "labor only" and "materials TBD" (a line with no price yet, clearly marked TBD, not counted in the total or tax).
- [ ] An "Update the estimate" flow: add the materials price later, then edit and resend the **same** Clover estimate (Edit estimate exists in Clover's estimate dialog; map it with the look-only scout first). Customer re-accepts.
- [ ] Show these estimates as "Waiting on materials price" in the Estimates list, with a reminder if the TBD sits too long.

Open questions (workflow, decide with the merchants):
- [ ] Does the contractor take a deposit **before** the materials cost is known, to hold the schedule? If yes, is it a % of labor only, or a flat amount?
- [ ] When the materials price comes in, is there a second deposit for materials (often paid up front for special orders), or does it all go on the balance?
- [ ] What happens to the start date while waiting up to 2 weeks for the materials price: book it tentatively, or only after the update is accepted?
- [ ] Does Clover keep the customer's original acceptance after an edit, or does the edited estimate need a fresh accept? (check in Clover)

## Scheduling and booking deposits (Jon, Nov 21)
The app has to fit most field services, not just painters. Scheduling raises its own workflow:
- **Mechanic case:** a customer books a drop-off slot on the website and **pays a deposit just to get on the calendar**, before any estimate exists. The estimate comes after the inspection, and the booking deposit should count toward the job.
- **Painter/contractor case:** estimate first, deposit on acceptance, then the job gets scheduled (sometimes after waiting on materials, see above).

What Clover offers (researched Nov 21, to confirm inside a real account):
- Clover's own appointments (services catalog, merchant and online customer booking, email reminders) come with the **Services Growth** plan, not the lower plans. M&J already has Estimates, which is a Services Growth feature, so they likely have appointments too: check with the look-only scout.
- Not confirmed: whether Clover's own online booking can take a **deposit**.
- App Market options that say they take deposits at booking: **Book Online by Zoomifi** (works on any Clover plan, about $4.99/mo), **Cojilio**. BookedBy is salon/spa-focused.

Plan:
- [ ] Don't build our own scheduler. Use Clover's appointments (or a booking app) and have our app read the calendar.
- [ ] Scout M&J's Clover (look only) for Appointments / online booking, and whether a booking can require a deposit.
- [ ] Map the shared workflow with its variants: Book (+ deposit?) → Estimate → Approve → Deposit → Schedule → Work → Balance. Booking-first (mechanic), estimate-first (contractor), materials TBD.
- [ ] Credit a booking deposit on the later estimate/invoices so the customer isn't charged twice.
- [ ] After a deposit is paid, offer to put the job on the Clover calendar (start date from the estimate).

## Customer contact
- [ ] **Text delivery for estimates.** Clover only texts customers with text consent on their profile. New customers created by the app get consent ticked when sending by text; existing customers (e.g. Jon Soto) need it ticked in Clover. Consider having the worker tick it when editing an existing customer, with the merchant's say-so.
- [ ] **Text the invoice link.** Clover invoices are email-only; the app shows "Text the payment link" only when Clover hands back a share link. Confirm whether Clover gives one, otherwise find it in the sent invoice.

## Input
- [x] **Voice.** Mic button built (Nov 21 redesign): tap to talk, tap to stop, words land in the box to fix before sending. Needs a real-phone test; falls back to the keyboard mic if the browser blocks it.

## App layout
- [x] **Static top menu.** Header stays the same on every screen (Estimates title; Recent, Clover, + New), the Recent list opens under it instead of replacing it. (Nov 20)

## Platform
- [x] **Multi-merchant (Nov 22):** stores table, per-store PIN + terms + tax, admin PIN with store switcher and Stores screen, one worker runs every store with its own saved Clover sign-in, store-name guard before filling. Still to do: sign-in due dates per store, per-store test lock.
- [ ] **Auto-delete our copy** of an estimate's details once it's in Clover and the job is closed (Clover is the record).
- [ ] **Mac mini** (always on) to replace the laptop as the worker; Chrome Remote Desktop for sign-ins from the road.
- [ ] **Least-privilege role** for the assistant employee (try Manager instead of Admin).
- [ ] **Deposit auto-send** setting per merchant (DEPOSIT_AUTO_SEND exists globally today).
