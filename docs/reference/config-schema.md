# Config schema

`catalog.config.json` configures one `@ocx-sh/catalog` deployment: data
sources, branding, nav, and CI rendering. Validation is hand-rolled in
`src/config/load.ts`, not `ajv`-driven; `src/config/schema/catalog.config.schema.json`
is a published sibling artifact for editor tooling, kept in sync with the
loader but not read by it at runtime. This page transcribes both, and notes
every place they diverge.

## Top-level fields

| Field | Type | Required | Default | Meaning |
|---|---|---|---|---|
| `$schema` | string | no | none | Editor/tooling pointer at the published JSON Schema. Never read at runtime. |
| `configVersion` | number, `const 1` | no | `1` | Forward-compat discriminator. |
| `sources` | array of source entry, `minItems: 1` | yes | — | One or more index sources this catalog renders. |
| `brand` | object | yes | — | Site branding: title, wordmark, logo. |
| `nav` | array of nav entry | no | none (no extra links) | Extra top-nav links, rendered after the built-in Docs entry when `docs` is set. |
| `footer` | object | no | none (footer shows only `catalog json`) | Footer links — a dedicated key, not a reuse of `nav[]`; the footer's own link set isn't the header's. |
| `docs` | string | no | none (no docs mount) | Single docs directory, resolved relative to the config file's directory; must stay inside it. |
| `docsNav` | array of nav entry | no | one auto entry labelled `docs` at `/docs/` | Labelled entries for the docs-mount link(s) in the top nav, replacing that single auto entry. Requires `docs` to be set. Every `link` must be `/docs/` or start with it. |
| `css` | string | no | none | Custom stylesheet, resolved relative to the config file's directory; must stay inside it. |
| `publicDir` | string | no | none (no public assets copied) | Static assets directory, resolved relative to the config file's directory; must stay inside it. Copied verbatim into VitePress's `publicDir`, served at the site root. |
| `ci` | object | no | none | CI workflow rendering configuration for `ocx-catalog ci`. |
| `siteUrl` | string | no | none (no sitemap, no `og:url`) | Deployment origin (e.g. `https://index.ocx.sh`); must be an absolute `http(s)` URL. |
| `description` | string | no | none | Site-wide tagline/meta description, distinct from `brand.title`. |
| `favicon` | string | no | none (no icon link) | Site-root-relative href for the browser-tab icon (e.g. `/favicon.svg`). Not a filesystem path — this package never reads it, only bakes it into rendered HTML. |

Every string field above (and every string field in every sub-object below)
carries `minLength: 1` in the schema; the loader mirrors this by rejecting an
empty string as `INVALID_TYPE` — use an absent/optional key for "unset",
never `""`.

**Unknown keys are hard errors.** Any key at the top level not in the table
above throws `UNKNOWN_KEY`, naming the offending key. The same closed-shape
check applies to each `sources[]` entry (against its own discriminant
variant's key set), to `brand`, to `footer`, and to each `nav[]`/
`footer.links[]`/`docsNav[]` entry. **`ci` is the one
documented exception**: unknown keys *inside* `ci` are accepted and passed
through unmodified, because rendered-workflow configuration is expected to
grow tunables this loader doesn't know about yet, and a config author using
a newer field shouldn't be blocked from loading at all — only the CI
renderer itself would need to understand a new key.

**`configVersion`**: absent is treated as `1`. Any other value fails loudly
at load with `UNSUPPORTED_VERSION` — checked *before* the unknown-key scan,
so a config written for a version this loader doesn't support reports the
version mismatch, not a confusing `UNKNOWN_KEY` about a field it doesn't
recognize yet.

## `brand`

| Field | Type | Required | Default | Meaning |
|---|---|---|---|---|
| `title` | string | yes | — | Site `<title>` / `og:site_name`. |
| `wordmark` | string | no | falls back to `title` in the header | Header wordmark — the text beside the logo/mark. Exists because the two are legitimately different strings (a `<title>` reads as prose, a wordmark is usually the deployment's own host). |
| `logo` | string, local path only | no | the theme's built-in mark | Logo asset, resolved relative to the config file's directory; must stay inside it (`PATH_ESCAPE` otherwise). Copied into the site's public root and rendered in the header in place of the built-in mark. |

`brand` is closed: any key other than `title`/`wordmark`/`logo` is
`UNKNOWN_KEY`.

## `nav[]`

| Field | Type | Required | Meaning |
|---|---|---|---|
| `text` | string | yes | Visible label for this nav entry. |
| `link` | string | yes | Target href. |

`nav[].link` must be either an absolute `http(s)` URL, or a path starting
with `/` (never `//`, protocol-relative) that genuinely resolves back onto
this site's own origin. The check parses with the real WHATWG `URL`
constructor rather than pattern-matching the string — a naive
`startsWith("/")` check would accept an open-redirect shape like
`/\evil.example` or a value containing a stripped control character, both of
which a spec-conformant parser resolves to a different origin. A
`javascript:`/`data:` value, or any link that escapes the site's own origin,
is rejected at config load, not just sanitized at render time — this config
can be fork-PR-authored for a corporate mirror, and there is no render-time
second line of defense (the theme's header/footer components bind this
value straight to `:href`).

`nav` entries are closed: any key other than `text`/`link` is `UNKNOWN_KEY`.

## `footer`

```json
{ "footer": { "links": [{ "text": "Status", "link": "/status" }] } }
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `links` | array of nav entry | yes | Footer links, same shape and `assertSafeNavLink` validation as `nav[]`. |

`footer` is closed: any key other than `links` is `UNKNOWN_KEY`. This key
replaced `SiteFooter.vue`'s old behaviour of reading `theme.nav` directly —
a mirror that configures `nav[]` for its header no longer gets those same
links repeated in its footer; it needs its own `footer.links[]`. Omitting
`footer` entirely leaves the footer showing only its `catalog json` link.

## `docsNav[]`

```json
{
  "docs": "./docs",
  "docsNav": [
    { "text": "setup", "link": "/docs/setup/" },
    { "text": "reference", "link": "/docs/reference/" }
  ]
}
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `text` | string | yes | Visible label for this docs-nav entry. |
| `link` | string | yes | Target href — must be `/docs/` or start with it. |

Two rules on top of `nav[]`'s own `text`/`link` shape and
`assertSafeNavLink` validation (both reuse the same `buildNavEntry` builder,
not a second implementation):

- Every `docsNav[].link` must be `/docs/` or start with `/docs/` — anything
  else is a `nav[]` entry with extra steps, not a label for the docs mount.
  `INVALID_TYPE` otherwise.
- `docsNav` present without `docs` configured is `INVALID_TYPE` — it would
  point at a mount that doesn't exist.

Omitting `docsNav` (with `docs` set) keeps today's behaviour exactly: one
auto entry labelled `docs` pointing at `/docs/`.

## `ci`

| Field | Type | Required | Default | Meaning |
|---|---|---|---|---|
| `forge` | `"github"` \| `"gitlab"` | yes | — | Target CI forge for the rendered workflow. |
| `packageManager` | `"npm"` \| `"bun"` | no | see note below | Package manager the rendered workflow's install/exec steps use. `pnpm`/`yarn` are unsupported — a value outside the two is a loud config-load error rather than a silently broken rendered workflow. |
| `verifyCi` | boolean | no | none | When `false`, skips CI verification of rendered output against source data. |

!!! note "Schema vs. loader: `packageManager`'s default is not applied at load time"
    The JSON Schema declares `"default": "npm"` for `ci.packageManager`, but
    `loadConfig` does **not** fill that default in. When `packageManager` is
    omitted, the parsed `CatalogConfig.ci.packageManager` stays `undefined` —
    the loader only validates the field's shape (string, one of `"npm"`/`"bun"`)
    when it is *present*. The `"npm"` default is applied downstream instead,
    in the CI renderer itself: `src/ci/render.ts` reads
    `const packageManager = ci.packageManager ?? "npm";`. A schema-only
    validator that applies JSON Schema defaults (e.g. `ajv` with
    `useDefaults`) would materialize `"npm"` onto the parsed object; this
    hand-rolled loader does not, and code reading `LoadedConfig.config.ci`
    directly (rather than going through the renderer) must apply the same
    `?? "npm"` fallback itself.

`ci` is the **one open object** in the whole config shape: unlike every
other object here, unknown keys inside it are ignored rather than rejected
(see the top-level section above for why).

## `sources[]`

Every entry is discriminated by exactly one of `path` | `url` | `git`; the
schema expresses this as a closed `oneOf` over three shapes, and the loader
enforces the same rule at runtime (`SOURCE_DISCRIMINANT` on zero or more
than one discriminant key present). Two fields are common to every variant:

| Field | Type | Required | Meaning |
|---|---|---|---|
| `label` | string | no | The index's public name — shown by the catalog's index-scope tabs, and the first `/`-segment of every package name this source publishes. Must be unique across `sources[]` (`LABEL_CONFLICT`) and must match that segment (`LABEL_PREFIX_MISMATCH`): a label may restate the name an index gives itself, never rename it. When absent it is derived from the source's own data; `loadConfig` never invents a label itself. |
| `root` | boolean | no | Marks this source as the catalog's self-mirror, served at the site root in addition to `index/<label>/`. Its packages keep bare `/<ns>/<pkg>` routes; every other index's are qualified with their own name. At most one entry across `sources[]` may set this — `MULTIPLE_ROOT` otherwise. |
| `default` | boolean | no | Marks this source as the index the catalog view **opens on** — preselected on arrival, badged `default` in the scope tabs. Purely presentational: it moves no page's URL. At most one entry may set this — `MULTIPLE_DEFAULT` otherwise. When no entry sets it, the `root: true` source (if any) is the default; a catalog with **no** root source needs this key to name one at all. |

=== "path"

    | Field | Type | Required | Meaning |
    |---|---|---|---|
    | `path` | string | yes | Local directory read as the index root, resolved relative to the config file's directory. Must stay inside it (`PATH_ESCAPE` otherwise). |

=== "url"

    | Field | Type | Required | Meaning |
    |---|---|---|---|
    | `url` | string, pattern `^https://` | yes | Base URL of a deployed catalog/index instance. `https` only — `/config.json` and `/c/index.json` are the only fetched files never digest-verified, so over plain `http` a network attacker could rewrite the enumeration and every downstream digest check would then pass against the attacker's own digests. |

    The schema's `pattern` is a shape heuristic, anchored only at the start
    of the string. The loader's own check (`assertPlausibleUrl`) is
    authoritative: it parses the value with `new URL()` and rejects anything
    whose `protocol` isn't literally `https:`.

=== "git"

    | Field | Type | Required | Meaning |
    |---|---|---|---|
    | `git` | string | yes | Git remote to clone (shallow, depth 1). |
    | `ref` | string | no | Branch, tag, or commit to check out. Defaults to the remote's HEAD. |
    | `dir` | string | no | Subdirectory within the checkout that holds the index root. |

### Cross-entry rules

| Rule | Error code | Expressed in the JSON Schema? |
|---|---|---|
| `sources` must be non-empty | `EMPTY_SOURCES` | yes (`minItems: 1`) |
| Each entry sets exactly one of `path`/`url`/`git` | `SOURCE_DISCRIMINANT` | yes (`oneOf` over three closed shapes) |
| At most one entry may set `root: true` | `MULTIPLE_ROOT` | yes (`contains`/`minContains: 0`/`maxContains: 1`) |
| At most one entry may set `default: true` | `MULTIPLE_DEFAULT` | yes (same shape — both live inside `allOf`, since one schema object can hold only one `contains`) |
| Two entries must not declare the same explicit `label` | `LABEL_CONFLICT` | **no** — array-element uniqueness keyed on an optional field isn't expressed in the schema at all; loader-only |

## Path containment

Five fields are resolved relative to the config file's own directory and
must resolve to that directory or a descendant of it: `docs`, `css`,
`publicDir`, `brand.logo`, and every `sources[].path` value. Escaping it
(any `..` that survives resolution) is `PATH_ESCAPE`, naming the offending
key and both the raw and resolved path.

This check is **lexical only** — `resolve()`/`relative()` string math, never
`realpath` — so it does not follow symlinks. A symlink living inside the
config directory whose target resolves outside it passes this check despite
the eventual read landing outside the directory. `loadConfig` never reads
`docs`/`css`/`publicDir`/`brand.logo`/`path` off disk itself, so this is out
of scope for the loader; the source-reading layer that does read them
independently re-verifies containment per file (see
[Output layout](./output-layout.md)).

`siteUrl` and `nav[].link` follow a related but distinct pattern worth
calling out explicitly: the JSON Schema declares only `minLength: 1` for
`siteUrl` (its own `description` field says so — "src/config/load.ts
validates the shape beyond what this schema (minLength only) expresses") and
only `minLength: 1` for `nav[].link` (no schema-level shape check at all).
Both get real validation from the loader — `siteUrl` must parse as an
absolute `http:`/`https:` URL, `nav[].link` must satisfy the same-origin/
`http(s)`-only rule described above. A schema-only validator would accept
configs the loader rejects for both fields; this is deliberate, not a gap —
JSON Schema has no clean way to express "resolves to this same origin."
`footer.links[]` reuses `nav[]`'s own `navEntry` schema definition, so it
carries the identical divergence.

`docsNav[].link` does **not** share that gap: its own schema entry
(`docsNavEntry`) carries `"pattern": "^/docs/"`, which the loader's own
`/docs/`-prefix check mirrors exactly, and which structurally forecloses
every open-redirect shape `assertSafeNavLink` otherwise guards against (a
protocol-relative `//` authority marker can never reach position 0 once
`/docs/` occupies it). `docsNav` requiring `docs` to be set is likewise
expressed in the schema, via `dependentRequired`. Both rules agree between
schema and loader.

## Example

```json title="catalog.config.json"
{
  "$schema": "https://cdn.jsdelivr.net/npm/@ocx-sh/catalog/src/config/schema/catalog.config.schema.json",
  "configVersion": 1,
  "sources": [
    { "path": "../index", "root": true },
    { "url": "https://mirror.example.com", "label": "mirror" },
    { "git": "https://github.com/example/index.git", "ref": "main", "dir": "p", "label": "example" }
  ],
  "brand": {
    "title": "OCX Index",
    "wordmark": "index.ocx.sh",
    "logo": "./assets/logo.svg"
  },
  "nav": [
    { "text": "GitHub", "link": "https://github.com/ocx-sh/index" },
    { "text": "Docs", "link": "/docs/" }
  ],
  "footer": {
    "links": [{ "text": "Status", "link": "/status" }]
  },
  "docs": "./docs",
  "docsNav": [{ "text": "docs", "link": "/docs/" }],
  "css": "./theme/custom.css",
  "publicDir": "./public",
  "ci": {
    "forge": "github",
    "packageManager": "npm",
    "verifyCi": true
  },
  "siteUrl": "https://index.ocx.sh",
  "description": "The public OCX package index.",
  "favicon": "/favicon.svg"
}
```

The `$schema` line above is for editor/IDE validation-as-you-type only —
`loadConfig` accepts it as an ordinary optional string field and never opens
or reads it at build or CI time.

## Error codes at load time

Every row below is a `ConfigError` (`src/config/errors.ts`); every command
that loads a config (`build`, `dev`, `ci`) maps every one of them to exit
`65` (`DATA`) — see [CLI](./cli.md).

| Code | Meaning |
|---|---|
| `MISSING_FILE` | Config file does not exist at the given path (`ENOENT`). |
| `READ_ERROR` | Config path exists but couldn't be read — e.g. it names a directory, or a permission error. Distinct from `MISSING_FILE`, which is `ENOENT` only. |
| `INVALID_JSON` | Config file exists but is not valid JSON. |
| `INVALID_TYPE` | A field's JSON type doesn't match its expected type — includes an empty string on a field that requires non-empty, and an unparsable or wrong-protocol URL (`siteUrl`, `sources[].url`, `nav[].link`). |
| `UNKNOWN_KEY` | An unrecognized key at the top level, or inside a `sources[]` entry, `brand`, `footer`, or a `nav[]`/`footer.links[]`/`docsNav[]` entry. `ci`'s own keys are exempt. |
| `UNSUPPORTED_VERSION` | `configVersion` names a version this loader doesn't support. |
| `SOURCE_DISCRIMINANT` | A `sources[]` entry has zero, or more than one, of `path`/`url`/`git`. |
| `EMPTY_SOURCES` | `sources` is present but empty. |
| `MULTIPLE_ROOT` | More than one `sources[]` entry sets `root: true`. |
| `MULTIPLE_DEFAULT` | More than one `sources[]` entry sets `default: true`. |
| `LABEL_CONFLICT` | Two `sources[]` entries declare the same explicit `label`. |
| `PATH_ESCAPE` | A `css`/`docs`/`publicDir`/`brand.logo`/`path` value resolves outside the config file's directory. |
