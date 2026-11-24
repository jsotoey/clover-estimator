import { describe, expect, it } from "vitest";
import { addDays, earliestInstall, matchingSkills, nextWeekday, pickCrew, weekOf } from "../src/installs";

describe("install dates", () => {
  it("adds lead time and buffer, then skips the weekend", () => {
    // Paid Sun Nov 22 2026 + 21 days lead + 2 buffer = Tue Dec 15
    expect(earliestInstall("2026-11-22", 21, 2)).toBe("2026-12-15");
    // lands on Saturday Dec 12 -> Monday Dec 14
    expect(earliestInstall("2026-11-22", 18, 2)).toBe("2026-12-14");
  });
  it("helpers", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(nextWeekday("2026-11-28")).toBe("2026-11-30");
    expect(weekOf("2026-12-17")).toBe("2026-12-14");
    expect(weekOf("2026-12-20")).toBe("2026-12-14"); // Sunday belongs to the week starting Monday
  });
});

describe("crew pick", () => {
  const crews = [
    { id: 1, name: "Team 1", skills: ["shower", "railing"] },
    { id: 2, name: "Team 2", skills: ["mirror", "window"] },
  ];
  it("matches skills to the job text", () => {
    expect(matchingSkills(["shower", "mirror"], "Frameless Shower Enclosure, 3/8 clear")).toEqual(["shower"]);
    expect(matchingSkills(["window"], "Replace 2 windows")).toEqual(["window"]);
    expect(pickCrew(crews, "Custom vanity mirror 48x36", new Map())?.name).toBe("Team 2");
  });
  it("falls back to the least busy crew when no skill matches", () => {
    expect(pickCrew(crews, "Tempered table top", new Map([[1, 3], [2, 1]]))?.name).toBe("Team 2");
  });
  it("among skilled crews, picks the least busy", () => {
    const three = [...crews, { id: 3, name: "Team 3", skills: ["shower"] }];
    expect(pickCrew(three, "shower door", new Map([[1, 2], [3, 0]]))?.name).toBe("Team 3");
  });
  it("no crews -> null", () => expect(pickCrew([], "x", new Map())).toBeNull());
});

import { installDate } from "../src/installs";
describe("installDate", () => {
  it("keeps the agreed start date when materials can be in by then", () => {
    expect(installDate("2026-12-21", "2026-12-16")).toEqual({ date: "2026-12-21", moved: false });
  });
  it("moves to the earliest date when the agreed date is too soon", () => {
    expect(installDate("2026-11-25", "2026-12-16")).toEqual({ date: "2026-12-16", moved: true });
  });
  it("a weekend start date moves to Monday", () => {
    expect(installDate("2026-12-19", "2026-12-16")).toEqual({ date: "2026-12-21", moved: false });
  });
  it("no start date: earliest", () => {
    expect(installDate(undefined, "2026-12-16")).toEqual({ date: "2026-12-16", moved: false });
  });
});
