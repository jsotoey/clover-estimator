import { db } from "@/lib/db";
import { isAuthed, unauthorized } from "@/lib/auth";

/** Start a new estimate conversation. */
export async function POST() {
  if (!(await isAuthed())) return unauthorized();
  const { rows } = await db().query<{ id: string }>(`INSERT INTO estimates (status) VALUES ('drafting') RETURNING id`);
  return Response.json({ id: rows[0].id });
}
