# Configure sources

`sources[]` in `catalog.config.json` is a list of one or more places to read an OCX index from. This page covers the three source kinds, how to aggregate several indices into one catalog, and how labels are derived and kept unique.

## The three source kinds

Each entry in `sources[]` is discriminated by exactly one of three keys — `path`, `url`, or `git`. Setting zero or more than one on the same entry fails config load (`SOURCE_DISCRIMINANT`, `src/config/load.ts`).

| Key | Reads from | Reader |
|---|---|---|
| `path` | A local directory | `src/sources/path.ts` |
| `url` | A deployed HTTPS index | `src/sources/walker.ts` |
| `git` | A git repository | `src/sources/git.ts` |

### `path`

```json
{ "path": "./my-index", "root": true }
```

`path` is resolved relative to the config file's own directory. Containment is checked twice: lexically at config load (`PATH_ESCAPE` — string `resolve`/`relative`, no symlink following), and again with `realpath` on every individual file at read time. The second check exists precisely because the first one can't see a symlink: a config-relative path that lexically stays inside the config directory but whose target (or a subdirectory along the way) is a symlink pointing outside it is still caught, just later, at the point the file is actually opened.

### `url`

```json
{ "url": "https://index.ocx.sh", "label": "public" }
```

`url` sources are **https only** — plain `http` is refused at config load. This isn't a style preference: of everything a `url` source fetches, `/config.json` and `/c/index.json` are the only two files never digest-verified against anything (there's nothing to verify them against — they're the enumeration itself). Over plain HTTP, a network attacker rewrites that enumeration, and every downstream digest check then happily verifies package roots against the *attacker's* digests. HTTPS is the only integrity those two files get.

Beyond the protocol requirement, the reader (`src/sources/walker.ts`):

- Never follows redirects — a 3xx response fails the build outright, naming the refused hop.
- Does a conditional GET (`If-None-Match`) against `/c/index.json`, so an unchanged index costs one round trip.
- Digest-verifies every content-addressed byte it fetches.
- Caps each response body at 8 MiB, caps in-flight requests at 16 concurrent, retries a failed fetch 3 times after the initial attempt (4 total) with jittered backoff, and caps `/c/index.json` at 50,000 declared package entries.

### `git`

```json
{ "git": "https://github.com/example/index.git", "ref": "main", "dir": "index" }
```

`git` does a shallow (`--depth 1`) clone, then reads the checkout exactly like a `path` source. `ref` is optional (branch, tag, or commit SHA — defaults to the remote's HEAD) and `dir` is an optional subdirectory within the checkout. Two notes:

- A commit-SHA `ref` needs a remote that allows fetching an unadvertised object (`allow-tips-sha1-in-want`); a remote that refuses fails with a named `GIT_SHA_UNSUPPORTED` error rather than a generic clone failure.
- Submodules are never cloned. A `.gitmodules` file at the checkout root produces a warning naming its path, rather than silently shipping an incomplete tree.

A Git-LFS pointer file (the text stub a `--depth 1` clone leaves behind for an LFS-tracked file, since LFS objects are never fetched) is a hard failure, not a silently-served pointer stub.

## Aggregate the public index

A common shape: your own local index, plus `index.ocx.sh` itself, rendered into one catalog.

```json
{
  "sources": [
    { "path": "./index", "root": true },
    { "url": "https://index.ocx.sh", "label": "upstream" }
  ],
  "brand": { "title": "My Catalog" }
}
```

The package grid and search merge entries from every configured source, and nothing is dropped. When the same qualified package id (`<namespace>/<package>`) appears in more than one source, both copies appear as separate cards — each routed to its own index-qualified detail page, so neither shadows the other. See [Multi-source model](../explanation/multi-source-model.md) for how the merge and the routing work.

!!! warning "Upgrading from 0.3.0 or earlier"

    Two things changed for existing configs.

    **A non-root source's detail-page URLs moved.** They are now
    `/<label>/<namespace>/<package>` rather than the bare
    `/<namespace>/<package>`, so that two indexes publishing the same id get
    two pages. A config where no source sets `root: true` has *every* URL
    move. Nothing redirects — inbound links and bookmarks to the old shapes
    break, and translating them is the deployer's job, the same way
    [`_headers`](../ops/hosting-and-headers.md) is.

    **An explicit `label` may no longer rename an index.** It has to match the
    first name segment its own package roots carry, or the build fails with
    `LABEL_PREFIX_MISMATCH`. A config that aliased a source to a different
    name stops building; drop the `label` and let it derive, or change the
    name upstream.

## Self-host your own index

To ship a catalog with no dependency on a public index at build time, use exactly one `path` or `git` source, with `root: true`, and no `url` entry:

```json
{
  "sources": [
    { "git": "https://internal.example/index.git", "root": true }
  ],
  "brand": { "title": "Internal Catalog" }
}
```

Neither `path` nor `git` makes an outbound network call to a public index — `path` reads local disk, and `git` talks only to the remote you name. That's what makes an air-gapped build possible: nothing here needs egress to `index.ocx.sh` or any other public endpoint.

## Labels

Every source resolves to a **label** — the segment it's mirrored under (`dist/index/<label>/`) and the identifier the `_headers` file names it by. A label comes from one of two places:

- An explicit `label` key in that source's config entry. It may only *restate* the name the index gives itself — see below — never rename it.
- When `label` is absent, it's *derived*: the first `/`-segment of every package root's `name` found in that source. Exactly one distinct prefix across the source becomes the label; zero package roots or more than one distinct prefix is a hard error (`LABEL_DERIVATION_EMPTY` / `LABEL_DERIVATION_CONFLICT`) rather than a silently-guessed label.

A label is also the index's **public name**: it is what the catalog's index-scope tabs show, and the first `/`-segment of every package name that index publishes is the same string. So an explicit `label` that disagrees with its own package names fails the build (`LABEL_PREFIX_MISMATCH`) rather than producing a page where the tab says one thing and every card says another:

```json
{ "url": "https://packages.acme.corp", "label": "acme-internal" }
```

is rejected when that index's roots are named `acme/…`; write `"label": "acme"`, or leave `label` out and let it derive. (A source with no package roots at all has nothing to disagree with, so an explicit label on an empty index is fine — its scope tab simply reads 0.)

A non-root source's label also becomes the first segment of its packages' page URLs, so it may not equal a namespace the `root: true` source publishes — both would claim `/<that name>/**`. That pair fails the build too (`INDEX_NAMESPACE_COLLISION`).

Two sources resolving to the same final label — whether explicit, derived, or one of each — fails the build (`LABEL_CONFLICT`).

Every label, explicit or derived, is checked against the allowlist `^[A-Za-z0-9._-]+$` (`src/sources/labels.ts`). This is deliberately an allowlist, not a blocklist: a derived label comes straight from a hostile source's own data, and a blocklist naming only `/`, `.`, `..` would still let control characters through. A label ends up as one filesystem path segment *and* one line in the shared `_headers` file — a `\n` in an unfiltered label could inject a whole new header block for an unrelated path.
