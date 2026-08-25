import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCatalog } from "../../src/build/engine.js";
import { compareQualifiedIds } from "../../src/sources/mirror.js";
import { readPathSource } from "../../src/sources/path.js";
import { extractPackages } from "../../src/sources/types.js";
import { catalogIndex, serializeCatalog } from "../../src/viewmodel/catalog.js";
import { withTempDir } from "./helpers.js";
import { rootJsonBytes, sha256Digest, utf8 } from "../sources/helpers.js";

/*
 * The defect this file exists to keep fixed: `buildCatalog()` used to render
 * a zero-package catalog for ANY config — the source layer was fully
 * implemented but had no caller. This is the real CLI path end to end, no
 * mocks: a real `catalog.config.json` -> real source reading -> a real
 * `vitepress build()` -> real bytes in `dist/`, asserting the whole
 * resolved-source -> catalog -> pages -> mirror path landed.
 *
 * The fixture is deliberately depth-MIXED (`acme/widget` and
 * `acme/tools/gadget`): package paths are opaque 1..N segments, never a
 * fixed two-segment split ([ocx-sh/index#716]).
 */

const BRAND_TITLE = "E2E Sources Test";
/** S-007 identity strings — the shapes the pre-extraction index site
 * emitted, reproduced here from config alone (nothing deployment-specific is
 * baked into the package). */
const FAVICON_HREF = "/favicon.svg";

const IMAGE_INDEX = utf8(
  JSON.stringify({
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.index.v1+json",
    manifests: [
      {
        mediaType: "application/vnd.oci.image.manifest.v1+json",
        digest: `sha256:${"b".repeat(64)}`,
        size: 512,
        platform: { os: "linux", architecture: "amd64" },
      },
    ],
  }),
);
const IMAGE_INDEX_DIGEST = sha256Digest(IMAGE_INDEX);

const WIDGET_ROOT = rootJsonBytes({
  name: "ocx.sh/acme/widget",
  created: "2026-01-01",
  desc: { title: "Widget", description: "The widget package.", keywords: ["widget"] },
  tags: { "1.0.0": { content: IMAGE_INDEX_DIGEST, observed: "2026-01-02T00:00:00Z" } },
});
const GADGET_ROOT = rootJsonBytes({ name: "ocx.sh/acme/tools/gadget", created: "2026-01-03" });

const WIRE_TREE: Readonly<Record<string, Uint8Array>> = {
  "config.json": utf8(JSON.stringify({ format_version: 1 })),
  "p/acme/widget.json": WIDGET_ROOT,
  [`p/acme/widget/o/sha256/${IMAGE_INDEX_DIGEST.slice("sha256:".length)}.json`]: IMAGE_INDEX,
  "p/acme/tools/gadget.json": GADGET_ROOT,
};

async function writeFixture(configDir: string): Promise<string> {
  for (const [relPath, bytes] of Object.entries(WIRE_TREE)) {
    const full = join(configDir, "index", relPath);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, bytes);
  }
  // The icon asset ships the way a real deployment ships it — through
  // `publicDir`; `favicon` below is only the href baked into every page.
  await mkdir(join(configDir, "public"), { recursive: true });
  await writeFile(join(configDir, "public", "favicon.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>', "utf8");
  const configPath = join(configDir, "catalog.config.json");
  await writeFile(
    configPath,
    JSON.stringify({
      sources: [{ path: "index", root: true, label: "ocx.sh" }],
      brand: { title: BRAND_TITLE },
      publicDir: "public",
      favicon: FAVICON_HREF,
    }),
    "utf8",
  );
  return configPath;
}

describe("C-003/C-005/C-006 buildCatalog — a configured source reaches dist/ end to end", () => {
  it(
    "renders every package's page, the merged catalog, the mirror tree and _headers",
    async () => {
      await withTempDir("catalog-sources-e2e-", async (configDir) => {
        const configPath = await writeFixture(configDir);

        await withTempDir("catalog-sources-e2e-out-", async (outDir) => {
          await buildCatalog({ configPath, outDir });

          // 1. The catalog view model the theme fetches — byte-identical to
          // the same view model built directly off the source reader, GIVEN
          // the same `indexes` envelope. The build emits that envelope for
          // every catalog, one source included, because the theme resolves
          // every package's route through it; the Python-bot byte gate sits
          // on `catalogIndex` itself (`test/golden/**` calls it with one
          // argument), not on what the pipeline chooses to pass.
          const files = await readPathSource({ path: "index" }, configDir);
          const expectedCatalog = serializeCatalog(
            catalogIndex([...extractPackages(files)].sort(compareQualifiedIds), [
              { name: "ocx.sh", root: true, default: true, count: 2 },
            ]),
          );
          const writtenCatalog = await readFile(join(outDir, "data", "catalog", "catalog.json"), "utf8");
          expect(writtenCatalog).toBe(expectedCatalog);
          const parsed = JSON.parse(writtenCatalog) as { packages: { namespace: string; package: string }[] };
          expect(parsed.packages.map((entry) => `${entry.namespace}/${entry.package}`)).toEqual([
            "acme/tools/gadget",
            "acme/widget",
          ]);

          // 2. One real detail page per package, at its own depth.
          const [widgetPage, gadgetPage] = await Promise.all([
            stat(join(outDir, "acme", "widget.html")).then((stats) => stats.isFile()),
            stat(join(outDir, "acme", "tools", "gadget.html")).then((stats) => stats.isFile()),
          ]);
          expect([widgetPage, gadgetPage]).toEqual([true, true]);

          // 3. descLookup reached the generated config's transformHead: the
          // package's OWN desc title, not the generic `<ns>/<pkg>` fallback.
          const widgetHtml = await readFile(join(outDir, "acme", "widget.html"), "utf8");
          expect(widgetHtml).toContain(`<meta property="og:title" content="Widget — ${BRAND_TITLE}">`);
          const gadgetHtml = await readFile(join(outDir, "acme", "tools", "gadget.html"), "utf8");
          expect(gadgetHtml).toContain(`<meta property="og:title" content="acme/tools/gadget — ${BRAND_TITLE}">`);

          // 3b. S-007 identity surface, from real emitted HTML: the
          // `favicon` href reaches every page's <head> as a typed icon link
          // (and its asset really lands at that href, via publicDir), and a
          // package with NO desc gets the theme's FIXED description template
          // with `{name}` -> `<ns>/<pkg>` and brand.title substituted in —
          // the two regressions the pre/post-extraction byte diff caught.
          const iconLink = `<link rel="icon" type="image/svg+xml" href="${FAVICON_HREF}">`;
          expect(widgetHtml).toContain(iconLink);
          expect(gadgetHtml).toContain(iconLink);
          expect(await stat(join(outDir, "favicon.svg")).then((stats) => stats.isFile())).toBe(true);

          const gadgetDesc = `Install acme/tools/gadget from ${BRAND_TITLE}.`;
          expect(gadgetHtml).toContain(`<meta property="og:description" content="${gadgetDesc}">`);
          expect(gadgetHtml).toContain(`<meta name="description" content="${gadgetDesc}">`);
          // A package that HAS a desc still wins over the template.
          expect(widgetHtml).toContain('<meta name="description" content="The widget package.">');

          // 4. C-006 mirror: byte-verbatim wire tree at the dist root (the
          // root:true source) AND under index/<label>/.
          const [rootCopy, labelCopy, casCopy] = await Promise.all([
            readFile(join(outDir, "p", "acme", "widget.json")),
            readFile(join(outDir, "index", "ocx.sh", "p", "acme", "widget.json")),
            readFile(
              join(
                outDir,
                "p",
                "acme",
                "widget",
                "o",
                "sha256",
                `${IMAGE_INDEX_DIGEST.slice("sha256:".length)}.json`,
              ),
            ),
          ]);
          expect(rootCopy).toEqual(Buffer.from(WIDGET_ROOT));
          expect(labelCopy).toEqual(Buffer.from(WIDGET_ROOT));
          expect(casCopy).toEqual(Buffer.from(IMAGE_INDEX));

          // 5. The Cloudflare Pages header rules covering both mirror prefixes.
          const headers = await readFile(join(outDir, "_headers"), "utf8");
          expect(headers).toContain("/p/*\n  Content-Security-Policy: sandbox");
          expect(headers).toContain("/index/ocx.sh/p/*\n  Content-Security-Policy: sandbox");
        });
      });
    },
    60_000,
  );
});
