# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

> **Registry note.** `v0.1.1` was tagged but **never published**: the release
> lane's publish job failed on a missing npm Trusted Publisher registration.
> Only `0.1.0` is installable from the npm registry today. This note lives in
> `cliff.toml`'s header because it is not derivable from git history, and a
> regeneration would otherwise drop it.

## [Unreleased]

### Added

- Per-page SEO head, robots.txt, bounded page writes; drop dead descLookup *(build)*
- Surface OCI license/source/repository on detail pages; validate nav links *(viewmodel)*
- A11y (h1/skip-link/list/aria/keyboard), route code-split, dynamic dompurify, emit-once logo *(theme)*

### Changed

- Delete the orphaned catalogPackageDetail *(viewmodel)*

### Documentation

- Initial-status review, ADR, and plan for SOTA release-ready round
- Correct published state, fix rule drift, complete schema/README reference

### Fixed

- Trim walker.ts Semaphore export to a bare one-word change *(build)*
- Bound symlink walk, tolerate dangling links, cap CAS assets, guard root shape *(sources)*
- Mirror-agnostic install, yanked status, fetch-error state, license/source display, wire-href validation *(theme)*
- Reject off-site superseded_by hrefs; guard empty landing h1 *(theme)*
- Keep Lighthouse CI off the WSL Chrome path *(quality)*
- Exclude quality:web scratch output, allow require in .cjs *(lint)*
- Close WCAG AA color-contrast, link-name, link-in-text-block a11y gaps *(theme)*

## [0.1.1] - 2026-08-22

### Documentation

- Date 0.1.0 release, add 0.1.1 changelog entry

### Fixed

- Make the release gate pass in CI (#2)

## [0.1.0] - 2026-08-22

### Added

- Initial commit of @ocx-sh/catalog
[unreleased]: https://github.com/ocx-sh/catalog/compare/v0.1.1..HEAD
[0.1.1]: https://github.com/ocx-sh/catalog/compare/v0.1.0..v0.1.1
[0.1.0]: https://github.com/ocx-sh/catalog/tree/v0.1.0

