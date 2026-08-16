import { describe, expect, test } from "vitest";
import { householdTitle, initials, shortDate } from "./utils";

describe("initials", () => {
  test("takes first and last initial from a full name", () => {
    expect(initials("Murali Varadarajan")).toBe("MV");
  });

  test("returns a single letter for a one-word name", () => {
    expect(initials("Pepper")).toBe("P");
  });

  test("skips middle names rather than producing three letters", () => {
    expect(initials("Ana Sofia Moreno")).toBe("AM");
  });

  test("tolerates extra whitespace", () => {
    expect(initials("  Dana   Okafor  ")).toBe("DO");
  });

  test("returns a placeholder for an empty name rather than throwing", () => {
    expect(initials("")).toBe("?");
    expect(initials("   ")).toBe("?");
  });
});

describe("householdTitle", () => {
  test("names a single resident plainly", () => {
    expect(householdTitle(["Dana Okafor"])).toBe("Dana Okafor");
  });

  test("joins two residents with an ampersand, as the mockups do", () => {
    expect(householdTitle(["Murali Varadarajan", "Jaya Swamy"])).toBe(
      "Murali Varadarajan & Jaya Swamy",
    );
  });

  test("summarises three or more rather than listing every name", () => {
    expect(householdTitle(["Ana Moreno", "Peter Lindqvist", "Lila Ashworth"])).toBe(
      "Ana Moreno and 2 others",
    );
  });

  test("falls back to a neutral label when every resident is unlisted", () => {
    // household_card() returns an empty member list when the household has
    // opted out of the directory. The row must still render an address.
    expect(householdTitle([])).toBe("Residence");
  });
});

describe("shortDate", () => {
  test("formats a date-only string in LOCAL time, not UTC", () => {
    // Regression: `new Date("2026-03-14")` is UTC midnight, which is the
    // evening of the 13th anywhere west of Greenwich — so a notice dated the
    // 14th displayed as "Mar 13" for every US resident.
    expect(shortDate("2026-03-14")).toBe("Mar 14");
  });

  test("handles a date-only string at a month boundary", () => {
    expect(shortDate("2026-01-01")).toBe("Jan 1");
    expect(shortDate("2026-12-31")).toBe("Dec 31");
  });

  test("accepts a Date instance unchanged", () => {
    expect(shortDate(new Date(2026, 2, 14))).toBe("Mar 14");
  });

  test("passes a zoned timestamp through to the local rendering", () => {
    // publish_at arrives from Postgres as a timestamptz in ISO form; it
    // already carries a zone, so it must not be re-interpreted.
    const iso = new Date(2026, 2, 14, 12, 0, 0).toISOString();
    expect(shortDate(iso)).toBe("Mar 14");
  });
});
