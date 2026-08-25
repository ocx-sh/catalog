# Known limitations

Four behaviours a deployer needs to know about before picking a host or a
config shape. Each one is deliberate — none is a bug waiting on a fix — but
none is documented anywhere a user would trip over it first, so it's
collected here instead.

## 1. No subpath support

A generated catalog site only works when served from a domain root.
`src/build/config_gen.ts` never emits a VitePress `base:` setting, and every
client-side fetch the theme performs is a literal, root-relative string:
`src/theme/composables/useCatalog.ts` fetches `/data/catalog/catalog.json`,
`usePackageRoot.ts` fetches `` `/p/${ns}/${pkg}.json` ``, `useImageIndex.ts`
fetches `` `/p/${ns}/${pkg}/o/sha256/${hex}.json` `` — none of them are
prefixed by anything a `base:` config would normally supply.

**Consequence**: deploying under a path prefix (a GitHub Pages project site
at `/<repo>/`, for example) breaks every one of those fetches. The site must
be served at `https://example.com/`, not
`https://example.com/some-prefix/`.

## 2. `_headers` is Cloudflare Pages / Netlify format only

`src/sources/mirror.ts` emits a `_headers` file in the Cloudflare
Pages/Netlify path-pattern format. The product treats the two headers it
sets (`Content-Security-Policy: sandbox`, `X-Content-Type-Options: nosniff`
on every `/p/*` prefix) as a **hard deployment precondition** — the one
control sandboxing untrusted, same-origin mirrored content. On any host that
doesn't read that file format, it still ships to `dist/_headers` but is
completely inert.

**Consequence**: on GitHub Pages, a raw S3 bucket, or a self-managed
nginx/Caddy server, the sandboxing this package assumes exists has to be
recreated by hand in that host's own header mechanism, or accepted as a
known, named risk. See [Hosting and headers](hosting-and-headers.md).

## 3. The `docs:` mount's sidebar is hardcoded

`src/theme/components/docs/data/docsNav.ts` defines a fixed, static sidebar
— five groups (`REFERENCE`, `HOW-TO`, `OPS`, `EXPLANATION`, `LEGAL`) with a
fixed set of slugs under each (`/docs/reference/wire-format`,
`/docs/how-to/claim-a-namespace`, `/docs/ops/m1-flip`,
`/docs/explanation/architecture`, `/docs/privacy`, and a handful more). Those
groups and slugs are `ocx-sh/index`'s own docs tree, verified against that
project's file layout — not a generic, configurable navigation structure.

**Consequence**: pointing `docs` at any other content tree gets exactly this
sidebar rendered regardless of what pages actually exist underneath it.
Every link that doesn't correspond to a real page in your own `docs` tree
404s; any page you have that isn't one of these fixed slugs has no sidebar
entry at all.

## 4. `ocx-catalog ci` supports exactly two forges, and deploys nothing

`src/ci/types.ts`'s `Forge` type (mirroring `CiConfig["forge"]`) accepts
only `"github"` and `"gitlab"` — no other forge is rendered. And on either
forge, the rendered workflow builds the site and stops: `templates/ci/github-ci.yml`
runs `ocx-catalog build` and nothing after it; `templates/ci/gitlab-ci.yml`
runs the same build and uploads `dist` as an artifact. Neither template
publishes to GitHub Pages, GitLab Pages, Cloudflare Pages, Netlify, or
anywhere else.

**Consequence**: the deploy step — whatever it is for your chosen host — is
something you add to the generated workflow yourself; `ocx-catalog ci`
gives you the build, not the publish.

## What to check before choosing a host

- Will the site be served at a true domain root, not a path prefix? (#1)
- Does the host read a Cloudflare Pages/Netlify-style `_headers` file, and
  if not, are you translating those two headers yourself or accepting the
  risk knowingly? (#2)

Full host-by-host answers: [Hosting and headers](hosting-and-headers.md).
