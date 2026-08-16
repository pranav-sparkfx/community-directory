/**
 * Ranked matching for the directory search box.
 *
 * The previous rule was `address.toLowerCase().includes(query)`, which is a
 * yes/no test in address order. That fails a neighbour in two ways they
 * actually hit: "flintgrove 2600" finds nothing because the tokens are out of
 * order, and "Flintgrve" finds nothing because one key slipped. It also has no
 * notion of a better match, so "Willow" returns the whole street with the
 * closest home wherever the database happened to put it.
 *
 * Scoring is deliberately small and explainable rather than a similarity
 * library: this runs on every keystroke over a community's households, and a
 * neighbour typing a street name wants their street first, not a tuned metric.
 */

/** Lowercase, strip punctuation, collapse runs of whitespace. */
export function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  const n = normalize(value);
  return n ? n.split(" ") : [];
}

/**
 * Levenshtein distance, bailing out once it exceeds `max`.
 *
 * Bounded because the only question asked is "is this within one or two
 * keystrokes"; computing an exact large distance for two unrelated words is
 * work whose answer is discarded.
 */
export function boundedEditDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      row.push(value);
      if (value < best) best = value;
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}

/**
 * How far a single query token is willing to be from a candidate token.
 *
 * Numbers get no budget at all. 1204 and 1206 are one edit apart but they are
 * two different front doors, and offering the neighbours either side of the
 * house someone typed is worse than offering nothing.
 */
function typoBudget(token: string): number {
  if (/^\d+$/.test(token)) return 0;
  if (token.length <= 3) return 0;
  if (token.length <= 6) return 1;
  return 2;
}

/**
 * Score one query token against one field.
 *
 * Returns 0 when the token does not match at all — a query token that matches
 * nothing must veto the whole record, so partial matches cannot dilute their
 * way to the top of the list.
 */
function scoreToken(token: string, fieldTokens: string[], field: string): number {
  if (field.startsWith(token)) return 100;

  let best = 0;
  for (const candidate of fieldTokens) {
    if (candidate === token) best = Math.max(best, 90);
    else if (candidate.startsWith(token)) best = Math.max(best, 70);
    else if (candidate.includes(token)) best = Math.max(best, 45);
  }
  if (best) return best;

  // Nothing matched literally, so allow for a slip. Compared per word rather
  // than across the whole field: "flintgrve" should reach "flintgrove", but
  // should not reach "2600 Flintgrove Loop" merely by being a similar length.
  const budget = typoBudget(token);
  if (budget === 0) return 0;
  for (const candidate of fieldTokens) {
    const distance = boundedEditDistance(token, candidate, budget);
    if (distance <= budget) return 30 - distance * 5;
  }
  return 0;
}

/**
 * Score a record against a query across one or more fields.
 *
 * Every query token must match somewhere, in any order and any field. The
 * result is the mean of the per-token best scores, so a two-word query that
 * matches one word exactly and one word loosely still ranks below one that
 * matches both cleanly.
 *
 * Returns 0 for "no match" so callers can filter on truthiness.
 */
export function scoreMatch(query: string, fields: (string | null | undefined)[]): number {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return 0;

  const prepared = fields
    .filter((f): f is string => typeof f === "string" && f.length > 0)
    .map((f) => {
      const normalized = normalize(f);
      return { field: normalized, tokens: normalized.split(" ").filter(Boolean) };
    });
  if (prepared.length === 0) return 0;

  let total = 0;
  for (const token of queryTokens) {
    let best = 0;
    for (const { field, tokens } of prepared) {
      best = Math.max(best, scoreToken(token, tokens, field));
    }
    if (best === 0) return 0;
    total += best;
  }
  return total / queryTokens.length;
}

/**
 * Filter and rank `items` by how well they match `query`.
 *
 * Ties keep their input order, which for households is the order the database
 * returned — house numbers along a street.
 */
export function rankByMatch<T>(
  items: readonly T[],
  query: string,
  fieldsOf: (item: T) => (string | null | undefined)[],
): T[] {
  if (!normalize(query)) return [...items];

  return items
    .map((item, index) => ({ item, index, score: scoreMatch(query, fieldsOf(item)) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}
