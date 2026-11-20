import { cookies } from "next/headers";
import { AUTH_COOKIE, authToken, pinMatches } from "@/lib/auth";

export async function POST(req: Request) {
  const { pin } = (await req.json().catch(() => ({}))) as { pin?: string };
  if (!pin || !pinMatches(String(pin))) return Response.json({ error: "Wrong PIN" }, { status: 401 });
  (await cookies()).set(AUTH_COOKIE, authToken(), { httpOnly: true, secure: process.env.NODE_ENV === "production" && !process.env.LOCAL_HTTP, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 90 });
  return Response.json({ ok: true });
}
