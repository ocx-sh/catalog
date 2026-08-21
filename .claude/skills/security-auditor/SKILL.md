---
name: security-auditor
description: Use for security audits, threat modelling, vulnerability assessment, or evaluating the attack surface of a new capability before merge — untrusted-source ingestion (path/url/git readers), the generated-CI-workflow renderer, or the npm publish pipeline. Trigger: /security-auditor.
user-invocable: true
argument-hint: "scope-or-component"
triggers:
  - "security audit"
  - "threat model"
  - "vulnerability assessment"
  - "attack surface"
  - "security review"
---

# Security Auditor

Role: security compliance, threat modeling, vulnerability assessment for
`@ocx-sh/catalog`. This package's core job is reading data it does not
control — a source's `path`/`url`/`git` tree can come from a hostile
repository — and turning it into files on disk and a rendered static site,
so most real findings live in the source-ingestion layer, not a classic
web-app surface (no server, no auth, no SQL).

## Workflow

1. **Map surface** — Grep/Glob for entry points and data flows: `src/sources/**`
   (untrusted remote data in), `src/config/**` (untrusted `catalog.config.json`),
   `src/ci/**` + `templates/ci/*.yml` (this package's own output becomes
   *another* repo's privileged CI config), `.github/workflows/**` (this
   package's own CI/release pipeline).
2. **Enumerate threats** — STRIDE (Spoofing, Tampering, Repudiation,
   Information Disclosure, DoS, Elevation).
3. **Trace data** — follow a value from where it enters (a source's root
   JSON, a `/c/index.json` entry, a git ref, a config field) to where it's
   used (a filesystem path, a shell/`execFile` arg, rendered HTML, a
   generated YAML file).
4. **Document** — findings with severity and CWE IDs.
5. **Report** — present findings directly, prioritized by severity. For an
   audit substantial enough to be worth keeping, persist as
   `.agents/research/security_audit_<topic>.md` (the same convention
   `/hex-plan` uses for research artifacts) rather than inventing a new
   location.

## Known Attack Surfaces (verify current state — don't trust this list from memory)

| Surface | Concern | Where |
|---|---|---|
| `url` source fetch | SSRF via redirect, protocol downgrade, unbounded body | `src/sources/walker.ts` — https-only, `redirect: "manual"`, `MAX_RESPONSE_BYTES` |
| Digest-driven paths | Path traversal via a malformed `sha256:` string used before the fetch that would validate it | `walker.ts`'s `casCachePath`/`assertSafeQualifiedId` — `DIGEST_RE.test()` fullmatch before any path join |
| `path`/`git` source containment | Symlink escape out of the source root | `src/sources/path.ts`'s `resolveContainedRealPath` — realpath-verified per file, not once at the root |
| `git` source args | Shell/option injection via `entry.git`/`entry.ref`/`entry.dir` | `src/sources/git.ts` — `execFile` array args, `--` separator, leading-`-` rejection |
| Derived source labels | Control-character injection into the shared `_headers` file | `labels.ts`'s `assertLabelPathSafe` — must stay an allowlist regex, not a blocklist |
| README rendering | XSS via a hostile package's `desc.readme` markdown | `markdown-it` + `dompurify` in the theme — verify sanitization runs on every render path, not just the common one |
| Generated CI workflows | This package's own output becomes privileged YAML in a consumer repo | `src/ci/**`, `templates/ci/*.yml` — default-deny `permissions:`, no untrusted-value `run:` interpolation in what gets generated |
| npm publish | Credential/scope escalation via a compromised transitive dependency | `.github/workflows/release.yml` — OIDC trusted publishing, `id-token: write` isolated to `publish`, `npm ci --ignore-scripts` there specifically |

## Relevant Rules (load explicitly for planning)

- [`subsystem-sources.md`](../../rules/subsystem-sources.md) — the actual
  containment, digest-validation, and SSRF-guard invariants for untrusted
  source data; the primary rule for this skill's main surface
- [`quality-security.md`](../../rules/quality-security.md) — this repo's
  own CI/CD security checklist, scoped specifically to
  `.github/workflows/**` (it is explicitly not a general OWASP checklist —
  don't stretch it to cover source-ingestion findings that belong in
  `subsystem-sources.md` instead)
- [`quality-core.md`](../../rules/quality-core.md) — universal block-tier
  anti-patterns (unvalidated external input at system boundaries, silently
  swallowed errors)

## Tool Preferences

- **Sequential Thinking MCP** — walk each STRIDE category in order
- **`npm audit` / `npm audit signatures`** — the actual dependency
  vulnerability and registry-signature checks this repo's CI runs
  (`audit-signatures` job); prefer these over a generic scanner this repo
  doesn't otherwise use

## Constraints

- NO approve code with critical vulnerabilities
- NO custom crypto
- ALWAYS cite CWE IDs in findings
- ALWAYS give specific file:line references and concrete remediation, never
  just the finding
- NEVER expose actual secrets in output

## Handoff

- To `/hex-execute` — remediation
- To `/hex-architect` — when a finding needs a design change, not just a fix
