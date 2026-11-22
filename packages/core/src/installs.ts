/**
 * Install planning rules (pure, tested). Dates are local calendar dates as YYYY-MM-DD.
 *  - earliest install = day the deposit was paid + supplier lead time + buffer, moved to the next weekday
 *  - crew = an active crew whose skills match the job, with the fewest installs that week (ties: list order)
 */
export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function nextWeekday(ymd: string): string {
  let d = ymd;
  for (;;) {
    const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) return d;
    d = addDays(d, 1);
  }
}

export function earliestInstall(paidOn: string, leadDays: number, bufferDays: number): string {
  return nextWeekday(addDays(paidOn, Math.max(0, leadDays) + Math.max(0, bufferDays)));
}

/** Monday of the week a date falls in. */
export function weekOf(ymd: string): string {
  const dow = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  return addDays(ymd, dow === 0 ? -6 : 1 - dow);
}

export interface CrewInfo { id: number; name: string; skills: string[] }

/** Skill tags that appear in the job's text (descriptions, notes). Case-insensitive, whole words, simple plurals. */
export function matchingSkills(skills: string[], jobText: string): string[] {
  const text = ` ${jobText.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  return skills.filter((s) => {
    const w = s.toLowerCase().trim().replace(/[^a-z0-9]+/g, " ");
    return w && (text.includes(` ${w} `) || text.includes(` ${w}s `) || text.includes(` ${w}es `));
  });
}

/**
 * Pick the crew: those with a skill the job mentions (if any crew matches), else every crew;
 * then the one with the fewest installs booked in that week.
 */
export function pickCrew(crews: CrewInfo[], jobText: string, installsThatWeek: Map<number, number>): CrewInfo | null {
  if (!crews.length) return null;
  const skilled = crews.filter((c) => matchingSkills(c.skills, jobText).length > 0);
  const pool = skilled.length ? skilled : crews;
  return pool.reduce((best, c) => ((installsThatWeek.get(c.id) ?? 0) < (installsThatWeek.get(best.id) ?? 0) ? c : best), pool[0]);
}
