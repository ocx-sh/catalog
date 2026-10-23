/**
 * The detail page's version tree, install card, platforms card and metadata
 * rail on packages the committed fixture sites do not carry: variants, a
 * yanked tag inside a group, a platform-agnostic tag, a variant-only package,
 * an empty deprecation message and a package directory with an unusual name.
 * One real CLI build over the quality index plus five packages written into
 * the project (a `path` source needs no digest to match its bytes). Parsed
 * with jsdom, scripts off: every assertion is on the HTML alone.
 *
 * Rows of the defect ledger (`.claude/artifacts/defects_ocx_theme_port.md`)
 * are named `D-xxx` in the titles.
 */
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createProject, readHtml, runBuild, type CliResult, type Project } from "./helpers.js";

const hex = (c: string) => c.repeat(64);
const digest = (c: string) => `sha256:${hex(c)}`;
const NOW = "2026-03-01T00:00:00Z";
const ANNOTATION = (license: string, revision: string) => ({
  "org.opencontainers.image.licenses": license,
  "org.opencontainers.image.source": "https://github.com/acme/treed",
  "org.opencontainers.image.revision": revision,
});

const platform = (os: string, architecture: string) => ({ mediaType: "m", digest: "sha256:x", size: 1, platform: { os, architecture } });
const imageIndex = (manifests: object[], annotations: object = {}) =>
  JSON.stringify({ schemaVersion: 2, mediaType: "application/vnd.oci.image.index.v1+json", manifests, annotations });

const root = (name: string, body: Record<string, unknown>) =>
  JSON.stringify({ name: `ocx.sh/${name}`, status: "active", deprecated_message: null, created: "2026-01-01", desc: null, tags: {}, ...body });
const tag = (c: string, extra: object = {}) => ({ content: digest(c), observed: NOW, ...extra });
const wire = (pkg: string, c: string, json: string) => [`index/p/${pkg}/o/sha256/${hex(c)}.json`, json] as const;

/**
 * acme/big: 304 tags (two variant rows of ten minor lines with fourteen patches each, plus the rolling tags),
 * six platforms per tag and a README of the usual size. The page budget of the content class has to hold
 * for it (D-149): the prerender is bounded, the rest is fetched on interaction.
 */
const BIG_PLATFORMS = [
  ["linux", "amd64"],
  ["linux", "arm64"],
  ["darwin", "amd64"],
  ["darwin", "arm64"],
  ["windows", "amd64"],
  ["windows", "arm64"],
] as const;
const BIG_README = `# big

A command line tool that does one thing and pins it by digest. **big** ships as a single static binary
for six platforms and reads its configuration from the environment.

## Install

\`\`\`sh
ocx add acme/big
ocx package install acme/big:1
\`\`\`

## Usage

\`\`\`sh
big --config ./big.toml run
big --help
\`\`\`

| Flag | Meaning |
| --- | --- |
| \`--config\` | Path of the configuration file |
| \`--verbose\` | Print every step |
| \`--dry-run\` | Change nothing |
| \`--jobs\` | Number of parallel workers |

## Features

- Pinned by digest, never by a moving tag.
- Verified on install.
- Cleaned up on uninstall.
- Works offline once installed.
- Reads its configuration from the environment.

## Links

- [Project page](https://example.com/acme/big)
- [Issue tracker](https://example.com/acme/big/issues)
- [Changelog](https://example.com/acme/big/releases)

> Not affiliated with any vendor named in this README.
`;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

function bigFiles(): [string, string][] {
  const files: [string, string][] = [];
  const tags: Record<string, unknown> = {};
  let counter = 0;
  const build = (): string => {
    const body = imageIndex(
      BIG_PLATFORMS.map(([os, architecture]) => platform(os, architecture)),
      ANNOTATION("MIT", String(++counter).padStart(40, "0")),
    );
    const hexDigest = sha(body);
    files.push([`index/p/acme/big/o/sha256/${hexDigest}.json`, body]);
    return `sha256:${hexDigest}`;
  };
  for (const variant of ["", "slim-"]) {
    let last = "";
    for (let minor = 0; minor < 10; minor++) {
      for (let patch = 0; patch < 14; patch++) {
        last = build();
        tags[`${variant}1.${minor}.${patch}`] = { content: last, observed: NOW };
      }
      tags[`${variant}1.${minor}`] = { content: last, observed: NOW };
    }
    tags[`${variant}1`] = { content: last, observed: NOW };
    tags[variant === "" ? "latest" : "slim"] = { content: last, observed: NOW };
  }
  const readme = sha(BIG_README);
  files.push([`index/p/acme/big/o/sha256/${readme}.md`, BIG_README]);
  files.push([
    "index/p/acme/big.json",
    root("acme/big", { desc: { title: "Big", description: "Many tags.", keywords: ["big"], readme: `sha256:${readme}` }, tags }),
  ]);
  return files;
}

const FILES: Record<string, string> = Object.fromEntries([
  ...bigFiles(),
  // acme/treed: a default row (alias chain, breakdown, a yanked patch with a reason) and a `musl` variant.
  [
    "index/p/acme/treed.json",
    root("acme/treed", {
      upstream: { org: "acme", repository_url: "https://github.com/acme/treed", disclaimer: "Not affiliated with acme." },
      desc: { title: "Treed", description: "Tree fixture.", keywords: ["tree", "fixture"] },
      tags: {
        latest: tag("a"),
        "2": tag("a"),
        "2.1": tag("a"),
        "2.1.0": tag("a"),
        "2.0.0": tag("b", { yanked: { reason: "Corrupt archive.", at: "2026-02-20" } }),
        "1.0.0": tag("c"),
        "musl-2.1.0": tag("d"),
        "musl-2": tag("d"),
        musl: tag("d"),
        nightly: tag("e"),
      },
    }),
  ],
  wire("acme/treed", "a", imageIndex([platform("linux", "amd64"), platform("linux", "arm64"), platform("darwin", "arm64")], ANNOTATION("MIT", "a".repeat(40)))),
  wire("acme/treed", "b", imageIndex([platform("windows", "amd64")], ANNOTATION("GPL-3.0", "b".repeat(40)))),
  wire("acme/treed", "c", imageIndex([platform("linux", "amd64"), { mediaType: "m", digest: "sha256:att", size: 1 }], ANNOTATION("MIT", "c".repeat(40)))),
  wire("acme/treed", "d", imageIndex([platform("linux", "amd64")], ANNOTATION("MIT", "d".repeat(40)))),
  wire("acme/treed", "e", imageIndex([platform("linux", "amd64")])),
  // acme/anywhere: one build for every host.
  ["index/p/acme/anywhere.json", root("acme/anywhere", { tags: { latest: tag("a"), "1.0.0": tag("a") } })],
  wire("acme/anywhere", "a", imageIndex([platform("any", "any"), platform("linux", "amd64")])),
  // acme/slimonly: only a variant exists.
  ["index/p/acme/slimonly.json", root("acme/slimonly", { tags: { "slim-1.2.3": tag("a"), "slim-1.2": tag("a"), slim: tag("a") } })],
  wire("acme/slimonly", "a", imageIndex([platform("linux", "amd64")], ANNOTATION("Apache-2.0", "f".repeat(40)))),
  // acme/stray: deprecated, empty message, a stray latest.
  [
    "index/p/acme/stray.json",
    root("acme/stray", { status: "deprecated", deprecated_message: "", superseded_by: "", tags: { latest: tag("a"), "0.9.0": tag("b") } }),
  ],
  wire("acme/stray", "a", imageIndex([platform("linux", "amd64")])),
  wire("acme/stray", "b", imageIndex([platform("linux", "amd64")])),
  // An unusual directory name and no desc (D-152, D-078, D-079).
  ["index/p/acme/Odd Name.json", root("acme/Odd Name", { tags: { "1.0.0": tag("a") } })],
  wire("acme/Odd Name", "a", imageIndex([platform("linux", "amd64")])),
  // No owners, upstream without a repository, a malformed annotation on the live tag and an unparseable image
  // index behind a yanked one (D-062, D-089).
  [
    "index/p/acme/bare.json",
    root("acme/bare", {
      owners: [],
      upstream: { org: "acme" },
      tags: { "1.0.0": tag("b", { yanked: { reason: "Withdrawn.", at: "2026-02-01" } }), "2.0.0": tag("a") },
    }),
  ],
  wire("acme/bare", "a", imageIndex([platform("linux", "amd64")], { "org.opencontainers.image.licenses": 7 })),
  wire("acme/bare", "b", "{ not json"),
]);

const text = (el: Element | null | undefined): string => el?.textContent?.replace(/\s+/g, " ").trim() ?? "";
const chips = (scope: ParentNode, selector = "[data-tag]") => [...scope.querySelectorAll(selector)].map((el) => el.getAttribute("data-tag"));

let project: Project;
let result: CliResult;

beforeAll(async () => {
  project = await createProject({}, FILES);
  result = await runBuild(project.config, project.out);
});
afterAll(() => project.dispose());

describe("a project build with variants, yanked tags and unusual packages", () => {
  it("builds, exit 0, for every package including the one with a space in its name (D-152)", async () => {
    expect(result.code, result.stderr).toBe(0);
    const odd = await readHtml(project.out, "/acme/Odd Name/");
    expect(text(odd.querySelector("article h1"))).toBe("Odd Name");
    expect(text(odd.querySelector("[data-identity] code"))).toBe("ocx.sh/acme/Odd Name");
  });

  it("D-053: acme/treed has a default row and a musl row, each with its own alias chain", async () => {
    const doc = await readHtml(project.out, "/acme/treed/");
    const rows = [...doc.querySelectorAll("[data-versions-list] > .variant-row[data-variant]")];
    expect(rows.map((r) => r.getAttribute("data-variant"))).toEqual(["", "musl"]);
    expect(chips(rows[0]!, ".alias-chain [data-tag]")).toEqual(["latest", "2", "2.1", "2.1.0"]);
    expect(chips(rows[1]!, ".alias-chain [data-tag]")).toEqual(["musl", "musl-2", "musl-2.1.0"]);
    expect(text(rows[1]!.querySelector(".variant-label"))).toBe("musl");
    expect(doc.querySelector("[data-variant-other] [data-tag]")?.getAttribute("data-tag")).toBe("nightly");
  });

  it("D-054: the yanked 2.0.0 stays in its place, struck through with reason and date, and the collapsed group warns", async () => {
    const doc = await readHtml(project.out, "/acme/treed/");
    const row = doc.querySelector("[data-versions-list] > .variant-row")!;
    const yanked = row.querySelector("[data-breakdown] [data-tag='2.0.0'][data-yanked]");
    expect(yanked?.getAttribute("title")).toBe("Yanked — Corrupt archive. · 2026-02-20 — click to copy identifier · right-click for more");
    expect(row.querySelector("[data-breakdown] > summary")?.getAttribute("title")).toBe("Contains a yanked version");
    expect(text(row.querySelector("[data-yanked-reason]"))).toContain("2.0.0 yanked — Corrupt archive. · 2026-02-20");
    expect(text(doc.querySelector("#versions-heading"))).toBe("Versions · 10");
  });

  it("D-057: groups are newest first, patches inside a minor are semver ordered", async () => {
    const doc = await readHtml(project.out, "/acme/treed/");
    const row = doc.querySelector("[data-versions-list] > .variant-row")!;
    expect(chips(row, "[data-breakdown] .major-group > .chips [data-tag]")).toEqual(["2", "1.0.0"]);
    expect(chips(row, "[data-breakdown] .patches [data-tag]")).toEqual(["2.1.0", "2.0.0", "1.0.0"]);
  });

  it("D-058, D-059: the install card has a variant select and a pin picker over the first variant's chain", async () => {
    const doc = await readHtml(project.out, "/acme/treed/");
    const variants = [...doc.querySelectorAll("select[data-install-variant] option")].map((o) => o.getAttribute("value"));
    expect(variants).toEqual(["", "musl"]);
    const choices = JSON.parse(doc.querySelector("[data-install-pin]")!.getAttribute("data-choices")!) as { value: string; label: string }[];
    const versions = choices.map((c) => [c.value, c.label]);
    expect(versions).toEqual([
      ["latest", "latest"],
      ["2", "major"],
      ["2.1", "minor"],
      ["2.1.0", "pinned"],
    ]);
    expect(doc.querySelector("template[data-install-options][data-variant='musl']")).not.toBeNull();
    expect(text(doc.querySelector("[data-install-row] .ocx-cmdbar__text"))).toBe("ocx add ocx.sh/acme/treed");
  });

  it("D-060: licence, source and revision rows follow the open release, and every release is in the table", async () => {
    const doc = await readHtml(project.out, "/acme/treed/");
    expect(text(doc.querySelector("[data-row='license'] dd"))).toBe("MIT");
    const releases = [...doc.querySelectorAll("[data-releases] [data-release]")];
    expect(releases.map((el) => el.getAttribute("data-license"))).toEqual(expect.arrayContaining(["MIT", "GPL-3.0"]));
    expect(doc.querySelector("[data-tag='2.0.0']")?.getAttribute("data-release")).not.toBe(doc.querySelector("[data-tag='2.1.0']")?.getAttribute("data-release"));
  });

  it("D-061, D-072: a tag's platform set is a matrix over shared columns, an attestation descriptor is not a platform", async () => {
    const doc = await readHtml(project.out, "/acme/treed/");
    const sets = [...doc.querySelectorAll("[data-platforms] .platform-set")];
    expect(sets.length).toBeGreaterThanOrEqual(3);
    const open = sets.find((el) => !el.hasAttribute("hidden"))!;
    const cells = (os: string) => [...open.querySelectorAll(`[data-os='${os}'] .platform-arch-cell`)].map((el) => text(el));
    expect(cells("linux")).toEqual(["amd64", "arm64"]);
    expect(cells("darwin")).toEqual(["", "arm64"]);
    const windows = sets.find((el) => el.querySelector("[data-os='windows']"));
    expect(windows?.hasAttribute("hidden")).toBe(true);
  });

  it("D-061: an any/any tag shows one 'any platform' line and no rows beside it", async () => {
    const doc = await readHtml(project.out, "/acme/anywhere/");
    const open = doc.querySelector("[data-platforms] .platform-set:not([hidden])");
    expect(text(open?.querySelector("[data-platform-any]"))).toBe("any platform");
    expect(open?.querySelector(".platform-row")).toBeNull();
  });

  it("D-090: a variant-only package installs its first variant's primary tag and shows its licence and revision", async () => {
    const doc = await readHtml(project.out, "/acme/slimonly/");
    expect(text(doc.querySelector("[data-install-row] .ocx-cmdbar__text"))).toBe("ocx add ocx.sh/acme/slimonly:slim");
    expect(text(doc.querySelector("[data-row='license'] dd"))).toBe("Apache-2.0");
    expect(text(doc.querySelector("[data-row='revision'] dd"))).toBe("f".repeat(40));
    expect(text(doc.querySelector("[data-versions-list] .variant-label"))).toBe("slim");
  });

  it("D-066, D-067: a deprecated package with empty message and superseded_by shows the default sentence and no dangling link", async () => {
    const doc = await readHtml(project.out, "/acme/stray/");
    const banner = text(doc.querySelector("[data-banner='deprecated']"));
    expect(banner).toContain("Existing versions remain installable; no new releases will be mirrored.");
    expect(banner).not.toMatch(/Deprecated — $/);
    expect(banner).not.toContain("uperseded by");
    expect(doc.querySelector("[data-superseded-by]")).toBeNull();
  });

  it("D-059: the deprecated package's stray latest is not installed; the newest version is", async () => {
    const doc = await readHtml(project.out, "/acme/stray/");
    expect(text(doc.querySelector("[data-install-row] .ocx-cmdbar__text"))).toBe("ocx add ocx.sh/acme/stray:0.9.0");
    expect(text(doc.querySelector("[data-versions-list] .alias-hint"))).toBe('no "latest" tag — deprecated');
  });

  it("D-078, D-079: a package without a desc titles itself with the leaf of its name and takes its initials from it", async () => {
    const doc = await readHtml(project.out, "/acme/bare/");
    expect(text(doc.querySelector("article h1"))).toBe("bare");
    expect(text(doc.querySelector("[data-identity] .ocx-logo-tile__initials"))).toBe("BA");
  });

  it("D-089, D-051: no owners renders a dash; an upstream without a repository is plain text", async () => {
    const doc = await readHtml(project.out, "/acme/bare/");
    expect(text(doc.querySelector("[data-row='owners'] dd"))).toBe("—");
    const upstream = doc.querySelector("[data-row='upstream'] dd");
    expect(text(upstream)).toBe("acme");
    expect(upstream?.querySelector("a")).toBeNull();
    expect(doc.querySelector("[data-disclaimer]")).toBeNull();
  });

  it("D-062: a malformed annotation and an unparseable image index cost a decoration, never the build", async () => {
    const doc = await readHtml(project.out, "/acme/bare/");
    expect(doc.querySelector("[data-row='license']")).toBeNull();
    expect(text(doc.querySelector("#versions-heading"))).toBe("Versions · 2");
  });

  it("D-050: the disclaimer is always shown below the identity block, with its link", async () => {
    const doc = await readHtml(project.out, "/acme/treed/");
    expect(text(doc.querySelector("[data-disclaimer]"))).toContain("Not affiliated with acme.");
    expect(doc.querySelector("[data-disclaimer] a")?.getAttribute("href")).toBe("https://github.com/acme/treed");
  });
});

describe("a package with 300 tags, six platforms and two variants, with a typical README (D-149)", () => {
  it("D-149: the page stays inside the content-class budget (C-017): at most 1,100 DOM nodes and 14,200 B of gzipped HTML, support-matrix dialog shell included", async () => {
    const doc = await readHtml(project.out, "/acme/big/");
    // The dialog (`PlatformMatrix.astro`) is IN the measure, shell and skeleton: its 304 rows load on first open.
    const html = gzipSync(doc.documentElement.outerHTML).length;

    expect(doc.body.textContent).toContain("pins it by digest");
    expect(doc.body.querySelectorAll("*").length).toBeLessThanOrEqual(1100);
    expect(html).toBeLessThanOrEqual(14_200);
    expect(text(doc.querySelector("#versions-heading"))).toBe("Versions · 304");
  });

  it("D-149: the support-matrix dialog is a shell and a skeleton: no tag row, the rows come from the package's own file", async () => {
    const doc = await readHtml(project.out, "/acme/big/");
    const host = doc.querySelector("[data-support-matrix]")!;
    expect(host.getAttribute("data-support-url")).toBe("/data/catalog/support/acme/big.json");
    expect(host.querySelectorAll("tbody tr")).toHaveLength(0);
    expect(host.querySelector("[data-matrix-table]")?.getAttribute("aria-busy")).toBe("true");
    expect(host.querySelectorAll("thead th").length).toBeGreaterThan(1);
    expect(host.querySelectorAll("[data-matrix-skeleton] .ocx-ui-skeleton__row").length).toBeGreaterThan(0);
    expect(host.querySelector("[data-matrix-more]")).toBeNull();
    const { rows } = JSON.parse(await readFile(join(project.out, "data/catalog/support/acme/big.json"), "utf8"));
    expect(rows).toHaveLength(304);
    expect(rows[0]).toMatchObject({ tag: "latest" });
  });

  it("D-149, D-053: the newest lines of each variant are in the HTML, the oldest are behind the lazy breakdown", async () => {
    const doc = await readHtml(project.out, "/acme/big/");
    const rows = [...doc.querySelectorAll("[data-versions-list] > .variant-row[data-variant]")];
    expect(rows.map((r) => r.getAttribute("data-variant"))).toEqual(["", "slim"]);
    expect(chips(rows[0]!, ".alias-chain [data-tag]")).toEqual(["latest", "1", "1.9", "1.9.13"]);
    const lines = chips(rows[0]!, "[data-breakdown] .minor-group > .chips [data-tag]");
    expect(lines.slice(0, 2)).toEqual(["1.9", "1.8"]);
    expect(rows[0]!.querySelector("[data-breakdown]")?.hasAttribute("data-lazy")).toBe(true);
    expect(doc.querySelector("[data-versions-more]")).toBeNull();
    expect(doc.querySelectorAll("link[rel='preload'][href$='/p/acme/big/_root.json']")).toHaveLength(1);
  });

  it("D-149: the releases of the tags the page does not draw are not in the page", async () => {
    const doc = await readHtml(project.out, "/acme/big/");
    const drawn = new Set(chips(doc, "[data-versions-list] [data-tag]"));
    const releases = doc.querySelectorAll("[data-releases] [data-release]").length;
    expect(drawn.size).toBeLessThan(150);
    expect(releases).toBeLessThanOrEqual(drawn.size);
  });

  it("D-149: no built script carries a tag the page does not prerender: the full table is build-only", async () => {
    const late = ["slim-1.0.13", "slim-1.5.7", "1.0.13", "1.5.7"];
    const doc = await readHtml(project.out, "/acme/big/");
    const drawn = new Set(chips(doc, "[data-versions-list] [data-tag]"));
    expect(late.filter((tag) => drawn.has(tag))).toEqual([]);

    const chunks = (await readdir(join(project.out, "_astro"))).filter((name) => name.endsWith(".js"));
    expect(chunks.length).toBeGreaterThan(0);
    for (const name of chunks) {
      const code = await readFile(join(project.out, "_astro", name), "utf8");
      for (const tag of late) expect(code, `${name} names ${tag}`).not.toContain(`"${tag}"`);
    }
  });

  it("D-149: the mirror holds the root the page preloads, with every tag", async () => {
    const root = JSON.parse(await readFile(join(project.out, "p/acme/big/_root.json"), "utf8")) as { tags: object };
    expect(Object.keys(root.tags)).toHaveLength(304);
  });
});
