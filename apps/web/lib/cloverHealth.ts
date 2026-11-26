/** One reading of /api/clover-login for the green/red pill and the Today banner, so every screen agrees. */
export type CloverHealth = { state: "on" | "off" | "unknown"; problem: string | null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function cloverHealth(j: any): CloverHealth {
  const st = j?.store, bot = j?.bot;
  if (!st || st.paused) return { state: "unknown", problem: null };
  const problem =
    bot && !bot.online ? (bot.known ? "The bot computer is off. Nothing goes into Clover until it's back on." : null)
    : j.waitingEstimates > 0 ? `The bot needs a Clover sign-in. ${j.waitingEstimates} estimate${j.waitingEstimates > 1 ? "s are" : " is"} waiting.`
    : st.signedIn === false ? "The bot got signed out of Clover. Sign it back in."
    : st.storeOk === false ? "The bot's Clover login opens a different store. Sign it in with this store's bot login."
    : null;
  return { state: problem ? "off" : bot?.online ? "on" : "unknown", problem };
}
