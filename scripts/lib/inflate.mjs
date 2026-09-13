// Cloning a curated wire index up to a corporate-sized one.
//
// Shared by `scripts/quality-site.mjs` (which measures the catalog at that
// size) and `scripts/dev-indexes.mjs --bulk N` (which renders it for a human
// to look at). One definition, so the site a regression is measured against
// is the same site it was eyeballed in.
//
// The committed fixtures are one package per rendering state — the right
// shape for "does this state render" and the wrong one for "do the toolbar,
// the keyword rail, the sort and the table view still hold at the size a
// corporate mirror reaches". Cloning into the fixture itself would only make
// the curated set harder to read, so every clone is made in a scratch copy
// and nothing is written back.
//
// Each clone is a whole package root, not a card: its own `p/<ns>/<name>.json`
// with the `name` the loader requires, its own `o/sha256/` CAS directory
// (copied byte-for-byte, so every `desc.digest`/`readme`/`logo`/`tags[].content`
// digest still resolves), and its own dates. The dates are the ones worth
// spelling out — 250 packages sharing one `created`/`observed` make the sort
// control a 250-way tie, which is untestable at exactly the size that needed
// testing.
import { readdir, readFile, writeFile, mkdir, cp } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

/** Suffixes, so a cloned name reads like a real corporate namespace. */
export const TEAMS = [
  "platform", "payments", "identity", "billing", "search",
  "mobile", "data", "infra", "checkout", "risk",
  "growth", "docs", "support", "ledger", "auth",
];

/** `bat` → `bat-payments`, then `bat-payments-2` once the list wraps. */
export function suffixed(name, i) {
  const round = Math.floor(i / TEAMS.length);
  return `${name}-${TEAMS[i % TEAMS.length]}${round === 0 ? "" : `-${round + 1}`}`;
}

/**
 * A stable number in `[0, max)` from a string — djb2. Deterministic on
 * purpose: two runs of `--bulk 250` render the same catalog, so a layout
 * question asked twice gets the same answer both times.
 */
export function spread(seed, max) {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = ((h * 33) ^ seed.charCodeAt(i)) >>> 0;
  return h % max;
}

/** Shift an ISO instant back by `ms`, keeping its `YYYY-MM-DD`-only shape
 *  when that is what it had — `created` is a date, `observed` is a timestamp,
 *  and the viewmodel reads both as written. */
function shift(value, ms) {
  if (typeof value !== "string") return value;
  const at = Date.parse(value);
  if (Number.isNaN(at)) return value;
  const moved = new Date(at - ms).toISOString();
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? moved.slice(0, 10) : moved.replace(/\.\d{3}Z$/, "Z");
}

/** Every `p/<ns>/<pkg>.json` under `root`, deepest namespace included. */
async function packageRoots(root) {
  const pDir = join(root, "p");
  const found = [];
  for (const entry of await readdir(pDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    // Only the package ROOT, never a CAS blob under `<pkg>/o/sha256/`.
    const rel = relative(pDir, join(entry.parentPath, entry.name));
    if (rel.split(sep).includes("o")) continue;
    found.push(join(entry.parentPath, entry.name));
  }
  return found.sort();
}

/**
 * Clone the package roots under `root` until there are at least `target` of
 * them. Mutates the tree in place — hand it a scratch copy, never a fixture.
 * Returns how many clones were made.
 */
export async function inflate(root, target) {
  const sources = await packageRoots(root);
  if (sources.length === 0) return 0;

  const copies = Math.max(0, Math.ceil(target / sources.length) - 1);
  let made = 0;
  for (const file of sources) {
    const json = JSON.parse(await readFile(file, "utf8"));
    const original = file.slice(0, -".json".length);
    const leaf = json.name.split("/").pop();
    for (let i = 0; i < copies; i++) {
      const name = suffixed(leaf, i);
      // The wire `name` is `<brand>/<ns>/<pkg>` and the loader requires it to
      // match the file's own path, so both change together.
      const qualified = json.name.replace(/[^/]+$/, name);
      // Up to two years back, so the date sorts have something to sort.
      const drift = spread(qualified, 17_520) * 3_600_000;
      const clone = {
        ...json,
        name: qualified,
        created: shift(json.created, drift),
        desc: json.desc ? { ...json.desc, title: name } : json.desc,
        tags: json.tags
          ? Object.fromEntries(
              Object.entries(json.tags).map(([tag, t]) => [
                tag,
                {
                  ...t,
                  observed: shift(t.observed, drift),
                  ...(t.yanked ? { yanked: { ...t.yanked, at: shift(t.yanked.at, drift) } } : {}),
                },
              ]),
            )
          : json.tags,
      };
      await mkdir(dirname(file), { recursive: true });
      await writeFile(join(dirname(file), `${name}.json`), JSON.stringify(clone, null, 2) + "\n", "utf8");
      // The CAS directory is per package, and every digest in the root above
      // points into it. Copied rather than shared: the bytes are identical,
      // so the digests still verify, and each clone stays a whole package.
      await cp(original, join(dirname(file), name), { recursive: true, force: true }).catch((error) => {
        // A package with no CAS assets at all is legal — nothing to copy.
        if (error?.code !== "ENOENT") throw error;
      });
      made++;
    }
  }
  return made;
}
