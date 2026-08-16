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
 * Score a person's name against a query, prefix-only.
 *
 * Names get a different rule from addresses, and the difference is not an
 * oversight. The address matcher above tolerates a slipped key because a
 * street is a shared, guessable thing and "flintgrve" has one obvious
 * intention. A name is not: offering "Aaron Diaz" to someone who typed
 * "Aoron" is a guess about which neighbour they meant, and being confidently
 * wrong about who lives at a particular door is worse than returning nothing.
 * So there is no typo budget here, and no mid-word substring match either —
 * "saac" does not reach "Isaac", because nobody types the middle of a name.
 *
 * Every word is a valid starting point, so "smith" finds "John Smith". A hit
 * on the first word outranks a hit on a later one: someone typing "aa" is
 * more likely to want Aaron than Priya Aarav, but both are real answers.
 *
 * Returns 0 for "no match" so callers can filter on truthiness.
 */
export function scoreNamePrefix(query: string, name: string): number {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return 0;

  const nameTokens = tokenize(name);
  if (nameTokens.length === 0) return 0;

  let total = 0;
  for (const token of queryTokens) {
    let best = 0;
    for (let i = 0; i < nameTokens.length; i++) {
      const candidate = nameTokens[i];
      if (!candidate.startsWith(token)) continue;
      // Position first: which word matched matters more than how much of it
      // did, so a complete surname still sorts below a partial first name.
      const positional = i === 0 ? 100 : 70;
      const score = candidate.length === token.length ? positional + 5 : positional;
      if (score > best) best = score;
    }
    // A query token that matches no word vetoes the person outright, so
    // "aaron smith" cannot reach Aaron Diaz on the strength of one half.
    if (best === 0) return 0;
    total += best;
  }
  return total / queryTokens.length;
}

/**
 * Filter and rank `items` by name prefix.
 *
 * Unlike `rankByMatch`, a blank query returns nothing rather than everything:
 * this feeds a suggestion list, and an empty prefix that matches the entire
 * directory is not a suggestion.
 */
export function rankByNamePrefix<T>(
  items: readonly T[],
  query: string,
  nameOf: (item: T) => string,
): T[] {
  if (!normalize(query)) return [];

  return items
    .map((item, index) => ({ item, index, score: scoreNamePrefix(query, nameOf(item)) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
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
