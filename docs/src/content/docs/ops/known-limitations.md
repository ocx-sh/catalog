---
title: "Known limitations"
sidebar:
  order: 1
---
<!-- doc_type: explanation -->

These behaviours are deliberate. A deployer needs to know them before picking
a host or a config shape. Each section says what happens and what to do about it.

## One build serves one URL prefix

The site is built for a single URL prefix. Set `base` in `catalog.config.json`,
or give `siteUrl` a path, and every link, asset and data fetch carries that
prefix. The default is `/`.

A build is not portable between prefixes. To serve the same catalog under a
different prefix, rebuild with a different `base`. `ocx-catalog dev` serves
under the same `base`, so the preview URL includes it.

**Consequence**: a GitHub Pages project site at `/<repo>/` works when you set
`"base": "/<repo>/"`. See [Config schema](../../reference/config-schema/#base)
and [Hosting and headers](../hosting-and-headers/).

## `_headers` is Cloudflare Pages and Netlify format only

`ocx-catalog build` writes a `_headers` file in the Cloudflare Pages and
Netlify path-pattern format. It sets two headers on every mirrored `/p/*`
prefix: `Content-Security-Policy: sandbox` and `X-Content-Type-Options: nosniff`.
Under a `base`, every pattern is prefixed with it.

The product treats those headers as a **hard deployment precondition**. They
are the one control that sandboxes untrusted, same-origin mirrored content.
On any host that does not read the file format, `_headers` ships but is inert.

**Consequence**: on GitHub Pages, a raw S3 bucket, or a self-managed nginx or
Caddy server, recreate the two headers in that host's own mechanism. Or accept
the risk knowingly. See [Hosting and headers](../hosting-and-headers/).

## Bunny CDN deploys

`ocx.sh/catalog/` is served from Bunny CDN. Three facts apply to any Bunny
deploy of a catalog build.

### `_headers` is not read on Bunny

Bunny ignores `_headers`. The sandbox comes from an edge rule named
`catalog-sandbox`, owned by the ocx.sh website deploy. It sets both headers
at `/catalog/p/*` and `/catalog/index/*/p/*`. A Bunny deploy without that rule
serves mirrored content unsandboxed.

### Removed packages stay reachable

The deploy prune deletes stale `.html` files only. A package removed from the
index loses its detail page, but its wire files keep answering. That covers
`/catalog/p/<ns>/<pkg>.json` and everything beneath it.

Those files stay reachable until a `bunny:gc` task exists. Taking down a
hostile package therefore needs a manual delete in Bunny. Removing it from the
index is not enough.

### Deployment gate before a release goes live

Before `ocx.sh/catalog/` serves a new build, probe one package root and one
per-index package root:

```sh
curl -sI https://ocx.sh/catalog/p/<ns>/<pkg>.json
curl -sI https://ocx.sh/catalog/index/<label>/p/<ns>/<pkg>.json
```

Both responses must carry these two headers:

```text
content-security-policy: sandbox
x-content-type-options: nosniff
```

If either header is missing, do not publish. This package never runs the probe.
The deployer does.

## The docs mount renders a restricted Markdown dialect

The `docs` directory is mounted at `/docs/**`. The sidebar is generated from
the tree: directories become groups, and pages sort by frontmatter `order`,
then title. The mount has these limits:

- Only `.md` files are mounted. `.mdx` files are ignored.
- VitePress-only syntax is not interpreted. `::: details` blocks and `{#id}`
  heading anchors show as plain text.
- Code blocks are not syntax-highlighted.
- The build rewrites links to pages. A relative link, with or without `.md`,
  resolves against its own file and becomes a directory route under `base`.
  A root-relative link such as `/docs/install/` gains `base`. External links,
  `mailto:`, `#fragment` links and relative links to non-page files are left
  alone. A link inside raw HTML (`<a href>`) is **not** rewritten.
- `docs/index.md` is the page at `/docs/`, and `<dir>/index.md` is the page at
  `/docs/<dir>/`. Without a `docs/index.md`, there is no page at `/docs/`, so
  name pages that exist in `docsNav`.

**Consequence**: a docs tree written for VitePress needs a small pass before
it renders cleanly. Drop the `{#id}` suffixes and rewrite raw HTML anchors. See [Branding and docs mount](../../how-to/customize-branding-and-docs/#docs-mount).

## The palette searches packages only

The Mod+K command palette searches package names and descriptions. It does not
search docs text. View and sort choices live in the URL. The stored view, sort
and install-pin preferences from 0.5.x are gone.

## README links are neutralised

A README link survives only when it is an absolute `http(s)` or `mailto:` URL,
or a `#fragment`. Any other link becomes its text. Images survive only as
absolute `http(s)` URLs. Relative paths never resolved correctly on the
catalog's own host, so they are dropped rather than guessed.

## `chrome: "ocx"` is experimental

`chrome: "ocx"` renders the ocx.sh header and footer. It exists for the
ocx.sh deployment and carries no stability promise between releases. It also
rejects `brand`, `nav`, `footer` and `docsNav`, because the shell owns them. Use the
default `neutral` chrome for any other site.

## `ocx-catalog ci` supports two forges and deploys nothing

The `Forge` type in `src/ci/types.ts` accepts only `"github"` and `"gitlab"`.
On either forge the rendered workflow builds the site and stops.
`templates/ci/github-ci.yml` runs `ocx-catalog build`.
`templates/ci/gitlab-ci.yml` runs the same build and uploads `dist` as an
artifact. Neither template publishes to any host.

**Consequence**: the deploy step is yours to add to the generated workflow.
`ocx-catalog ci` gives you the build, not the publish.

## What to check before choosing a host

- Which URL prefix will serve the site, and does `base` match it?
- Does the host read a Cloudflare Pages or Netlify `_headers` file? If not, are
  you translating the two headers yourself or accepting the risk knowingly?
- On Bunny, is the `catalog-sandbox` edge rule in place, and did both probe
  commands show the headers?

Full host-by-host answers: [Hosting and headers](../hosting-and-headers/).
