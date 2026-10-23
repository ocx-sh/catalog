// The support-matrix dialog's rows (D-149), written per package next to `catalog.json` and fetched by the dialog
// on first open. The order and the cells are the ones the dialog's server-rendered rows had.
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { DetailView } from "../../src/site/model/detail.js";
import { supportData, writeSupportMatrices } from "../../src/viewmodel/support_matrix.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "support-matrix-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const LINUX = "linux/amd64";
const MAC = "darwin/arm64";

/** Only the fields the dialog reads. */
const view = (patch: Partial<DetailView>): DetailView =>
  ({
    platformSets: [[LINUX, MAC], [LINUX]],
    releases: [{ platformSet: 0 }, { platformSet: 1 }],
    tagReleases: [],
    ephemeralTags: [],
    yankedTags: [],
    status: "active",
    deprecatedMessage: null,
    ...patch,
  }) as unknown as DetailView;

test("D-149 rows are newest first: latest, then non-version tags, then versions by precedence", () => {
  const data = supportData(
    view({
      tagReleases: [["1.2.0", 1], ["nightly", 0], ["10.0.0", 0], ["2.0.0", 1], ["latest", 0], ["beta", 0]],
    }),
  );

  expect(data?.rows.map((row) => row.tag)).toEqual(["latest", "beta", "nightly", "10.0.0", "2.0.0", "1.2.0"]);
});

test("D-149 a row carries the platforms of its release and the ephemeral flag of its tag", () => {
  const data = supportData(
    view({ tagReleases: [["2.0.0-snapshot", 0], ["1.0.0", 1]], ephemeralTags: ["2.0.0-snapshot"] }),
  );

  expect(data).toEqual({
    rows: [
      { tag: "2.0.0-snapshot", platforms: [LINUX, MAC], ephemeral: true, yanked: null },
      { tag: "1.0.0", platforms: [LINUX], ephemeral: false, yanked: null },
    ],
    deprecated: null,
  });
});

test("D-149 a tag whose release is unknown ships for no platform", () => {
  expect(supportData(view({ tagReleases: [["1.0.0", 9]] }))?.rows).toEqual([{ tag: "1.0.0", platforms: [], ephemeral: false, yanked: null }]);
});

test("D-149 a package that lists no platform has no dialog and so no file", async () => {
  const silent = view({ platformSets: [[]], tagReleases: [["1.0.0", 0]] });
  expect(supportData(silent)).toBeNull();

  await writeSupportMatrices(dir, { "acme/silent": silent, "idx/acme/tool": view({ tagReleases: [["1.0.0", 0]] }) });

  await expect(stat(join(dir, "data/catalog/support/acme/silent.json"))).rejects.toThrow();
  const written = JSON.parse(await readFile(join(dir, "data/catalog/support/idx/acme/tool.json"), "utf8"));
  expect(written.rows).toEqual([{ tag: "1.0.0", platforms: [LINUX, MAC], ephemeral: false, yanked: null }]);
});

test("a yanked tag carries its record; a deprecated package carries its message", () => {
  const yank = { reason: "Corrupt archive.", at: "2026-02-20T10:00:00Z" };
  const data = supportData(view({ tagReleases: [["1.0.0", 0]], yankedTags: [["1.0.0", yank]], status: "deprecated", deprecatedMessage: "Use acme/new." }));

  expect(data).toEqual({ rows: [{ tag: "1.0.0", platforms: [LINUX, MAC], ephemeral: false, yanked: yank }], deprecated: { message: "Use acme/new." } });
});
