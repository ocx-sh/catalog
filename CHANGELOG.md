# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.5.1] - 2026-08-25

### Fixed

- Resolve system Chrome when no cached path is passed *(quality)*
- Separate the default index from the root index *(config,theme)*

## [0.5.0] - 2026-08-25

### Added

- Index-qualified routes and one name per index *(build,sources)* **BREAKING**
- A per-index scope for the catalog view *(theme)*
- Footer.links[], a configurable docs nav, and a real shortcut badge *(config,theme)* **BREAKING**
- A manual multi-index review harness *(dev)*

### Documentation

- Correct the claims this branch's own changes invalidated

### Fixed

- The toolbar narrows, facets AND, and the keyword rail rescores *(theme)*
- Pack-smoke reads .vue template comments as comments *(scripts)*

## [0.4.0] - 2026-08-25

### Added

- Read owners[] through the forge-neutral login field *(theme)* **BREAKING**

## [0.3.0] - 2026-08-24

### Added

- Make every colour reachable from a consumer stylesheet *(theme)*
- Tokenize border-width, weight, z-index and motion *(theme)*
- Move spacing onto the Carbon-shaped scale *(theme)*
- Data-slot identity contract and component hooks *(theme)*

### Changed

- Wrap theme CSS in @layer ocx *(theme)*
- Rename tokens to the --ocx-* namespace *(theme)* **BREAKING**

### Documentation

- Correct the CSS contract, generate the token reference, gate both

## [0.2.1] - 2026-08-24

### Documentation

- Use-case documentation site on GitHub Pages (#4)

### Fixed

- Resolve wire URLs against each source's own mirror prefix

## [0.2.0] - 2026-08-22

### Added

- State-of-the-art release readiness — task tooling, Lighthouse gate, a11y/perf/security round (#3)

## [0.1.1] - 2026-08-22

### Documentation

- Date 0.1.0 release, add 0.1.1 changelog entry

### Fixed

- Make the release gate pass in CI (#2)

## [0.1.0] - 2026-08-22

### Added

- Initial commit of @ocx-sh/catalog
[0.5.1]: https://github.com/ocx-sh/catalog/compare/v0.5.0..v0.5.1
[0.5.0]: https://github.com/ocx-sh/catalog/compare/v0.4.0..v0.5.0
[0.4.0]: https://github.com/ocx-sh/catalog/compare/v0.3.0..v0.4.0
[0.3.0]: https://github.com/ocx-sh/catalog/compare/v0.2.1..v0.3.0
[0.2.1]: https://github.com/ocx-sh/catalog/compare/v0.2.0..v0.2.1
[0.2.0]: https://github.com/ocx-sh/catalog/compare/v0.1.1..v0.2.0
[0.1.1]: https://github.com/ocx-sh/catalog/compare/v0.1.0..v0.1.1
[0.1.0]: https://github.com/ocx-sh/catalog/tree/v0.1.0

