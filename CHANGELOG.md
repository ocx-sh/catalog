# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

Initial release. This version ships the CLI surface, the `catalog.config.json`
loader and published JSON Schema, the VitePress theme (catalog grid, package
detail pages, docs layout, README sanitization), the CI workflow renderer
(`ocx-catalog ci`), and the source-resolution layer (`path`/`url`/`git`
readers) with its mirror/`catalog.json`/`_headers` emitters, wired end to end
into `ocx-catalog build`/`dev`: a real build renders one page per resolved
package, the merged `/data/catalog/catalog.json`, the `/index/<label>/`
mirror tree, and `_headers`. See the README's "Multi-source example" section
for the one open limitation (non-root sources' detail pages).

### Added

- `ocx-catalog` CLI (`build`, `dev`, `ci` subcommands; BSD `sysexits`-derived
  exit codes; `--version`/`--help`).
- `catalog.config.json` loader with fail-loud validation (unknown keys,
  source-discriminant checks, path-escape guards, `configVersion`
  forward-compat) and a published JSON Schema.
- VitePress theme: catalog grid, filter chips, search, package detail pages,
  docs layout, command palette, light/dark theming via CSS custom properties.
- Browser-side README sanitization (DOMPurify) with a GFM-aware allowlist.
- CI workflow renderer (`ocx-catalog ci [--check]`): renders, or drift-checks,
  the forge-specific job set (`github`/`gitlab`) from this package's own
  templates, carrying forward committed action/image pins and enforcing a
  versioned generated-file header.
- Source-resolution layer: `path`/`url`/`git` source readers, per-source
  mirror copy + `catalog.json` emission, and a Cloudflare Pages `_headers`
  file sandboxing every mirrored `/p/*` prefix.
- Local pack-verification gate (`npm pack` → `publint` → `attw --pack` →
  installed-tarball smoke, including a dependency-completeness check across
  every import reachable from the shipped package) as the pre-publish check.
