function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}
const bool = (v: string | undefined, d: boolean) => (v === undefined ? d : /^(1|true|yes)$/i.test(v));

export const config = {
  databaseUrl: () => req("DATABASE_URL"),
  cloverEmail: () => req("CLOVER_EMAIL"),
  cloverPassword: () => req("CLOVER_PASSWORD"),
  cloverLoginUrl: process.env.CLOVER_LOGIN_URL ?? "https://www.clover.com/login",
  dataDir: process.env.DATA_DIR ?? "/data",
  dryRun: bool(process.env.DRY_RUN, true), // default SAFE: never clicks Send
  recon: bool(process.env.RECON, false),
  pollMs: Number(process.env.POLL_INTERVAL_MS ?? 5000),
  blobToken: process.env.BLOB_READ_WRITE_TOKEN,
  codeWaitMs: 10 * 60 * 1000,
};
