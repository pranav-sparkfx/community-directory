import { describe, expect, test } from "vitest";
import { boundedEditDistance, normalize, rankByMatch, scoreMatch } from "./search";

const ADDRESSES = [
  "2600 Flintgrove Loop",
  "2602 Flintgrove Loop",
  "1204 Willow Run",
  "1206 Willow Run",
  "88 Bellhaven Court",
];

const rank = (query: string) => rankByMatch(ADDRESSES, query, (a) => [a]);

describe("normalize", () => {
  test("lowercases, strips punctuation and collapses whitespace", () => {
    expect(normalize("  1204   Willow-Run,  ")).toBe("1204 willow run");
  });
});

describe("boundedEditDistance", () => {
  test("returns 0 for identical strings", () => {
    expect(boundedEditDistance("willow", "willow", 2)).toBe(0);
  });

  test("counts a single substitution", () => {
    expect(boundedEditDistance("willow", "willov", 2)).toBe(1);
  });

  test("bails out past the bound instead of computing the true distance", () => {
    expect(boundedEditDistance("willow", "bellhaven", 2)).toBeGreaterThan(2);
  });
});

describe("scoreMatch", () => {
  test("returns 0 for an empty query", () => {
    expect(scoreMatch("   ", ["1204 Willow Run"])).toBe(0);
  });

  test("vetoes the record when any query token matches nothing", () => {
    expect(scoreMatch("willow flintgrove", ["1204 Willow Run"])).toBe(0);
  });

  test("ranks a whole-field prefix above a mid-word substring", () => {
    const prefix = scoreMatch("1204", ["1204 Willow Run"]);
    const substring = scoreMatch("ill", ["1204 Willow Run"]);
    expect(prefix).toBeGreaterThan(substring);
  });

  test("searches every field it is given", () => {
    expect(scoreMatch("plumbing", ["1204 Willow Run", "Plumbing"])).toBeGreaterThan(0);
  });
});

describe("rankByMatch", () => {
  test("returns every item unchanged for a blank query", () => {
    expect(rank("  ")).toEqual(ADDRESSES);
  });

  test("matches tokens out of order", () => {
    expect(rank("willow 1204")).toEqual(["1204 Willow Run"]);
  });

  test("tolerates a typo in a long token", () => {
    expect(rank("flintgrve")).toEqual(["2600 Flintgrove Loop", "2602 Flintgrove Loop"]);
  });

  test("does not match an unrelated street on a typo budget", () => {
    expect(rank("bellhaven")).toEqual(["88 Bellhaven Court"]);
  });

  test("puts the exact house number first, not merely the street", () => {
    expect(rank("1206 willow run")[0]).toBe("1206 Willow Run");
  });

  test("keeps database order for equally good matches", () => {
    expect(rank("willow")).toEqual(["1204 Willow Run", "1206 Willow Run"]);
  });

  test("returns nothing when the query matches nothing", () => {
    expect(rank("zzzznotastreet")).toEqual([]);
  });
});
