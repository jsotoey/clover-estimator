import { bookingSettings, visitNote, zonedClock, zonedDate } from "@ce/core";
import { config } from "./config";
import { db, logEvent } from "./db";
import { newPage, useStore } from "./browser";
import { signedIn, storeById } from "./stores";
import { checkSession, assertRightStore } from "./clover/session";
import { requestLogin } from "./liveLogin";
import { bookAppointment } from "./clover/appointments";
import { FillError } from "./clover/fillEstimate";

/** Best guess of the state from a ZIP (the booking page only asks for town + ZIP). */
export function stateForZip(zip: string): string {
  const n = Number(zip.slice(0, 3));
  if (n >= 70 && n <= 89) return "NJ";
  if (n >= 100 && n <= 149) return "NY";
  if (n >= 60 && n <= 69) return "CT";
  if (n >= 150 && n <= 196) return "PA";
  return "NJ";
}

/**
 * Put one online booking on the store's Clover calendar: the visit service, with the store's visit
 * employee (e.g. "Estimator"), at the time the customer picked, address and job in the notes.
 */
export async function processBooking(allowedToSend: (raw: unknown) => boolean): Promise<boolean> {
  const { rows } = await db().query<{
    id: string; merchant_id: number; starts_at: Date; booking: unknown; first_name: string; last_name: string;
    email: string; phone: string; street: string; unit: string | null; city: string; zip: string;
    project_type: string; details: string; photos: string;
  }>(
    `UPDATE bookings b SET status = 'booking', updated_at = now()
     FROM merchants m
     WHERE m.id = b.merchant_id
       AND b.id = (SELECT id FROM bookings WHERE status = 'to_book' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
     RETURNING b.*, m.booking, (SELECT count(*) FROM files f WHERE f.booking_id = b.id) AS photos`
  );
  const job = rows[0];
  if (!job) return false;
  const fail = (msg: string) => db().query(`UPDATE bookings SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`, [job.id, msg]);
  const store = await storeById(job.merchant_id);
  if (!store) { await fail("Store not found"); return true; }
  if (signedIn.get(store.id) === false) {
    // Waiting for someone to sign this store in to Clover; don't keep loading Clover's login page,
    // but make sure the app is asking for that sign-in (requestLogin reuses an open request).
    await db().query(`UPDATE bookings SET status = 'to_book', error = 'Waiting for someone to sign in to Clover in the app' WHERE id = $1`, [job.id]);
    await requestLogin("booking", store.id);
    return false;
  }
  const s = bookingSettings(job.booking);

  const start = new Date(job.starts_at).getTime();
  const req = {
    firstName: job.first_name, lastName: job.last_name, email: job.email, phone: job.phone,
    street: job.street, unit: job.unit ?? undefined, city: job.city, zip: job.zip,
    projectType: job.project_type, details: job.details, start: new Date(start).toISOString(),
  };
  const customer = {
    name: `${job.first_name} ${job.last_name}`.trim(),
    email: job.email,
    phone: job.phone,
    job_address: `${job.street}${job.unit ? ` ${job.unit}` : ""}, ${job.city}, ${stateForZip(job.zip)} ${job.zip}`,
  };

  await useStore(store);
  const page = await newPage();
  // Clover can email the customer about the appointment, so the test lock applies.
  const locked = !config.dryRun && !allowedToSend({ customer });
  try {
    if (!(await checkSession(page))) {
      await db().query(`UPDATE bookings SET status = 'to_book', updated_at = now() WHERE id = $1`, [job.id]);
      signedIn.set(store.id, false);
      await requestLogin("booking", store.id);
      return true;
    }
    await assertRightStore(page);
    const res = await bookAppointment(page, { customer }, {
      date: zonedDate(start, s.timeZone), time: zonedClock(start, s.timeZone),
      service: s.service, employee: s.employee, note: visitNote(req, Number(job.photos)),
    }, {
      dryRun: config.dryRun || locked,
      onStep: async (step) => { await logEvent(null, "booking_step", { booking: job.id, step }); },
    });
    await db().query(`UPDATE bookings SET status = $2, error = $3, updated_at = now() WHERE id = $1`, [
      job.id, res.booked ? "booked" : "test_run",
      res.booked ? null : locked ? "Test run only (test lock is on): not put on the Clover calendar" : "Test run only: not put on the Clover calendar",
    ]);
    await logEvent(null, res.booked ? "visit_booked" : "visit_test_run", { booking: job.id, store: store.slug });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logEvent(null, "visit_failed", { booking: job.id, error: msg });
    await fail(e instanceof FillError ? msg : "Something went wrong putting the visit on the Clover calendar. Nothing was booked there yet.");
  } finally {
    await page.close().catch(() => {});
  }
  return true;
}
