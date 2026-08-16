import { describe, expect, test } from "vitest";
import {
  boundedEditDistance,
  normalize,
  rankByMatch,
  rankByNamePrefix,
  scoreMatch,
  scoreNamePrefix,
} from "./search";

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

const NAMES = [
  "Aaron Diaz",
  "Priya Aarav",
  "John Smith",
  "Ada Smithson",
  "Maya Diaz",
];

const people = (query: string) => rankByNamePrefix(NAMES, query, (n) => n);

describe("scoreNamePrefix", () => {
  test("returns 0 for an empty query", () => {
    expect(scoreNamePrefix("   ", "Aaron Diaz")).toBe(0);
  });

  test("ranks a first-name hit above a surname hit", () => {
    expect(scoreNamePrefix("aa", "Aaron Diaz")).toBeGreaterThan(
      scoreNamePrefix("aa", "Priya Aarav"),
    );
  });

  test("ranks a whole-word hit above a partial one at the same position", () => {
    expect(scoreNamePrefix("aaron", "Aaron Diaz")).toBeGreaterThan(
      scoreNamePrefix("aar", "Aaron Diaz"),
    );
  });

  test("does not match a word the query only appears inside", () => {
    // "saac" sits inside "Isaac", but nobody types the middle of a name
    // expecting to find it, and allowing it turns a two-letter query into a
    // wall of coincidences.
    expect(scoreNamePrefix("saac", "Isaac Ng")).toBe(0);
  });

  test("requires every query token to match some word", () => {
    expect(scoreNamePrefix("aaron smith", "Aaron Diaz")).toBe(0);
  });

  test("matches a first name and a surname initial together", () => {
    expect(scoreNamePrefix("aaron d", "Aaron Diaz")).toBeGreaterThan(0);
  });

  test("does not typo-correct, unlike the address matcher", () => {
    // A neighbour's name is not a street: offering "Aaron" to someone who
    // typed "Aoron" is a guess about a person, and being confidently wrong
    // about who lives where is worse than returning nothing.
    expect(scoreNamePrefix("aoron", "Aaron Diaz")).toBe(0);
  });
});

describe("rankByNamePrefix", () => {
  test("returns nothing for a blank query", () => {
    // Deliberately unlike rankByMatch, which passes everything through: an
    // empty prefix that matches the whole directory is not a suggestion list.
    expect(people("  ")).toEqual([]);
  });

  test("finds every word starting with the query, first names first", () => {
    expect(people("aa")).toEqual(["Aaron Diaz", "Priya Aarav"]);
  });

  test("finds people by surname", () => {
    expect(people("smith")).toEqual(["John Smith", "Ada Smithson"]);
  });

  test("keeps input order for equally good matches", () => {
    expect(people("diaz")).toEqual(["Aaron Diaz", "Maya Diaz"]);
  });

  test("returns nothing when the query matches nobody", () => {
    expect(people("zzzz")).toEqual([]);
  });
});
