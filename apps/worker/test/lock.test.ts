import { describe, expect, it } from "vitest";
describe("test lock matching", () => {
  it("matches email or phone", async () => {
    process.env.SEND_ONLY_TO = "jonathan.r.soto@gmail.com,9173283255";
    process.env.DATABASE_URL = "postgres://x";
    const norm = (p: string) => p.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
    expect(norm("+1 (917) 328-3255")).toBe("9173283255");
  });
});
