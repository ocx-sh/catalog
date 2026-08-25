#!/usr/bin/env node
/**
 * Seeds `.dev-indexes/` — a gitignored set of carved OCX index trees plus the
 * configs that aggregate them, for eyeballing multi-index behaviour in a real
 * `ocx-catalog dev`. Run it with `task dev:indexes`, serve one case with
 * `task dev:catalog CASE=<name>`.
 *
 * Carving an index is a rewrite of ONE path segment: a source's identity is
 * the first `/`-segment of its package roots' `name` (`sources/labels.ts`
 * derives a label from exactly that, and refuses a config whose label
 * disagrees). So the same package bytes, re-prefixed, become a different
 * index's copy.
 *
 * ## Where the packages come from
 *
 * No single corpus covers what this needs, so it mixes three, and nothing is
 * committed here — the same shape `ocx-sh/index`'s own `demo:seed` uses for
 * its gitignored `demo/p/`:
 *
 * | corpus | what only it has |
 * |---|---|
 * | `<index repo>/p` | volume — 124 roots across 100 namespaces, `bazelbuild/bazel` at 135 tags, the longest real package names |
 * | `<index repo>/demo/p` | a deprecated package, a yanked TAG, roots with no readme/logo |
 * | `test/fixtures/quality-index` | the only whole-package `status: yanked` anywhere, plus a `desc`-rich root |
 *
 * Point `INDEX_REPO` elsewhere if the sibling checkout lives somewhere else.
 * Without it, this script is the one thing here that needs a second repo —
 * deliberately, like `smoke:test` needing the network.
 *
 * ## What it synthesizes, and why
 *
 * Six situations exist in NO corpus and would otherwise ship unlooked-at:
 *
 * 1. **A depth-N package path.** Zero of the 143 real roots is deeper than
 *    `<ns>/<pkg>`, so nothing has ever exercised the depth-N routing the
 *    schema allows — or the middle elision that keeps such a name readable.
 * 2. **The same `<ns>/<pkg>` in two indexes.** Impossible within one corpus,
 *    and the entire reason routes are index-qualified.
 * 3. **An index named after a root-source namespace.** The red state of
 *    `INDEX_NAMESPACE_COLLISION`; a guard only ever seen green is a habit.
 * 4. **An explicit label that renames its index.** The red state of
 *    `LABEL_PREFIX_MISMATCH`, same reason.
 * 5. **A logo blob that is not an image.** The wire reference resolves, so
 *    the build succeeds and the BROWSER fails — the one path that exercises
 *    the theme's image fallback rather than a build error.
 * 6. **An empty index.** Legal (an explicit label needs no roots to derive
 *    from), and its tab reads 0.
 * 7. **A default index that is not the root one.** `multi-noroot-default` has
 *    no root source at all, so every route is qualified and the catalog still
 *    opens on a named index — the split between placement and preselection
 *    only shows on a page, never in a unit assertion about one of them.
 */
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const INDEX_REPO = resolve(process.env.INDEX_REPO ?? join(REPO, "..", "index"));
const OUT = join(REPO, ".dev-indexes");
const TREES = join(OUT, "trees");

const CORPORA = {
  real: join(INDEX_REPO, "p"),
  demo: join(INDEX_REPO, "demo", "p"),
  quality: join(REPO, "test", "fixtures", "quality-index", "p"),
};

/** `{ format_version: 1 }` — every carved tree needs one at its root. */
const CONFIG_JSON = `${JSON.stringify({ format_version: 1 }, null, 2)}\n`;

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Every package root under a `p/` tree, as `{ id, json, casDir }`.
 *
 * A root is any `<path>.json` that is not itself a CAS blob: image indices
 * also end in `.json` and live at `<path>/o/sha256/<hex>.json`, so the
 * control suffix is what separates them — the same rule `sources/types.ts`'s
 * `extractPackages` applies to the wire tree.
 */
async function collectRoots(pDir) {
  if (!(await exists(pDir))) return [];
  const roots = [];

  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "o") await walk(full);
        continue;
      }
      if (!entry.name.endsWith(".json")) continue;
      const id = relative(pDir, full).replace(/\.json$/, "");
      roots.push({
        id,
        json: JSON.parse(await readFile(full, "utf8")),
        casDir: join(dirname(full), entry.name.replace(/\.json$/, ""), "o", "sha256"),
      });
    }
  }

  await walk(pDir);
  return roots.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Writes one root into a carved tree under `brand`, re-prefixing its `name`
 * and carrying its CAS blobs across verbatim. `id` overrides the wire path,
 * which is how the depth-N and duplicate cases are built out of ordinary
 * two-segment packages.
 */
async function writeRoot(brand, root, { id = root.id, mutate } = {}) {
  const tree = join(TREES, brand);
  const json = { ...root.json, name: `${brand}/${id}` };
  mutate?.(json);

  const file = join(tree, "p", `${id}.json`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(json, null, 2)}\n`, "utf8");

  if (await exists(root.casDir)) {
    await cp(root.casDir, join(tree, "p", id, "o", "sha256"), { recursive: true });
  }
}

async function seedTree(brand) {
  await mkdir(join(TREES, brand), { recursive: true });
  await writeFile(join(TREES, brand, "config.json"), CONFIG_JSON, "utf8");
}

function source(brand, extra = {}) {
  return { path: `trees/${brand}`, ...extra };
}

async function writeConfig(name, sources, title) {
  await writeFile(
    join(OUT, `${name}.config.json`),
    `${JSON.stringify(
      {
        $schema: "../src/config/schema/catalog.config.schema.json",
        brand: { title },
        sources,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function main() {
  if (!(await exists(CORPORA.real))) {
    console.error(
      `dev-indexes: no index checkout at ${INDEX_REPO}. Clone ocx-sh/index beside this repo, or set INDEX_REPO.`,
    );
    process.exit(1);
  }

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const real = await collectRoots(CORPORA.real);
  const demo = await collectRoots(CORPORA.demo);
  const quality = await collectRoots(CORPORA.quality);

  // Brands are dotted on purpose: a namespace can never contain a `.`, so no
  // ACCIDENTAL collision with a root namespace can occur — the collision case
  // below has to be built deliberately, which is the point of a red state.
  const ROOT = "ocx.sh";
  const CORP = "corp.example";
  const PARTNER = "partner.dev";

  // --- the default index: bulk from the real tree, statuses from the fixture
  await seedTree(ROOT);
  for (const root of real.slice(0, 40)) await writeRoot(ROOT, root);
  // quality-index carries the deprecated + whole-package-yanked pair, and its
  // `acme` namespace is what the collision case below is named after.
  for (const root of quality) await writeRoot(ROOT, root);
  // (2) half of the duplicate pair. Seeded explicitly rather than hoped for
  // out of the bulk slice above — a "same package in two indexes" case that
  // only sometimes contains the same package proves nothing.
  const shared = real.find(root => root.id === "hashicorp/terraform") ?? real[0];
  await writeRoot(ROOT, shared);

  // --- a second index: the demo tree's edge states, plus the synthesized ones
  await seedTree(CORP);
  for (const root of demo) await writeRoot(CORP, root);
  // (2) the other half: the same `<ns>/<pkg>` the default index publishes.
  await writeRoot(CORP, shared);
  // (5) a logo the browser cannot decode. The digest RESOLVES — a dangling
  // one is a build error, not a broken image — so the failure lands where the
  // theme's fallback chain can be seen doing its job.
  const brokenLogo = `sha256:${"c".repeat(64)}`;
  const withLogo = demo.find(root => root.json.desc?.logo) ?? demo[0];
  await writeRoot(CORP, withLogo, {
    id: "broken/logo-tile",
    mutate: (json) => {
      json.desc = { ...(json.desc ?? { title: "Broken logo", description: "Its logo is not an image.", keywords: [] }), logo: brokenLogo };
    },
  });
  await mkdir(join(TREES, CORP, "p", "broken", "logo-tile", "o", "sha256"), { recursive: true });
  await writeFile(
    join(TREES, CORP, "p", "broken", "logo-tile", "o", "sha256", `${brokenLogo.slice("sha256:".length)}.png`),
    "not actually a PNG\n",
    "utf8",
  );

  // --- a third index: the long and deep names
  await seedTree(PARTNER);
  // (1) depth-N: three segments after the brand, which nothing real has.
  const deep = real.find(root => root.id === "hashicorp/terraform") ?? real[0];
  await writeRoot(PARTNER, deep, { id: "hashicorp/providers/terraform-provider-aws" });
  // (6) worst-case elision: a long package under a long brand.
  const long = real.find(root => root.id.length > 24) ?? real[1];
  await writeRoot(PARTNER, long, { id: "docker/docker-credential-secretservice" });
  for (const root of real.slice(40, 46)) await writeRoot(PARTNER, root);

  // (6) an empty index — legal, and its tab reads 0.
  await seedTree("empty.example");

  // (3) an index named after a namespace the default index publishes.
  await seedTree("acme");
  for (const root of quality.slice(0, 2)) await writeRoot("acme", root);

  // `many`: enough indexes to push the tab row past its inline limit.
  const extras = ["mirror-a", "mirror-b", "mirror-c", "mirror-d"];
  for (const [i, brand] of extras.entries()) {
    await seedTree(brand);
    for (const root of real.slice(46 + i * 4, 50 + i * 4)) await writeRoot(brand, root);
  }

  // --- the cases
  await writeConfig("single-root", [source(ROOT, { root: true })], "One Index");
  await writeConfig("single-noroot", [source(ROOT)], "One Index, Not Root");
  await writeConfig(
    "multi-root",
    [source(ROOT, { root: true }), source(CORP), source(PARTNER), source("empty.example", { label: "empty.example" })],
    "Aggregated Catalog",
  );
  await writeConfig("multi-noroot", [source(ROOT), source(CORP), source(PARTNER)], "Aggregated, No Default");
  // No root source, and a default anyway: every route stays qualified (nothing
  // is served at the site root) while the catalog still OPENS on `corp.example`
  // and badges its tab. The pair `root: true` alone cannot express.
  await writeConfig(
    "multi-noroot-default",
    [source(ROOT), source(CORP, { default: true }), source(PARTNER)],
    "Aggregated, Default Without Root",
  );
  await writeConfig(
    "many",
    [source(ROOT, { root: true }), source(CORP), source(PARTNER), ...extras.map(brand => source(brand))],
    "Many Indexes",
  );
  // (4) + (3): the two guards' red states, each its own config.
  await writeConfig(
    "invalid-prefix",
    [source(ROOT, { root: true, label: "renamed-index" })],
    "Label That Renames Its Index",
  );
  await writeConfig("invalid-collision", [source(ROOT, { root: true }), source("acme")], "Namespace Collision");

  const cases = (await readdir(OUT)).filter(name => name.endsWith(".config.json")).sort();
  console.log(`dev-indexes: seeded ${(await readdir(TREES)).length} index trees in ${relative(REPO, OUT)}`);
  console.log(`  cases: ${cases.map(name => name.replace(".config.json", "")).join(", ")}`);
}

await main();
