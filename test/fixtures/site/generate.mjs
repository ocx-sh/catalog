#!/usr/bin/env node
/**
 * Deterministic generator for the two OCX index trees the site fixtures
 * aggregate: `index-a/` (volume + status spread) and `index-b/` (hostile
 * content). No clock, no randomness: the same script always writes the same
 * bytes, and `fixtures.test.ts` re-runs it into a temp dir and compares the
 * result with the committed trees, so a hand-edit or a stale regeneration
 * fails the suite.
 *
 *   node test/fixtures/site/generate.mjs [outDir]   # default: this directory
 *
 * Wire shape (read, never redefined): `config.json`, `p/<ns>/<pkg>.json`
 * package roots, and content-addressed `p/<ns>/<pkg>/o/sha256/<hex>.<ext>`
 * blobs (OCI image indices, READMEs, logos) named by the sha256 of their
 * bytes. A package's `name` starts with its index's label, which is what
 * `labels.ts` derives the source label from.
 *
 * `wireBase` (C-041) is the one hostile field this tree cannot carry: it is
 * the source label, and `labels.ts` allowlists labels to `[A-Za-z0-9._-]`
 * before anything is built from them.
 */
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const DAY_MS = 86_400_000;
const isoDay = (offset) => new Date(Date.UTC(2026, 0, 1) + offset * DAY_MS).toISOString().slice(0, 10);
const isoTime = (offset) => `${isoDay(offset)}T09:00:00Z`;

const PLATFORMS = [
  { os: "linux", architecture: "amd64" },
  { os: "linux", architecture: "arm64" },
  { os: "darwin", architecture: "arm64" },
  { os: "windows", architecture: "amd64" },
];

const logoSvg = (title) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img"><title>${title}</title><rect width="32" height="32" rx="6" fill="#3b5bdb"/><text x="16" y="22" font-size="16" text-anchor="middle" fill="#fff">${title[0]}</text></svg>\n`;

/** One image index (the blob a tag's `content` digest names). */
function imageIndex(id, version, license) {
  const manifests = PLATFORMS.slice(0, 1 + (id % 4)).map((platform) => ({
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    digest: `sha256:${sha256(`${id}:${version}:${platform.os}/${platform.architecture}`)}`,
    size: 481,
    platform,
  }));
  return JSON.stringify({
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.index.v1+json",
    manifests,
    artifactType: "application/vnd.sh.ocx.package.v1",
    annotations: {
      "org.opencontainers.image.licenses": license,
      "org.opencontainers.image.source": `https://github.com/ocx-contrib/${id}`,
      "org.opencontainers.image.revision": sha256(`${id}:${version}`).slice(0, 40),
    },
  });
}

/**
 * Writes one package into `files` (wire path -> text) and returns nothing.
 * `spec.tags` is `[tagName, version, yanked?]`: tags sharing a `version`
 * share one image-index blob, like real alias tags do.
 */
function addPackage(files, label, spec, index) {
  const { ns, pkg } = spec;
  const dir = `p/${ns}/${pkg}`;
  const blob = (text, ext) => {
    const hex = sha256(text);
    files.set(`${dir}/o/sha256/${hex}.${ext}`, text);
    return `sha256:${hex}`;
  };

  const license = spec.license ?? "MIT";
  const contentByVersion = new Map();
  const tags = {};
  for (const [tag, version, yanked] of spec.tags) {
    if (!contentByVersion.has(version)) {
      contentByVersion.set(version, blob(imageIndex(`${ns}-${pkg}`, version, license), "json"));
    }
    tags[tag] = {
      content: contentByVersion.get(version),
      observed: isoTime(index),
      ...(yanked ? { yanked: { reason: yanked, at: isoDay(index + 30) } } : {}),
    };
  }

  const descBody = {
    title: spec.title ?? pkg,
    description: spec.description,
    keywords: spec.keywords,
  };
  const desc = { digest: `sha256:${sha256(JSON.stringify(descBody))}`, ...descBody };
  if (spec.readme !== undefined) desc.readme = blob(spec.readme, "md");
  if (spec.logo) desc.logo = blob(logoSvg(spec.title ?? pkg), "svg");

  const root = {
    name: `${label}/${ns}/${pkg}`,
    repository: `oci://ghcr.io/ocx-contrib/${ns}/${pkg}`,
    owners: spec.owners ?? [{ login: "ocx-bot", github: "ocx-bot", id: 309019509, github_id: 309019509 }],
    status: spec.status ?? "active",
    deprecated_message: spec.deprecatedMessage ?? null,
    ...(spec.supersededBy === undefined ? {} : { superseded_by: spec.supersededBy }),
    created: isoDay(index),
    upstream: spec.upstream ?? {
      org: ns,
      repository_url: `https://github.com/${ns}/${pkg}`,
      disclaimer: `Unaffiliated mirror of the upstream ${ns}/${pkg} project.`,
    },
    desc,
    tags,
  };
  files.set(`${dir}.json`, `${JSON.stringify(root, null, 2)}\n`);
}

const tagsFor = (versions) => {
  const newest = versions[versions.length - 1];
  const [major, minor] = newest.split(".");
  return [...versions.map((v) => [v, v]), [`${major}.${minor}`, newest], [major, newest], ["latest", newest]];
};

/** Image-free README: heading, prose, install block, list, table, plain link. */
function plainReadme(ns, pkg, description) {
  return [
    `# ${pkg}`,
    "",
    description,
    "",
    "## Install",
    "",
    "```sh",
    `ocx pull ${ns}/${pkg}@latest`,
    `ocx run ${ns}/${pkg} -- --help`,
    "```",
    "",
    "## Highlights",
    "",
    "- Ships as a single static binary.",
    "- Pinned by digest, never by moving tag.",
    "- Reads configuration from the environment.",
    "",
    "| Platform | Supported |",
    "| --- | --- |",
    "| linux/amd64 | yes |",
    "| darwin/arm64 | yes |",
    "",
    `See the [project page](https://example.com/${ns}/${pkg}) for details.`,
    "",
  ].join("\n");
}

/** [ns, pkg, description, keywords] for the ordinary index-a packages. */
const ORDINARY = [
  ["sharkdp", "bat", "A cat clone with syntax highlighting and Git integration.", ["cli", "pager", "syntax"]],
  ["sharkdp", "fd", "A simple, fast and user-friendly alternative to find.", ["cli", "find", "files"]],
  ["sharkdp", "hyperfine", "A command-line benchmarking tool.", ["cli", "benchmark", "performance"]],
  ["oxidize", "ripgrep", "Recursively search directories for a regex pattern.", ["cli", "search", "grep"]],
  ["oxidize", "delta", "A syntax-highlighting pager for git and diff output.", ["cli", "git", "diff"]],
  ["oxidize", "zoxide", "A smarter cd command that learns your habits.", ["cli", "shell", "navigation"]],
  ["cloud", "kubectl-lite", "A trimmed Kubernetes command-line client.", ["kubernetes", "cluster", "cli"]],
  ["cloud", "helm-lite", "A trimmed package manager for Kubernetes.", ["kubernetes", "charts", "cli"]],
  ["cloud", "terraform-lite", "A trimmed infrastructure-as-code planner.", ["infrastructure", "iac", "cli"]],
  ["lang", "nodejs-lite", "A minimal JavaScript runtime distribution.", ["javascript", "runtime"]],
  ["lang", "python-lite", "A minimal Python interpreter distribution.", ["python", "runtime"]],
  ["lang", "go-lite", "A minimal Go toolchain distribution.", ["go", "compiler"]],
  ["lang", "rust-lite", "A minimal Rust toolchain distribution.", ["rust", "compiler"]],
  ["db", "pgcli-lite", "A PostgreSQL client with auto-completion.", ["postgres", "sql", "cli"]],
  ["db", "sqlite-lite", "A self-contained SQL database engine shell.", ["sqlite", "sql", "embedded"]],
  ["db", "redis-lite", "An in-memory data store command-line client.", ["redis", "cache", "cli"]],
  ["net", "curl-lite", "Transfer data with URLs from the command line.", ["http", "download", "cli"]],
  ["net", "wget-lite", "Non-interactive network downloader.", ["http", "download", "cli"]],
  ["net", "httpie-lite", "A friendly HTTP client for the terminal.", ["http", "api", "cli"]],
  ["text", "jq-lite", "A lightweight JSON processor.", ["json", "query", "cli"]],
  ["text", "yq-lite", "A lightweight YAML processor.", ["yaml", "query", "cli"]],
];

function indexAFiles() {
  const files = new Map([["config.json", `${JSON.stringify({ format_version: 1 }, null, 2)}\n`]]);
  const specs = ORDINARY.map(([ns, pkg, description, keywords], i) => ({
    ns,
    pkg,
    description,
    keywords,
    readme: plainReadme(ns, pkg, description),
    logo: i % 2 === 0,
    tags: tagsFor(["1.0.0", "1.1.0", `1.${2 + (i % 3)}.0`]),
  }));

  const manyVersions = Array.from({ length: 24 }, (_, i) => `0.${i + 1}.0`);
  specs.push({
    ns: "tools",
    pkg: "many-tags",
    description: "Ships every release as its own tag, to exercise long version lists.",
    keywords: ["cli", "versions"],
    readme: plainReadme("tools", "many-tags", "Ships every release as its own tag."),
    logo: true,
    // 24 versions + `latest` = 25 tags exactly.
    tags: [...manyVersions.map((v) => [v, v]), ["latest", manyVersions[manyVersions.length - 1]]],
  });
  specs.push({
    ns: "tools",
    pkg: "modern",
    description: "The current successor of legacy/oldtool.",
    keywords: ["cli", "successor"],
    readme: plainReadme("tools", "modern", "The current successor of legacy/oldtool."),
    logo: true,
    tags: tagsFor(["2.0.0", "2.1.0"]),
  });
  specs.push({
    ns: "legacy",
    pkg: "oldtool",
    description: "First-generation tool, superseded by tools/modern.",
    keywords: ["cli", "deprecated"],
    readme: plainReadme("legacy", "oldtool", "First-generation tool, superseded by tools/modern."),
    status: "deprecated",
    deprecatedMessage: "Superseded by tools/modern, which covers every oldtool workflow.",
    supersededBy: "tools/modern",
    tags: tagsFor(["1.0.0", "1.4.0"]),
  });
  specs.push({
    ns: "legacy",
    pkg: "husk",
    description: "Withdrawn: every published build shipped a broken artifact.",
    keywords: ["cli", "yanked"],
    readme: plainReadme("legacy", "husk", "Withdrawn: every published build was broken."),
    status: "yanked",
    deprecatedMessage: "All builds withdrawn after a packaging defect dropped shared libraries.",
    tags: [
      ["0.2.0", "0.2.0", "Missing shared libraries on musl targets."],
      ["latest", "0.2.0", "Missing shared libraries on musl targets."],
    ],
  });
  specs.push({
    ns: "tools",
    pkg: "flaky",
    description: "Active package with one withdrawn release.",
    keywords: ["cli", "yanked-tag"],
    readme: plainReadme("tools", "flaky", "Active package with one withdrawn release."),
    tags: [
      ["0.9.1", "0.9.1", "Crashes on startup."],
      ["1.0.0", "1.0.0"],
      ["latest", "1.0.0"],
    ],
  });

  specs.forEach((spec, i) => addPackage(files, "index-a", spec, i));
  return files;
}

const HOSTILE_STRING = `x" onmouseover="alert(1)\n---\ntitle: pwned\n</script><img src=x onerror=alert(1)> \${process.env.SECRET}`;

const HOSTILE_README = [
  "# Hostile README",
  "",
  "<script>alert('script')</script>",
  "",
  "<img src=x onerror=alert('img')>",
  "",
  '<div onclick="alert(\'div\')" style="position:fixed;inset:0">raw html block</div>',
  "",
  "<svg><g onload=alert('svg')><foreignObject><math><mi><style><a title=\"</style><img src onerror=alert('mxss')>\"></mi></math></foreignObject></g></svg>",
  "",
  "<math><mtext><table><mglyph><style><!--</style><img title=\"--&gt;&lt;img src=1 onerror=alert('math')&gt;\">",
  "",
  "[plain javascript](javascript:alert('js'))",
  "",
  "[entity javascript](java&#9;script:alert('tab'))",
  "",
  "[protocol-relative](//evil.example/x)",
  "",
  "[root-relative](/x)",
  "",
  "[dot-relative](./x)",
  "",
  "[fine link](https://example.com/ok)",
  "",
  "![tracking pixel](https://evil.example/pixel.png)",
  "",
].join("\n");

const HOSTILE_KEYWORDS = ['"quoted"', "line\n---", "</script>", "${keyword}", "<img src=x onerror=alert(1)>"];

function indexBFiles() {
  const files = new Map([["config.json", `${JSON.stringify({ format_version: 1 }, null, 2)}\n`]]);
  const benign = (ns, pkg) => plainReadme(ns, pkg, "Fixture package.");
  const specs = [
    {
      ns: "hostile",
      pkg: "readme",
      description: "Carries a hostile README; every other field is ordinary.",
      keywords: ["hostile", "readme"],
      readme: HOSTILE_README,
      logo: true,
      tags: tagsFor(["1.0.0"]),
    },
    {
      // C-041: description, keywords, license, owner login, tag names,
      // supersededBy and the upstream links all carry hostile text.
      ns: "hostile",
      pkg: "metadata",
      description: HOSTILE_STRING,
      keywords: HOSTILE_KEYWORDS,
      license: `MIT"><img src=x onerror=alert(1)> \${LICENSE}`,
      readme: benign("hostile", "metadata"),
      status: "deprecated",
      deprecatedMessage: HOSTILE_STRING,
      supersededBy: HOSTILE_STRING,
      owners: [
        { login: '"><img src=x onerror=alert(1)>', github: '"><img src=x onerror=alert(1)>', id: 1, github_id: 1 },
        { login: "ocx-bot", github: "ocx-bot", id: 2, github_id: 2 },
      ],
      upstream: {
        org: HOSTILE_STRING,
        repository_url: "javascript:alert(1)",
        disclaimer: HOSTILE_STRING,
      },
      tags: [
        ["1.0.0", "1.0.0"],
        ['"quoted"', "1.0.0"],
        ["line\n---", "1.0.0"],
        ["</script>", "1.0.0"],
        ["${tag}", "1.0.0"],
        ["<img src=x onerror=alert(1)>", "1.0.0"],
        ["latest", "1.0.0"],
      ],
    },
    {
      // The source's `ownerUrl` template puts `{login}` in the host, so a
      // login that is not a valid host label makes `safeHref` return null.
      ns: "hostile",
      pkg: "ownerlink",
      description: "Owner login that cannot form a valid profile URL.",
      keywords: ["hostile", "owner"],
      readme: benign("hostile", "ownerlink"),
      owners: [{ login: "not/a-host", github: "not/a-host", id: 3, github_id: 3 }],
      tags: tagsFor(["1.0.0"]),
    },
    {
      ns: "hostile",
      pkg: "noreadme",
      description: "Publishes no README at all.",
      keywords: ["hostile", "readme-less"],
      logo: true,
      tags: tagsFor(["1.0.0"]),
    },
  ];
  specs.forEach((spec, i) => addPackage(files, "index-b", spec, i));
  return files;
}

/** Writes `index-a/` and `index-b/` under `outDir`, replacing any previous copy. */
export async function generate(outDir) {
  for (const [name, files] of [
    ["index-a", indexAFiles()],
    ["index-b", indexBFiles()],
  ]) {
    await rm(join(outDir, name), { recursive: true, force: true });
    for (const [path, text] of files) {
      const target = join(outDir, name, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, text);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await generate(process.argv[2] ?? dirname(fileURLToPath(import.meta.url)));
}
