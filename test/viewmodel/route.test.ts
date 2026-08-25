import { describe, expect, it } from "vitest";
import { isRootIndex, packageRoutePath, packageRouteSegments } from "../../src/viewmodel/route.js";
import type { CatalogIndexInfo } from "../../src/viewmodel/types.js";

/*
 * The route rule has exactly one implementation now, and this is its direct
 * test. Both callers are pinned where they live — the build in
 * `test/build/sources_pipeline.test.ts`, the theme in
 * `test/theme/components/index_scope_wiring.test.ts` and
 * `palette_route_wiring.test.ts` — because a rule that is only unit-tested is
 * how this repo shipped a fully-covered, fully-orphaned module before.
 *
 * The pairs below are the whole contract: for any one catalog, what the build
 * WRITES and what the theme LINKS must be the same path. They are asserted
 * together on purpose; asserting either alone is what let the two drift.
 */

const AGGREGATED: CatalogIndexInfo[] = [
  { name: "ocx.sh", root: true, count: 1 },
  { name: "corp.example", root: false, count: 1 },
];

/** A lone non-root index — no entry is `root`, so nothing is bare. */
const NO_DEFAULT: CatalogIndexInfo[] = [{ name: "corp.example", root: false, count: 2 }];

const LONE_ROOT: CatalogIndexInfo[] = [{ name: "ocx.sh", root: true, count: 2 }];

describe("isRootIndex", () => {
  it("is the index the envelope marks root", () => {
    expect(isRootIndex("ocx.sh", AGGREGATED)).toBe(true);
    expect(isRootIndex("corp.example", AGGREGATED)).toBe(false);
  });

  // The case that used to 404: one index, not the default, so its packages
  // are qualified even though there is nothing to disambiguate them from.
  it("is false for every index when the envelope marks no root", () => {
    expect(isRootIndex("corp.example", NO_DEFAULT)).toBe(false);
  });

  // A catalog.json this renderer did not write (the Python bot emits no
  // `indexes` key) has one index and no qualification.
  it("is true when there is no envelope at all", () => {
    expect(isRootIndex("ocx.sh", undefined)).toBe(true);
  });

  it("is false for an index the envelope does not list", () => {
    expect(isRootIndex("stranger", AGGREGATED)).toBe(false);
  });
});

describe("the two sides agree — what the build writes is what the theme links", () => {
  const cases: { label: string; indexes: CatalogIndexInfo[] | undefined; name: string; expected: string }[] = [
    { label: "default index, depth 2", indexes: AGGREGATED, name: "ocx.sh/hashicorp/terraform", expected: "/hashicorp/terraform" },
    { label: "default index, depth 3", indexes: AGGREGATED, name: "ocx.sh/acme/tools/gadget", expected: "/acme/tools/gadget" },
    { label: "non-default index", indexes: AGGREGATED, name: "corp.example/platform/kit", expected: "/corp.example/platform/kit" },
    { label: "lone non-root index", indexes: NO_DEFAULT, name: "corp.example/acme/widget", expected: "/corp.example/acme/widget" },
    { label: "lone root index", indexes: LONE_ROOT, name: "ocx.sh/acme/widget", expected: "/acme/widget" },
    { label: "no envelope", indexes: undefined, name: "ocx.sh/acme/widget", expected: "/acme/widget" },
  ];

  it.each(cases)("$label", ({ indexes, name, expected }) => {
    const [indexName, namespace, ...rest] = name.split("/");

    // The build side, from wire identity it already holds…
    const segments = packageRouteSegments(indexName!, namespace!, rest.join("/"), indexes);
    // …and the theme side, from the qualified name alone.
    expect(`/${segments.join("/")}`).toBe(expected);
    expect(packageRoutePath(name, indexes)).toBe(expected);
  });
});
