import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureProfileForLogin } from "../src/session";

describe("ensureProfileForLogin (swappable login)", () => {
  it("keeps the profile for the same email and wipes it when the email changes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ce-"));
    expect(ensureProfileForLogin(dir, "Jon@Example.com")).toBe(false);
    fs.writeFileSync(path.join(dir, "clover-profile", "cookie"), "x");
    expect(ensureProfileForLogin(dir, "jon@example.com")).toBe(false); // same email, case-insensitive
    expect(fs.existsSync(path.join(dir, "clover-profile", "cookie"))).toBe(true);
    expect(ensureProfileForLogin(dir, "bot@example.com")).toBe(true); // changed
    expect(fs.existsSync(path.join(dir, "clover-profile", "cookie"))).toBe(false);
    expect(fs.readFileSync(path.join(dir, "last-login.txt"), "utf8")).toBe("bot@example.com");
  });
});
