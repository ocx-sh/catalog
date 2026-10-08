#!/usr/bin/env node
/**
 * Deterministic synthetic OCX index for scale probes (plan step E.7).
 *
 *   node scripts/synthetic-index.mjs <n> <readmeKB> <dir>
 *
 * Writes `<dir>/index/` (a root-source wire tree of <n> packages, each with an
 * image index and a unique ~<readmeKB> KB README, content-addressed like the
 * real thing) and `<dir>/catalog.config.json` pointing at it. No clock, no
 * randomness: the same arguments always write the same bytes.
 */
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const PER_NAMESPACE = 50;

/** Markdown of at least `bytes` bytes, unique per package. */
function readme(ns, pkg, bytes) {
  const parts = [`# ${pkg}`, "", `Synthetic README for ${ns}/${pkg}.`, ""];
  let size = 0;
  for (let section = 1; size < bytes; section++) {
    parts.push(
      `## Section ${section}`,
      "",
      `${ns}/${pkg} section ${section} ships as a single static binary, pinned by digest, never by moving tag. It reads its configuration from the environment and writes nothing outside its prefix. See the [project page](https://example.com/${ns}/${pkg}#s${section}) for details.`,
      "",
      "```sh",
      `ocx pull ${ns}/${pkg}@latest`,
      `ocx run ${ns}/${pkg} -- --section ${section}`,
      "```",
      "",
      "- Pinned by digest.",
      "- Verified on install.",
      "- Cleaned up on uninstall.",
      "",
      "| Platform | Supported |",
      "| --- | --- |",
      "| linux/amd64 | yes |",
      "| darwin/arm64 | yes |",
      "",
    );
    size = parts.join("\n").length;
  }
  return `${parts.join("\n")}\n`;
}

const [n, readmeKB, dir] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4]];
if (!Number.isInteger(n) || n < 1 || !Number.isFinite(readmeKB) || readmeKB < 0 || !dir) {
  console.error("usage: synthetic-index.mjs <n> <readmeKB> <dir>");
  process.exit(64);
}

const indexDir = join(dir, "index");
await rm(indexDir, { recursive: true, force: true });
const put = async (path, text) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
};

await put(join(indexDir, "config.json"), `${JSON.stringify({ format_version: 1 }, null, 2)}\n`);
for (let i = 0; i < n; i++) {
  const ns = `ns${String(Math.floor(i / PER_NAMESPACE)).padStart(4, "0")}`;
  const pkg = `pkg${String(i).padStart(5, "0")}`;
  const base = join(indexDir, "p", ns, pkg);
  const blob = async (text, ext) => {
    const hex = sha256(text);
    await put(join(base, "o", "sha256", `${hex}.${ext}`), text);
    return `sha256:${hex}`;
  };
  const manifests = ["amd64", "arm64"].map((architecture) => ({
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    digest: `sha256:${sha256(`${ns}/${pkg}:${architecture}`)}`,
    size: 481,
    platform: { os: "linux", architecture },
  }));
  const content = await blob(
    JSON.stringify({
      schemaVersion: 2,
      mediaType: "application/vnd.oci.image.index.v1+json",
      manifests,
      artifactType: "application/vnd.sh.ocx.package.v1",
      annotations: { "org.opencontainers.image.licenses": "MIT" },
    }),
    "json",
  );
  const body = { title: pkg, description: `Synthetic package ${i}.`, keywords: ["synthetic", ns] };
  const desc = { digest: `sha256:${sha256(JSON.stringify(body))}`, ...body };
  if (readmeKB > 0) desc.readme = await blob(readme(ns, pkg, readmeKB * 1024), "md");
  const day = `2026-01-${String(1 + (i % 28)).padStart(2, "0")}`;
  const tag = { content, observed: `${day}T09:00:00Z` };
  const root = {
    name: `synthetic/${ns}/${pkg}`,
    repository: `oci://ghcr.io/synthetic/${ns}/${pkg}`,
    owners: [{ login: "ocx-bot", github: "ocx-bot", id: 1, github_id: 1 }],
    status: "active",
    deprecated_message: null,
    created: day,
    upstream: { org: ns, repository_url: `https://github.com/${ns}/${pkg}`, disclaimer: "Synthetic." },
    desc,
    tags: { "1.0.0": tag, "1.0": tag, "1": tag, latest: tag },
  };
  await put(`${base}.json`, `${JSON.stringify(root, null, 2)}\n`);
}

await put(
  join(dir, "catalog.config.json"),
  `${JSON.stringify(
    {
      sources: [{ path: "./index", root: true }],
      brand: { title: "Synthetic Catalog", wordmark: "synthetic.ocx.test" },
      siteUrl: "https://synthetic.ocx.test",
      base: "/",
    },
    null,
    2,
  )}\n`,
);
