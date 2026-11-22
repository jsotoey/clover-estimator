import { db } from "@/lib/db";
import { getSession, unauthorized } from "@/lib/session";

type Settings = {
  cloverName: string; depositPercent: number; depositNote: string; leadDays: number; bufferDays: number; bookInstalls: boolean; installService: string; installTime: string;
  suppliers: { name: string; leadDays: number }[]; crews: { name: string; skills: string[] }[];
};

async function load(id: number): Promise<Settings | null> {
  const m = (await db().query(
    `SELECT clover_name, name, deposit_percent, deposit_note, lead_days, buffer_days, book_installs, install_service, install_time FROM merchants WHERE id = $1`, [id]
  )).rows[0];
  if (!m) return null;
  const suppliers = (await db().query(`SELECT name, lead_days FROM suppliers WHERE merchant_id = $1 AND active ORDER BY name`, [id])).rows;
  const crews = (await db().query(`SELECT name, skills FROM crews WHERE merchant_id = $1 AND active ORDER BY id`, [id])).rows;
  return {
    cloverName: m.clover_name || m.name, depositPercent: m.deposit_percent, depositNote: m.deposit_note ?? "",
    leadDays: m.lead_days, bufferDays: m.buffer_days, bookInstalls: m.book_installs,
    installService: m.install_service, installTime: m.install_time,
    suppliers: suppliers.map((s) => ({ name: s.name, leadDays: s.lead_days })),
    crews: crews.map((c) => ({ name: c.name, skills: c.skills })),
  };
}

/** Admin only: a store's install workflow settings. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s || s.role !== "admin") return unauthorized();
  const st = await load(Number((await ctx.params).id));
  return st ? Response.json(st) : Response.json({ error: "Store not found" }, { status: 404 });
}

const int = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s || s.role !== "admin") return unauthorized();
  const id = Number((await ctx.params).id);
  const b = (await req.json().catch(() => ({}))) as Partial<Settings>;
  const note = String(b.depositNote ?? "").trim();
  if (note.length > 120) return Response.json({ error: "Keep the deposit message under 120 characters (Clover notes are short)." }, { status: 400 });
  const service = String(b.installService ?? "").trim().slice(0, 60) || "Installation";
  const time = String(b.installTime ?? "").trim().toUpperCase().replace(/^(\d{1,2})(:\d{2})?\s*(AM|PM)$/, (_m, h, mm, ap) => `${Number(h)}${mm ?? ":00"} ${ap}`);
  if (!/^(1[0-2]|[1-9]):[0-5]\d (AM|PM)$/.test(time)) return Response.json({ error: "Install time looks wrong (like 9:00 AM)" }, { status: 400 });
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const upd = await client.query(
      `UPDATE merchants SET clover_name = $2, deposit_percent = $3, deposit_note = $4, lead_days = $5, buffer_days = $6, book_installs = $7,
         install_service = $8, install_time = $9
       WHERE id = $1 AND active`,
      [id, String(b.cloverName ?? "").trim() || null, int(b.depositPercent, 0, 100, 50), note || null,
       int(b.leadDays, 0, 120, 0), int(b.bufferDays, 0, 30, 2), !!b.bookInstalls, service, time]
    );
    if (!upd.rowCount) { await client.query("ROLLBACK"); return Response.json({ error: "Store not found" }, { status: 404 }); }
    // Lists: keep the ones sent (by name), turn off the rest (installs keep pointing at old rows).
    const sup = (b.suppliers ?? []).map((x) => ({ name: String(x.name ?? "").trim().slice(0, 60), lead: int(x.leadDays, 0, 120, 0) })).filter((x) => x.name);
    await client.query(`UPDATE suppliers SET active = false WHERE merchant_id = $1`, [id]);
    for (const x of sup) await client.query(
      `INSERT INTO suppliers (merchant_id, name, lead_days) VALUES ($1,$2,$3)
       ON CONFLICT (merchant_id, name) DO UPDATE SET lead_days = EXCLUDED.lead_days, active = true`, [id, x.name, x.lead]);
    const crews = (b.crews ?? []).map((x) => ({
      name: String(x.name ?? "").trim().slice(0, 60),
      skills: (Array.isArray(x.skills) ? x.skills : []).map((k) => String(k).trim().toLowerCase().slice(0, 30)).filter(Boolean).slice(0, 20),
    })).filter((x) => x.name);
    const badCrew = crews.find((x) => !/^[A-Za-z][A-Za-z ]{2,}$/.test(x.name));
    if (badCrew) {
      await client.query("ROLLBACK");
      return Response.json({ error: `Clover only accepts crew names with letters and spaces (at least 3 letters, no numbers): "${badCrew.name}". Try "Team One".` }, { status: 400 });
    }
    await client.query(`UPDATE crews SET active = false WHERE merchant_id = $1`, [id]);
    for (const x of crews) await client.query(
      `INSERT INTO crews (merchant_id, name, skills) VALUES ($1,$2,$3)
       ON CONFLICT (merchant_id, name) DO UPDATE SET skills = EXCLUDED.skills, active = true`, [id, x.name, x.skills]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  return Response.json(await load(id));
}
