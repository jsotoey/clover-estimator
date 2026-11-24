import { cookies } from "next/headers";
import { SESSION_COOKIE, cookieOptions, getMerchant, getSession, sessionCookieValue, unauthorized } from "@/lib/session";

/** Admin only: work in another store. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s || s.role !== "admin") return unauthorized();
  const { id } = (await req.json().catch(() => ({}))) as { id?: number };
  const m = typeof id === "number" ? await getMerchant(id) : null;
  if (!m) return Response.json({ error: "Store not found" }, { status: 404 });
  (await cookies()).set(SESSION_COOKIE, sessionCookieValue("admin", m.id), cookieOptions);
  return Response.json({ ok: true });
}
