---
title: "Upgrade to 0.6"
sidebar:
  order: 7
---
<!-- doc_type: how-to -->
<!-- doc_tier: integration -->

Upgrade a catalog from `@ocx-sh/catalog` 0.5.x to 0.6.0. Version 0.6.0 is a
breaking release. It replaces the VitePress renderer with Astro, so this page
lists every change a corporate mirror or other consumer must act on.

## Before you start

- Read the sixteen notes below. Notes 1, 3, 4, 5, 6 and 7 can stop a build.
  Note 2 breaks code that imports the removed theme. Notes 8 to 16 change what
  visitors, hosts and tooling see.
- Run `ocx-catalog build` from a clean checkout after you upgrade. Compare the
  output against your last 0.5.x deploy before you publish.
- Keep your 0.5.x `dist/` until the new one is verified. A failed 0.6 build
  leaves the previous output in place.

## Release notes

1. **Node 22.13 or later is required.** In 0.6.0, `engines.node` is `>=22.13`.
   The `vitepress` and `vue` peer dependencies are gone. Remove them from your
   `devDependencies` and from any install command, because nothing needs
   installing beside `@ocx-sh/catalog`.

   The `bun` variant of `ocx-catalog ci` provides Node too, from 0.6.0. On
   GitHub it adds `actions/setup-node` before `oven-sh/setup-bun`. On GitLab it
   uses `node:22-alpine` and runs `npm install -g bun@1`, instead of
   `oven/bun:1`. Re-render with `ocx-catalog ci` and commit the result, or
   `ci --check` reports drift.

2. **`@ocx-sh/catalog/theme` is removed.** The `@layer ocx` override contract,
   the `data-slot` hooks and the `--ocx-*` component hooks go with it, with no
   replacement. Delete any import of `@ocx-sh/catalog/theme`. Your `css` file
   still wins over the theme, because every theme rule sits in a cascade layer.

   Only `:root` token overrides are expected to survive upgrades, because the
   theme has no stable selector contract. See
   [Custom stylesheet](../customize-branding-and-docs/#custom-stylesheet).

3. **Two new keys, and some paths change meaning.** `base` deploys the site
   under a sub-path. `chrome` selects `neutral` (the default) or the
   experimental `ocx` shell.

   If your 0.5.x `siteUrl` has a path, that path
   becomes the default `base` in 0.6.0. A `siteUrl` path with characters outside
   letters, digits, `.`, `_` and `-` fails with `BASE_INVALID`.

   In 0.6.0, `favicon`, `docsNav[].link` and any `nav[]` or `footer.links[]`
   entry that starts with `/` are relative to `base`. A `favicon` may also be an
   absolute `http(s)` URL, which is used as written. A `//host` value, a bare
   file name, a `javascript:` value or a path with a dot segment (`.`, `..` or
   `%2e`) fails with `INVALID_TYPE`. The dot-segment rule applies to every link.

   Under `chrome: "ocx"`, `docsNav` fails with `CHROME_OCX_CONFLICT`, like
   `brand`, `nav` and `footer`. See
   [`base`](../../reference/config-schema/#base) and
   [`chrome`](../../reference/config-schema/#chrome).

4. **More names are reserved.** A source label or root-source namespace that
   equals a top-level name the build writes fails with `INDEX_LABEL_RESERVED`.
   The set covers `_astro`, `sitemap-*`, `robots.txt`, `favicon*`, `pagefind`,
   the `brand.logo` and `css` file names, and every top-level `publicDir` entry.
   A 0.5.x config that loaded can stop loading, so rename the index or move
   the namespace. See [Reserved names](../../reference/config-schema/#reserved-names).

5. **`--out` may not overlap an input.** The output directory cannot equal or
   contain any input tree, and cannot sit inside `docs` or `publicDir`. A
   violation fails with `OUT_DIR_OVERLAPS_INPUT` and exit `65`, and a failed
   build leaves the previous output untouched. Choose a directory such as
   `dist`. See
   [Output-directory safety](../../reference/cli/#output-directory-safety).

6. **A public file may not shadow a generated file.** Version 0.5.x let the
   generated file win silently. In 0.6.0 the build fails with exit `65` and
   names the file in two cases.

   First, a `publicDir` file such as `_headers`
   sits at a path the mirror or the build writes. Second, `css` or `brand.logo`
   has the same file name as a different `publicDir` file or as each other.
   Rename one of the two, or move one out of `publicDir`. A logo or stylesheet
   that lives directly in `publicDir` and is that very file is not a collision.

7. **Malformed input fails with exit `65`.** A docs page whose frontmatter is
   not valid YAML fails the build. So does a package root whose `owners`,
   `source` or `superseded_by` field has the wrong type. The message reads
   `malformed root at <path>` and names the source. Fix the file at its source.

8. **Detail-page and docs URLs end in `/`.** Every page is a directory with an
   `index.html`. This covers docs pages too, so `/docs/privacy` becomes
   `/docs/privacy/`.

   Most static hosts redirect the 0.5.x form `/ns/pkg` to
   `/ns/pkg/`. Check that yours does, and update any hard-coded links.

   Two build outputs also moved. `/sitemap.xml` is replaced by
   `/sitemap-index.xml` plus `/sitemap-0.xml`. `/assets/*` is replaced by
   `/_astro/*`. The hashed asset names were never meant to be linked from
   outside.

9. **`catalog.json` URL fields stay catalog-root-relative.** The `logoUrl` and
   `readmeUrl` values in `/data/catalog/catalog.json` never carry `base`. A
   value starts with `/p/`, never with `/catalog/p/`. Every reader joins
   `base` itself, so a script that fetches those URLs must do the same. See
   [Output layout](../../reference/output-layout/#catalogjson-url-fields).

10. **The palette searches packages only.** The Mod+K palette does not search
    docs text in 0.6.0. Sort and view choices live in the URL. The stored view,
    sort and install-pin preferences from 0.5.x are gone.

11. **The docs mount takes plain Markdown, and rewrites its links.** VitePress-only
    syntax and code highlighting are not supported. A `{#id}` heading suffix
    shows as visible text, so drop it. Sidebar order comes from frontmatter
    `order`, and only `.md` files are mounted.

    The build rewrites links to pages. A relative `.md` or extensionless link
    resolves against its own file and becomes a directory route. A root-relative
    link gains `base`. A link inside raw HTML (`<a href>`) is not rewritten.

    `docs/index.md` serves `/docs/`, and `<dir>/index.md` serves `/docs/<dir>/`.
    See [Docs mount](../customize-branding-and-docs/#docs-mount).

12. **README links are neutralised.** A README link survives only as an absolute
    `http(s)` URL, a `mailto:` URL or a `#fragment`. Any other link becomes its
    text, and any other image is dropped. Relative README links never resolved
    correctly on the catalog's own host.

13. **Pages carry a CSP `<meta>` tag.** Each page declares a
    Content-Security-Policy. It allows scripts from the page's own origin plus
    hashes of the inline scripts the build ships. Your `css` file is
    unaffected. An inline script injected by a host proxy is blocked.

14. **`_headers` is still emitted, prefixed with `base`.** It remains a hard
    deployment precondition on hosts that do not read it. Translate its rules
    into your host's own mechanism, and include the `base` in each path. Bunny
    ignores the file. See [Hosting and headers](../../ops/hosting-and-headers/).

15. **The CLI keeps its 0.5.x surface, and large indices may need a heap hint.**
    `ocx-catalog build`, `dev` and `ci`, their flags, their exit codes and every
    multi-index key keep their meaning. In 0.6.0, `dev` runs an Astro server on
    `127.0.0.1`. `build` also holds `SIGINT` and `SIGTERM` until it has cleaned
    up. See [Signals](../../reference/cli/#signals).

    At 10,000 packages the CLI process is the largest. Without a cap it peaked
    at 2.76 to 2.91 GiB RSS, mostly garbage not yet collected. A forced-GC probe
    held it near 1.15 GiB. The Astro child peaked at 1.0 to 1.16 GiB.

    With `NODE_OPTIONS=--max-old-space-size=1792` the CLI peaked at 1.65 to
    1.69 GiB with no heap error. `NODE_OPTIONS` reaches both processes, because
    the child inherits the environment. These runs needed no flag on a host with
    about 7 GB of RAM or more. Smaller hosts were not tested. If a build dies
    with a JavaScript heap error, set the flag.

16. **The documentation site moves to `ocx.sh/apps/catalog/`.** The docs used
    to live at `ocx-sh.github.io/catalog/`. That URL serves the last 0.5.x
    docs until the owner runs the `redirect-stubs` job in `pages.yml`, which
    replaces it with redirect stubs.

    A stub exists for each page only. A meta-refresh stub cannot see a
    `#fragment`, so a deep link to a section lands at the top of the new page.
    Heading ids may also differ after the move. Update bookmarks and links in
    your own docs. The old-to-new map is in `docs/redirects.json`.

## After you upgrade

- Run `ocx-catalog build` and open the output with a static file server.
- If you serve under a path prefix, confirm `base` matches it. See
  [Hosting and headers](../../ops/hosting-and-headers/#serving-under-a-base).
- If `_headers` is inert on your host, run the header probe in
  [Hosting and headers](../../ops/hosting-and-headers/#probe-the-headers-after-you-deploy).
- Read [Known limitations](../../ops/known-limitations/) for the behaviours that
  stay deliberate.
