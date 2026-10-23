import type { CatalogPackage } from "./wireTypes.js";

// The catalog's free-text relevance model: a port of grim's `src/catalog/search_match.rs` via grimoire-indexer's
// `src/renderer/astro/lib/search.ts`, so a query ranks the same everywhere. Every term must hit some field (AND); each
// term scores its best field and the package's score is the sum. Identifiers (package, title, keywords) match fuzzy
// only when the hit is tight; prose (description, namespace) matches by word prefix, since fuzzy finds any short term
// scattered through a sentence.

/**
 * Per-field multipliers. ponytail: hand-tuned ratios copied from grim (name > keywords > description ≈ namespace);
 * retune in grim first, against a real catalog, then here.
 */
const WEIGHT = { name: 3, keywords: 2, description: 1, namespace: 1 } as const;

/** Minimum skim score per term character for a fuzzy hit: real hits score 15–25, a letter scatter ~2–10. */
const MIN_SCORE_PER_CHAR = 12;
/** Prose hit that is a whole word, per term character. */
const WHOLE_WORD_PER_CHAR = 20;
/** Prose hit that only starts a word (or a separator-carrying term mid-word). */
const WORD_PREFIX_PER_CHAR = 16;
/** Name bonus when the name (or a keyword) IS the term. */
const EXACT_NAME_PER_CHAR = 8;
/** Name bonus when the term is one whole word of it (`grim` in `grim-usage`). */
const NAME_WORD_PER_CHAR = 4;

/** Every package that matched, by qualified `name`, with its relevance score. */
export type Scores = ReadonlyMap<string, number>;

/** skim folds ASCII case only and grim keeps an ASCII haystack as written, so the fuzzy copy must too or scores drift. */
interface Identifier {
  fuzzy: string;
  lower: string;
}

function identifiers(values: string[]): Identifier[] {
  return values
    .filter((s) => s !== "")
    .map((s) => ({ fuzzy: /^\p{ASCII}*$/u.test(s) ? s : s.toLowerCase(), lower: s.toLowerCase() }));
}

interface Entry {
  name: string;
  names: Identifier[];
  keywords: Identifier[];
  description: string;
  namespace: string;
}

// `?? ""`: catalog.json is wire data, and one record with a missing field must not throw the whole search.
function toEntry(pkg: CatalogPackage): Entry {
  return {
    name: pkg.name,
    names: identifiers([pkg.package ?? "", pkg.title ?? ""]),
    keywords: identifiers(pkg.keywords ?? []),
    description: (pkg.description ?? "").toLowerCase(),
    namespace: (pkg.namespace ?? "").toLowerCase(),
  };
}

// One prepared entry list per catalog array; the catalog fetch module-caches the array, so every consumer shares it.
const entryCache = new WeakMap<readonly CatalogPackage[], Entry[]>();

function entriesFor(packages: readonly CatalogPackage[]): Entry[] {
  let entries = entryCache.get(packages);
  if (!entries) {
    entries = packages.map(toEntry);
    entryCache.set(packages, entries);
  }
  return entries;
}

// The grid filters and then ranks with the same query: remember the last answer instead of scoring twice.
let last: { packages: readonly CatalogPackage[]; query: string; scores: Scores } | null = null;

/** Score `query` against every package. An empty query yields an empty map. */
export function scorePackages(packages: readonly CatalogPackage[], query: string): Scores {
  if (last?.packages === packages && last.query === query) return last.scores;
  const scores = new Map<string, number>();
  last = { packages, query, scores };
  const terms = query.toLowerCase().split(/\s+/u).filter(Boolean);
  if (terms.length === 0) return scores;
  for (const entry of entriesFor(packages)) {
    let total = 0;
    for (const term of terms) {
      const best = bestFieldScore(term, entry);
      if (best === null) {
        total = -1; // the AND
        break;
      }
      total += best;
    }
    if (total >= 0) scores.set(entry.name, total);
  }
  return scores;
}

function bestFieldScore(term: string, e: Entry): number | null {
  const chars = [...term].length;
  const fuzzy = (haystack: string): number | null => {
    const s = skimScore(haystack, term);
    return s !== null && s >= MIN_SCORE_PER_CHAR * chars ? s : null;
  };
  const prose = (haystack: string): number | null => {
    const hit = wordHit(haystack, term);
    if (hit === null) return null;
    return (hit === WHOLE ? WHOLE_WORD_PER_CHAR : WORD_PREFIX_PER_CHAR) * chars;
  };
  const identifier = (id: Identifier): number | null => {
    const s = fuzzy(id.fuzzy);
    if (s === null) return null;
    const bonus = id.lower === term ? EXACT_NAME_PER_CHAR : wordHit(id.lower, term) === WHOLE ? NAME_WORD_PER_CHAR : 0;
    return s + bonus * chars;
  };

  let best: number | null = null;
  const offer = (raw: number | null, weight: number) => {
    if (raw !== null && (best === null || raw * weight > best)) best = raw * weight;
  };
  // The qualified name only for a path-like term: every package shares its index and namespace prefixes.
  if (/[/.:]/.test(term)) offer(fuzzy(e.name), WEIGHT.name);
  for (const name of e.names) offer(identifier(name), WEIGHT.name);
  for (const keyword of e.keywords) offer(identifier(keyword), WEIGHT.keywords);
  offer(prose(e.description), WEIGHT.description);
  offer(prose(e.namespace), WEIGHT.namespace);
  return best;
}

const INSIDE = 0;
const PREFIX = 1;
const WHOLE = 2;

const ALNUM = /[\p{L}\p{N}]/u;

/**
 * The strongest way `term` sits in `haystack` (both lowercased): WHOLE when
 * bounded by non-alphanumerics on both sides, PREFIX when it starts a word,
 * INSIDE when it starts mid-word — which only counts for a term that carries
 * its own separator (`code-review`, `node.js`). `null` when absent.
 *
 * ponytail: scripts written without spaces (CJK) form one long "word", so a
 * term there matches only at the run's start; a segmenter is the upgrade.
 */
function wordHit(haystack: string, term: string): number | null {
  const separated = [...term].some((c) => !ALNUM.test(c));
  const boundary = (c: string | undefined) => c === undefined || !ALNUM.test(c);
  let best: number | null = null;
  // Non-overlapping, like Rust's `match_indices`.
  for (let i = haystack.indexOf(term); i !== -1; i = haystack.indexOf(term, i + term.length)) {
    const starts = boundary(charBefore(haystack, i));
    const ends = boundary(charAt(haystack, i + term.length));
    const hit = !starts ? INSIDE : ends ? WHOLE : PREFIX;
    if ((separated || hit !== INSIDE) && (best === null || hit > best)) best = hit;
  }
  return best;
}

/** The code point starting at UTF-16 index `i`, or `undefined` past the end. */
function charAt(s: string, i: number): string | undefined {
  const cp = s.codePointAt(i);
  return cp === undefined ? undefined : String.fromCodePoint(cp);
}

/** The code point ending just before UTF-16 index `i`, or `undefined` at 0. */
function charBefore(s: string, i: number): string | undefined {
  if (i === 0) return undefined;
  const low = s.charCodeAt(i - 1);
  const pair = low >= 0xdc00 && low <= 0xdfff && i >= 2;
  return charAt(s, pair ? i - 2 : i - 1);
}

// ---------------------------------------------------------------------------
// skim V2 (`fuzzy-matcher` 0.3.7, `SkimMatcherV2::default().ignore_case()`),
// score only — a line-for-line port of its compressed two-row matrix, stale
// cells included, so every calibration measured in grim holds here too.
// ---------------------------------------------------------------------------

const SCORE_MATCH = 16;
const GAP_START = -3;
const GAP_EXTENSION = -1;
const BONUS_FIRST_CHAR_MULTIPLIER = 2;
const BONUS_HEAD = SCORE_MATCH / 2;
const BONUS_BREAK = SCORE_MATCH / 2 + GAP_EXTENSION;
const BONUS_CAMEL = SCORE_MATCH / 2 + 2 * GAP_EXTENSION;
const BONUS_CONSECUTIVE = -(GAP_START + GAP_EXTENSION);
const PENALTY_CASE_MISMATCH = GAP_EXTENSION * 2;
const NEG_INFINITY = -32768;

const EMPTY = 0;
const UPPER = 1;
const LOWER = 2;
const NUMBER = 3;
const HARD_SEP = 4;
const SOFT_SEP = 5;

function charType(ch: string): number {
  if (ch === "\0") return EMPTY;
  if (" /\\|()[]{}".includes(ch)) return HARD_SEP;
  const c = ch.charCodeAt(0); // every range below is ASCII, so the first UTF-16 unit decides
  // '!'..='\'' | '*'..='.' | ':'..='@' | '^'..='`' | '~'
  if ((c >= 0x21 && c <= 0x27) || (c >= 0x2a && c <= 0x2e) || (c >= 0x3a && c <= 0x40) || (c >= 0x5e && c <= 0x60) || c === 0x7e) {
    return SOFT_SEP;
  }
  if (c >= 0x30 && c <= 0x39) return NUMBER;
  if (c >= 0x41 && c <= 0x5a) return UPPER;
  return LOWER;
}

function inPlaceBonus(prev: number, cur: number): number {
  if (prev === EMPTY || prev === HARD_SEP) return BONUS_HEAD;
  if (prev === SOFT_SEP) return BONUS_BREAK;
  if ((prev === LOWER || prev === NUMBER) && cur === UPPER) return BONUS_CAMEL;
  return 0;
}

/** ASCII-only case folding, like Rust's `eq_ignore_ascii_case`. */
function asciiLower(ch: string): string {
  return ch.length === 1 && ch >= "A" && ch <= "Z" ? ch.toLowerCase() : ch;
}

function matchScore(c: string, p: string): number | null {
  if (asciiLower(c) !== asciiLower(p)) return null;
  return Math.max(0, SCORE_MATCH + (p !== c ? PENALTY_CASE_MISMATCH : 0));
}

/**
 * skim's score for `pattern` in `choice`, or `null` when `pattern` is not a
 * subsequence of it.
 */
export function skimScore(choice: string, pattern: string): number | null {
  const c = [...choice];
  const p = [...pattern];
  if (p.length === 0) return 0;

  // cheap_matches: the first index each pattern char can land on, greedily.
  const first: number[] = [];
  for (let idx = 0, k = 0; idx < c.length && k < p.length; idx++) {
    if (matchScore(c[idx], p[k]) !== null) {
      first.push(idx);
      k++;
    }
  }
  if (first.length < p.length) return null;

  const cols = c.length + 1;
  const mScore = new Array<number>(2 * cols).fill(NEG_INFINITY);
  const pScore = new Array<number>(2 * cols).fill(NEG_INFINITY);
  const bonus = new Array<number>(2 * cols).fill(0);
  const reset = (i: number) => {
    mScore[i] = NEG_INFINITY;
    pScore[i] = NEG_INFINITY;
    bonus[i] = 0;
  };

  const inPlace = new Array<number>(cols).fill(0);
  let prev = "\0";
  for (let j = 0; j < c.length; j++) {
    const ch = c[j];
    inPlace[j + 1] = inPlaceBonus(charType(prev), charType(ch));
    prev = ch;
  }
  if (cols > 1) inPlace[1] = inPlace[1] * BONUS_FIRST_CHAR_MULTIPLIER;

  reset(0);
  reset(cols + first[0]); // m[(1, first[0])]
  for (let j = 0; j < cols; j++) {
    reset(j);
    pScore[j] = GAP_EXTENSION;
  }

  for (let i = 0; i < p.length; i++) {
    const row = ((i + 1) & 1) * cols;
    const rowPrev = (i & 1) * cols;
    const toSkip = first[i];
    for (let j = toSkip; j < c.length; j++) {
      const col = j + 1;
      const cur = row + col;
      const last = row + j;
      const diag = rowPrev + j;
      const m = matchScore(c[j], p[i]);
      if (m !== null) {
        const place = inPlace[col];
        const consecutive = Math.max(bonus[last], Math.max(place, BONUS_CONSECUTIVE));
        bonus[last] = consecutive;
        const viaMatch = mScore[diag] + consecutive;
        const viaSkip = pScore[diag] + place;
        mScore[cur] = Math.max(viaMatch, viaSkip) + m;
      } else {
        mScore[cur] = NEG_INFINITY;
        bonus[cur] = 0;
      }
      pScore[cur] = Math.max(
        GAP_START + GAP_EXTENSION + mScore[last],
        GAP_EXTENSION + pScore[last],
      );
    }
  }

  const lastRow = (p.length & 1) * cols;
  let best = NEG_INFINITY;
  for (let j = first[p.length - 1]; j < cols; j++) {
    best = Math.max(best, mScore[lastRow + j]);
  }
  return best;
}

/**
 * Drop matches scoring under this percent of the best match in the list (grim's `search_min_relevance` default): a
 * name query returns the packages named for it, not every package whose description mentions it.
 */
const MIN_RELEVANCE = 50;

/** `list` without the weak tail (under the relevance cutoff). Run it after every other filter so "best" is the best one on screen. */
export function applyCutoff<T extends { name: string }>(list: readonly T[], scores: Scores): T[] {
  const best = list.reduce((m, p) => Math.max(m, scores.get(p.name) ?? 0), 0);
  return list.filter((p) => (scores.get(p.name) ?? 0) * 100 >= best * MIN_RELEVANCE);
}

/** `list` best match first; equal scores keep their incoming order (`Array#sort` is stable). */
export function byRelevance<T extends { name: string }>(list: readonly T[], scores: Scores): T[] {
  return [...list].sort((a, b) => (scores.get(b.name) ?? 0) - (scores.get(a.name) ?? 0));
}
