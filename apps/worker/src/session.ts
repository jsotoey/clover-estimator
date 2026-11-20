import fs from "node:fs";
import path from "node:path";

/**
 * The Clover login is swappable: it comes only from CLOVER_EMAIL / CLOVER_PASSWORD.
 * If the email changed since the last run, wipe the saved browser profile so the
 * old session can never be reused, and record the new email.
 * Returns true when the profile was reset.
 */
export function ensureProfileForLogin(dataDir: string, email: string): boolean {
  const profileDir = path.join(dataDir, "clover-profile");
  const marker = path.join(dataDir, "last-login.txt");
  fs.mkdirSync(dataDir, { recursive: true });
  const previous = fs.existsSync(marker) ? fs.readFileSync(marker, "utf8").trim() : null;
  const normalized = email.trim().toLowerCase();
  let reset = false;
  if (previous !== null && previous !== normalized) {
    fs.rmSync(profileDir, { recursive: true, force: true });
    fs.rmSync(path.join(dataDir, "clover-cookies.json"), { force: true });
    reset = true;
  }
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(marker, normalized);
  return reset;
}

export function profileDir(dataDir: string): string {
  return path.join(dataDir, "clover-profile");
}
