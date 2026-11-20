import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "./env";

export const AUTH_COOKIE = "ce_auth";

/** Cookie value is a hash of the PIN, so changing MERCHANT_PIN logs everyone out. */
export function authToken(): string {
  return createHash("sha256").update(`ce:${env.pin()}`).digest("hex");
}

export function pinMatches(pin: string): boolean {
  const a = Buffer.from(createHash("sha256").update(pin).digest("hex"));
  const b = Buffer.from(createHash("sha256").update(env.pin()).digest("hex"));
  return timingSafeEqual(a, b);
}

export async function isAuthed(): Promise<boolean> {
  const c = (await cookies()).get(AUTH_COOKIE)?.value;
  return !!c && c === authToken();
}

export function unauthorized() {
  return Response.json({ error: "Not signed in" }, { status: 401 });
}
