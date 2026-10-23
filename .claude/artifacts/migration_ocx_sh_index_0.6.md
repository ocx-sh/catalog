# Migration notes: `ocx-sh/index` to `@ocx-sh/catalog` 0.6

Status: committed notes for the `ocx-sh/index` PR that adopts 0.6.0. Not
published. This repo never edits `../index`. Everything below was checked
against a read-only copy of `ocx-sh/index` at its current `main` and a real
0.6 build of its 17 docs files.

Sources of truth: ADR `adr_ocx_theme_port_2026-10-07.md` (D6 migration list,
release notes), plan contracts C-034 and C-049, scenario S-017. The consumer-facing
version of the breaking changes is the published page
`docs/src/content/docs/how-to/upgrade-to-0-6.md`.

## 1. Order of work

1. Release `@ocx-sh/catalog` 0.6.0 through the existing OIDC lane (this repo).
2. Land the `ocx-sh/index` PR below against `^0.6`.
3. Run the C-049 deployment gate (section 7) before `ocx.sh/catalog/` serves
   0.6.0 output. The `index.ocx.sh` deploy is unaffected by that gate.

## 2. Dependency and toolchain changes

| File | Change |
|---|---|
| `package.json` | Remove `vitepress` and `vue`. Bump `@ocx-sh/catalog` from `^0.5.0` to `^0.6`. |
| `bun.lock` | Regenerate. `bun install --frozen-lockfile` in `catalog-ci.yml` and `render-deploy.yml` fails on a stale lock. |
| Node | 0.6 needs Node >= 22.13. See the runner note below. |

Runner note: `bun x ocx-catalog build` executes the CLI's `node` shebang, so a
Node >= 22.13 must exist on the runner. Since commit `d42bb2f` the `ci`
renderer's bun variant provides it (`src/ci/render.ts`): on GitHub it emits
`actions/setup-node` (Node 22) before `oven-sh/setup-bun`, and on GitLab it uses
`node:22-alpine` plus `npm install -g bun@1`. Re-run `ocx-catalog ci` after the
bump and commit the result. The old bun render (setup-bun only, or
`oven/bun:1`) fails `ci --check` with `DRIFT`, and the rendered header names the
tool version. `render-deploy.yml` is hand-owned and takes a SHA-pinned
`actions/setup-node` step directly if `ubuntu-latest` ships a Node older than
22.13 (check `node --version`).

## 3. Config changes (ADR D6 migration list)

`catalog.config.json` and the generated `.catalog.config.render.json`
(`taskfile.yml` writes the latter with `jq`, overriding `sources[0].path`):

- Add `"base": "/catalog/"` for the `ocx.sh` deploy. Setting `siteUrl` to
  `https://ocx.sh/catalog/` implies it, and an explicit `base` must then equal
  that path (`BASE_SITEURL_MISMATCH` otherwise).
- Add `"chrome": "ocx"` for the `ocx.sh` deploy. `chrome: "ocx"` rejects
  `brand`, `nav`, `footer` and `docsNav` (`CHROME_OCX_CONFLICT`), so the
  `ocx.sh` render needs its own config variant without those four keys. The
  current config has the first three, and gains `docsNav` only if section 6
  asks for it. `chrome` is experimental.
- Keep a base-`/` config with `chrome` unset while `index.ocx.sh` still renders
  HTML. That site stays on Cloudflare Pages, where `_headers` is read.
- `favicon: "/favicon.svg"` is now catalog-root-relative and joined onto
  `base` by the page (an absolute `http(s)` URL is also accepted and used as
  written; `//host`, bare names and dot segments fail with exit 65). The file exists in `site/src/public/`, so the build check
  (the favicon must resolve to a copied file) passes. Under `chrome: "ocx"` the
  shell supplies `favicon.svg` unless `publicDir` ships one.
- `footer.links[].link: "/docs/privacy"` is joined onto `base`. Write it as
  `/docs/privacy/` so it does not depend on a host redirect.
- `docsNav` is optional. The default "docs" header entry links to `/docs/`,
  which `docs/index.md` serves (section 6). Under `chrome: "ocx"` it is a
  conflict.
- `nav[]` and `footer.links[]` entries with a dot segment (`.`, `..`, `%2e`)
  fail at load. The current links have none.
- No `publicDir` file may sit at a path the build writes (`_headers`,
  `robots.txt` is the exception: a consumer file wins), and `brand.logo`, `css`
  and `publicDir` entries may not share a file name. Each is exit 65 naming the
  file. 0.5.x let the generated file win silently.

Newly reserved names (ARCH-S3, `INDEX_LABEL_RESERVED`): `_astro`, `sitemap-*`,
`robots.txt`, `favicon*`, `pagefind`, the `brand.logo` and `css` file names and
every top-level `publicDir` entry, on top of `p`, `index`, `data`, `docs`,
`assets`, `404`, `public`, `c`, `config.json`, `_headers`. The check covers
non-root labels and the root source's namespaces. Run one build to confirm none
of the index's namespaces collide.

## 4. Build output location

`--out site/.vitepress/dist` becomes any directory outside `docs`/`publicDir`.
Use `dist`. The old path would still pass the 0.6 guard (it does not contain an
input), but the `.vitepress` name is now misleading.

Places that name the old path:

- `taskfile.yml`: `RENDER_OUT`, the `site:build` command, `site:preview`.
- `.github/workflows/render-deploy.yml`: `wrangler pages deploy site/.vitepress/dist`.
- `scripts/golden-baseline.sh` and its manifest (section 5).
- `.gitignore`: it already ignores `/dist/`.

Build order stays: `ocx-catalog build`, then `indexbot render --out` into the
same tree for `config.json`, `/p/**` and `/c/index.json`. In 0.6, `build`
replaces `--out` wholesale on success (rename aside, promote, remove old) and
leaves it untouched on failure. The `indexbot` pass must therefore stay after
the build, as it is now.

`--out` may not equal or contain the repo root (the config directory), `demo`,
`site/src/docs` or `site/src/public`, and may not lie inside the last two
(`OUT_DIR_OVERLAPS_INPUT`, exit 65).

## 5. Golden baseline

`scripts/golden-baseline.manifest` pins sha256 of every file in the VitePress
`dist` (232 lines, paths under `site/.vitepress/dist`, `@ocx-sh/catalog: 0.5.0`).

- Regenerate it from the 0.6 output: `scripts/golden-baseline.sh generate --update`
  after pointing the script's dist label at the new directory.
- `data/catalog/catalog.json` bytes are unchanged for the same input.
  Everything else differs: pages move from `<ns>/<pkg>.html` to
  `<ns>/<pkg>/index.html`, `assets/` becomes `_astro/`, and the sitemap becomes
  `sitemap-index.xml` plus `sitemap-0.xml`.
- Keep `_headers` an exact-match manifest entry, never an exempted extra. The
  script's own comment explains why (a silently dropped `/p/*` sandbox header).
  In 0.6 the file is base-prefixed, so its bytes change under a `base`.
- Run `generate --update` and the `verify` determinism pass twice. Astro's
  hashed asset names are expected to be stable for identical input, but the
  script's normalisation step is an identity copy today, so confirm it.

## 6. Redirects and trailing slashes

0.5 emitted `<ns>/<pkg>.html` served as `/<ns>/<pkg>` (`cleanUrls`). 0.6 emits
`<ns>/<pkg>/index.html` and every URL ends in `/`.

| Old URL (0.5) | New URL (0.6) |
|---|---|
| `/<ns>/<pkg>` | `/<ns>/<pkg>/` |
| `/<label>/<ns>/<pkg>` (non-root source) | `/<label>/<ns>/<pkg>/` |
| `/docs/<page>` (for example `/docs/privacy`) | `/docs/<page>/` |
| `/docs/<dir>/<page>` | `/docs/<dir>/<page>/` |
| `/docs/` (from `docs/index.md`) | `/docs/` (unchanged; `index.md` serves its directory) |
| `/docs/<dir>/` (from `<dir>/index.md`) | `/docs/<dir>/` (unchanged) |
| `/sitemap.xml` | `/sitemap-index.xml` plus `/sitemap-0.xml` |
| `/assets/*` | `/_astro/*` (hashed, never linked externally) |
| `/404.html` | `/404.html` |

Unchanged, relative to `base`: `/data/catalog/catalog.json`, `/config.json`,
`/c/index.json`, `/p/**`, `_headers`, `404.html`, `favicon.svg`, `robots.txt`.

Hosts: Cloudflare Pages serves a directory at `/x/` and redirects `/x` to it.
Bunny needs an explicit rule. Confirm both with `curl -sI` on one package URL
without the trailing slash before relying on it. Since `23b12cd`, `docs/index.md`
serves `/docs/` and `<dir>/index.md` serves `/docs/<dir>/`, so the default
"docs" header entry (`/docs/`) resolves and no `docsNav` override or extra
redirect is needed for those two rows.

`site:preview` called `vitepress preview site --port 4173`. Replace it with
`ocx-catalog dev --config .catalog.config.render.json` (live, `127.0.0.1`, first
free port from 4321, served under `base`) or any static server over `dist`.
`site:dev` already uses `ocx-catalog dev`.

## 7. The docs pages (17 Markdown files under `site/src/docs`)

The ADR counts 16 pages. The directory holds 17 `.md` files. Findings from a
real 0.6 build of all 17:

- **Link breakage: mostly fixed by the build now.** The first real build found
  80 internal links that resolved to missing pages, because pages are
  directories ending in `/` and `./m1-flip` from
  `/docs/ops/run-reconcile-dry-run/` landed one level too deep. Since `3b40302`
  `src/site/docs_markdown.ts` rewrites links in Markdown: relative links
  resolve against the `.md` file (extension dropped, `index.md` mapped to its
  directory, `?query` and `#fragment` kept, extensionless `./foo` accepted),
  and root-relative `/docs/...` or `/ns/pkg/` links get `base` prepended.
  External, `//`, `mailto:`, `#only` and relative non-`.md` links are left
  alone. These still need hand edits: links written as raw HTML (`<a href>`) are
  not rewritten, and `#fragment` targets that depend on a VitePress heading id
  (see the heading-id bullet below). Re-run the link check on the built
  `dist/docs/**` to find the remainder.
- **`{#id}` anchors** (13 occurrences: 12 in `how-to/announce-a-package.md`, 1 in
  `how-to/claim-a-namespace.md`). The suffix is not read, and still renders as
  visible text (decision S-010, unchanged). It stays in the heading text and its
  id (`prerequisite-prerequisite`). Drop the suffixes and fix the 9 in-page
  links that point at them to the generated ids.
- **`<span v-pre>`** (3 in `announce-a-package.md`): replace with plain inline
  code.
- **`::: details Future`** (`announce-a-package.md`, 2 container lines): shows as
  literal text. Use `<details><summary>Future</summary>…</details>`.
- **Heading ids differ from VitePress.** Cross-page fragments such as
  `./wire-format#c-index-json-—-enumeration-index` need the generated id
  (`cindexjson--enumeration-index`; `config-json` becomes `configjson`).
  Re-derive every `#fragment` from the built HTML.
- **Sidebar order**: add frontmatter `order` (a number) to each page. Groups are
  directories, sorted by name. Pages sort by `order`, then title.
- **Code blocks** (9 fenced: json, sh, yaml) lose highlighting. No action.
- Only `.md` is mounted, which matches the index's files.

Check after fixing: build, then verify every internal link and fragment in
`dist/docs/**`. lychee 0.24 cannot resolve a fragment on a directory-index
link, so check fragments by looking up element ids in the built HTML.

## 8. Accepted limitation: Bunny prune (C-034)

Bunny's deploy prune deletes stale `.html` only. A package removed from the
index loses its detail page, but its wire files under
`/catalog/p/<ns>/<pkg>.json` and everything beneath it stay reachable until a
`bunny:gc` exists. Taking down a hostile package needs a manual delete in
Bunny. Removing the entry from the index is not enough. This is decided
(SEC-D1) and documented in the published `ops/known-limitations` page.

## 9. Deployment gate before `ocx.sh/catalog/` goes live (C-049)

Bunny ignores `_headers`. The website-owned `catalog-sandbox` edge rule sets the
sandbox at `/catalog/p/*` and `/catalog/index/*/p/*`. Before 0.6.0 output is
served, prove it from outside:

```sh
curl -sI https://ocx.sh/catalog/p/<ns>/<pkg>.json
curl -sI https://ocx.sh/catalog/index/<label>/p/<ns>/<pkg>.json
```

Both responses must show:

```text
content-security-policy: sandbox
x-content-type-options: nosniff
```

If either line is missing on either URL, stop. This repo documents the gate and
does not run it. The owner or the `ocx-sh/index` hand-off runs it.

## 10. Security note for docs PRs

Consumer docs are trusted Markdown, rendered at build time into pages that
carry their own origin's privileges. A docs change is code: review it like
code, including raw HTML in Markdown and `<details>` blocks. Sanitisation
applies to package READMEs, not to the consumer's own `docs` tree.

READMEs follow a stricter policy than in 0.5: only absolute `http(s)`,
`mailto:` and `#fragment` links survive, and only absolute `http(s)` images.
Relative README links and images are removed.

## 11. Verification before merging the index PR

- `ocx-catalog build` exits 0 for both the base-`/` and the `/catalog/` configs.
- `data/catalog/catalog.json` is byte-identical to the 0.5.3 render for the
  same input.
- A link and fragment check over `dist/docs/**` finds nothing broken.
- No `publicDir` file collides with a generated path, and `css`/`brand.logo`
  have distinct file names (exit 65 otherwise).
- `curl -sI` shows the redirect (or a 200) for one trailing-slash-less package
  URL on each host.
- The C-049 probe passes on the Bunny deploy.
