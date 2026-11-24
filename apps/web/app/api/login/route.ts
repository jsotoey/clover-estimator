import { cookies } from "next/headers";
import { SESSION_COOKIE, cookieOptions, sessionCookieValue, signInWithPin } from "@/lib/session";

export async function POST(req: Request) {
  const { pin } = (await req.json().catch(() => ({}))) as { pin?: string };
  const s = pin ? await signInWithPin(String(pin)) : null;
  if (!s) return Response.json({ error: "Wrong PIN" }, { status: 401 });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, sessionCookieValue(s.role, s.merchant.id), cookieOptions);
  jar.delete("ce_auth");
  return Response.json({ ok: true });
}
