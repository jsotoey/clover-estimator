import { checkBookingRequest, customerConfirmation, isOpen, openSlots, shopNotice, zonedClock, zonedDate, type BookingRequest } from "@ce/core";
import { sendEmail } from "@/lib/mail";
import { db } from "@/lib/db";
import { bookingStore, busyTimes } from "@/lib/booking";

/**
 * Public booking API (no sign-in: customers use it from the store's website).
 *   GET   the store's name, project types and open times for the next two weeks
 *   POST  book a visit (multipart form: the fields of BookingRequest + up to 3 photos)
 * Guards: slot re-checked inside a per-store lock, one booking per start time (unique index),
 * 3 bookings per hour per IP, a hidden "company" field that only bots fill in, photo size/type limits.
 */
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const store = await bookingStore((await ctx.params).slug);
  if (!store) return Response.json({ error: "Online booking isn't available for this business." }, { status: 404 });
  const s = store.settings;
  return Response.json({
    name: store.name, service: s.service, phone: s.phone, minutes: s.minutes, projectTypes: s.projectTypes,
    days: openSlots(s, Date.now(), await busyTimes(store.id)),
  }, { headers: { "cache-control": "no-store" } });
}

const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const store = await bookingStore((await ctx.params).slug);
  if (!store) return Response.json({ error: "Online booking isn't available for this business." }, { status: 404 });
  const form = await req.formData().catch(() => null);
  if (!form) return Response.json({ error: "Something went wrong sending the form. Try again." }, { status: 400 });

  const str = (k: string) => String(form.get(k) ?? "").trim();
  const b: BookingRequest = {
    firstName: str("firstName"), lastName: str("lastName"), email: str("email").toLowerCase(), phone: str("phone"),
    street: str("street"), unit: str("unit") || undefined, city: str("city"), zip: str("zip"),
    projectType: str("projectType"), details: str("details"), start: str("start"),
  };
  const problems = checkBookingRequest(b);
  if (!store.settings.projectTypes.includes(b.projectType)) problems.push("Pick what the project is.");
  if (problems.length) return Response.json({ error: problems[0], problems }, { status: 400 });

  const photos = form.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0).slice(0, MAX_PHOTOS);
  for (const f of photos) {
    if (!["image/jpeg", "image/png"].includes(f.type)) return Response.json({ error: "Photos need to be JPG or PNG." }, { status: 400 });
    if (f.size > MAX_PHOTO_BYTES) return Response.json({ error: "One of the photos is too big (6 MB max)." }, { status: 400 });
  }

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  const confirmation = {
    date: zonedDate(Date.parse(b.start), store.settings.timeZone),
    time: zonedClock(Date.parse(b.start), store.settings.timeZone),
    minutes: store.settings.minutes,
  };
  // Bots fill in every field, including the hidden one. Pretend it worked.
  if (str("company")) return Response.json({ ok: true, ...confirmation });
  if (ip) {
    const { rows } = await db().query<{ n: string }>(
      `SELECT count(*) AS n FROM bookings WHERE ip = $1 AND created_at > now() - interval '1 hour'`, [ip]);
    if (Number(rows[0].n) >= 3) return Response.json({ error: "Too many bookings from this connection. Please call us instead." }, { status: 429 });
  }

  const client = await db().connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(91000000 + $1)`, [store.id]);
    if (!isOpen(store.settings, Date.now(), await busyTimes(store.id, client), new Date(b.start).toISOString())) {
      await client.query("ROLLBACK");
      return Response.json({ error: "Sorry, that time was just taken. Please pick another." }, { status: 409 });
    }
    const ins = await client.query<{ id: string }>(
      `INSERT INTO bookings (merchant_id, starts_at, minutes, buffer_minutes, first_name, last_name, email, phone,
                             street, unit, city, zip, project_type, details, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [store.id, b.start, store.settings.minutes, store.settings.bufferMinutes, b.firstName, b.lastName, b.email, b.phone,
       b.street, b.unit ?? null, b.city, b.zip, b.projectType, b.details, ip]);
    const id = ins.rows[0].id;
    for (const f of photos)
      await client.query(
        `INSERT INTO files (booking_id, kind, name, content_type, data) VALUES ($1, 'photo', $2, $3, $4)`,
        [id, f.name.replace(/[^\w.-]/g, "_").slice(0, 80) || "photo.jpg", f.type, Buffer.from(await f.arrayBuffer())]);
    await client.query("COMMIT");
    // Confirmation now (the Clover calendar entry follows from the worker). Failures don't undo the booking.
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    const origin = host ? `https://${host}` : new URL(req.url).origin;
    const results = await Promise.all([
      sendEmail(customerConfirmation({ id, storeName: store.name, s: store.settings, b })),
      ...[shopNotice({ storeName: store.name, s: store.settings, b, photos: photos.length, appUrl: `${origin}/visits` })]
        .filter((e) => e !== null).map((e) => sendEmail(e!)),
    ]);
    await db().query(`INSERT INTO events (type, detail) VALUES ('booking_emails', $1)`,
      [JSON.stringify({ booking: id, customer: results[0], shop: results[1] ?? null })]).catch(() => {});
    return Response.json({ ok: true, id, emailed: results[0].sent, ...confirmation });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    if ((e as { code?: string }).code === "23505")
      return Response.json({ error: "Sorry, that time was just taken. Please pick another." }, { status: 409 });
    console.error("booking failed", e);
    return Response.json({ error: "Something went wrong saving your booking. Please try again or call us." }, { status: 500 });
  } finally {
    client.release();
  }
}
