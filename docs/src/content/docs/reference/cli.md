---
title: "CLI"
sidebar:
  label: "CLI"
  order: 1
---
<!-- doc_type: reference -->

`ocx-catalog` is a single binary with three subcommands — `build`, `dev`,
`ci` — implemented in `src/cli/main.ts`, `src/cli/build.ts`, and
`src/cli/dev.ts`. This page transcribes every flag, default, and exit code
from that source.

## Synopsis

```
ocx-catalog build [--config <path>] [--out <dir>]
ocx-catalog dev [--source <path>] [--config <path>] [--port <n>] [--smoke]
ocx-catalog ci [--check]
ocx-catalog --version
ocx-catalog <command> --help
```

`--version`/`-V` (top-level) and `--help`/`-h` (top-level and per-subcommand)
are commander's own built-ins, not options this project defines.

## `build`

Renders the catalog site to static output.

| Flag | Argument | Default | Effect |
|---|---|---|---|
| `--config <path>` | path to `catalog.config.json` | `./catalog.config.json` (resolved against `process.cwd()`) | Config file `buildCatalog` loads before anything else. |
| `--out <dir>` | output directory | `dist` (resolved against `process.cwd()`) | Directory the rendered site and mirrored source data are written to. It must not overlap an input. See [Output-directory safety](#output-directory-safety). |

Both defaults are a plain, reversible naming choice, not part of a frozen
contract.

`build` renders into a staging directory beside `--out` and swaps it into
place only after the render succeeds. A failed build leaves the previous
`--out` untouched. Node 22.13 or newer is required.

## `dev`

Runs the catalog dev server. It renders the same site `build` does, serves it
from an Astro dev server bound to `127.0.0.1`, and rebuilds when the config,
a `path` source, `docs`, `css`, `publicDir` or `brand.logo` changes. The site
is served under the configured `base`.

| Flag | Argument | Default | Effect |
|---|---|---|---|
| `--source <path>` | source data directory | none | Sugar for an implicit single-entry, `root: true` config — no `brand`/`nav` customization. Mutually exclusive with `--config`. |
| `--config <path>` | path to `catalog.config.json` | `./catalog.config.json` (resolved against `process.cwd()`), used when neither `--source` nor `--config` is given | Config file to load — same resolution `build` uses. |
| `--port <n>` | port number | none: the first free port from `4321` upward, trying 100 ports | Requested TCP port for the dev server, bound on `127.0.0.1`. The server never binds `localhost`, so behavior does not depend on which loopback address family the resolver returns first. |
| `--smoke` | flag | `false` | Starts the dev server, requests two URLs, then closes it and returns. See below for what this does and does not prove. |

### `--source`/`--config` mutual exclusion

Passing both fails immediately with exit `64` (`USAGE`) and the message
`ocx-catalog dev: --source and --config are mutually exclusive` — checked
before port parsing or anything else runs.

### `--port` parsing

`--port` arrives from commander as a raw string. `runDev` parses it with
`Number()` and accepts it only when the result is a positive integer no greater
than `65535`. Anything else fails with exit `64` (`USAGE`) and the message
`ocx-catalog dev: invalid --port value "<raw>"`. Non-numeric, `0`, negative,
fractional and larger values are all rejected.

A requested port that is already bound fails with exit `69` (`UNAVAILABLE`).
The server never falls back to another port. Without `--port`, `dev` tries
`4321` and the 99 ports above it. If none is free, it also exits `69`.

### What `--smoke` does and does not prove

`--smoke` boots the dev server exactly as an interactive run would. It uses
the same config load, source resolution and scratch root. Once the server
answers, it requests `<base>` and `<base>data/catalog/catalog.json`. Both must
answer `200`. It then stops the server instead of waiting for `SIGINT`.

A failed request exits `1` and names the path. A pass proves the config loads,
every source resolves, and the home page and catalog data are served. It does
**not** fetch a package or docs page, so it proves nothing about any specific
route. It also never exercises `_headers`.

## `ci`

Renders or checks the generated CI workflow (see
[CI rendering](../ci-rendering/)).

| Flag | Argument | Default | Effect |
|---|---|---|---|
| `--check` | flag | `false` | Check-only: verifies the rendered workflow matches what's on disk without writing anything. |

`ci` takes no `--config` and no `--out`. It always reads
`catalog.config.json` from `process.cwd()` — `join(process.cwd(),
"catalog.config.json")`, hardcoded directly in the command's action in
`src/cli/main.ts` — so there is no way to point it at a different config
file or a different working directory short of `cd`-ing there first.

## Exit codes

`src/cli/exit.ts` defines a subset of BSD `sysexits.h`:

| Code | Name | Meaning |
|---|---|---|
| `0` | `OK` | Success. |
| `1` | `FAIL` | The Astro render failed (a `RenderError`: the child exited non-zero, was killed, could not start, or failed a `dev --smoke` request), or an error this CLI did not recognize as one of its own failure classes. Neither is caught by the command's action. The child's own diagnostics are already on stderr. |
| `64` | `USAGE` | Command-line usage error — either commander itself rejecting the invocation (unknown option, missing required argument), or a subcommand's own explicit usage check (see `dev`'s mutual-exclusion and `--port` checks above). |
| `65` | `DATA` | A schema or drift mismatch in catalog source data: a `ConfigError` (any command, including `OUT_DIR_OVERLAPS_INPUT`), a `BuildError` with code `DATA` (`build`/`dev`), or a `CiError` (`ci`). |
| `69` | `UNAVAILABLE` | A required service or resource is unavailable: a `BuildError` with code `UNAVAILABLE` (an unreachable `url` source, or `dev`'s port already bound). |

`main()`'s own doc comment states its contract directly: it "never calls
`process.exit`; sets `process.exitCode` and returns so callers control
process teardown." Every exit path this CLI takes — including every
command's own error branches — goes through `process.exitCode`, never
`process.exit()`.

### Which codes each command can emit

| Command | `0` | `1` | `64` | `65` | `69` |
|---|---|---|---|---|---|
| `build` | yes | yes (render failure or uncaught error) | yes (commander parse errors only — `runBuild` has no explicit usage check of its own) | yes (`ConfigError`, or `BuildError` code `DATA`) | yes (`BuildError` code `UNAVAILABLE`) |
| `dev` | yes | yes (render failure, failed smoke request or uncaught error) | yes (commander parse errors, plus `--source`/`--config` exclusivity and an invalid `--port`) | yes (`ConfigError`, or `BuildError` code `DATA`) | yes (`BuildError` code `UNAVAILABLE`, e.g. a requested `--port` already bound) |
| `ci` | yes | yes (uncaught error) | yes (commander parse errors only) | yes (`ConfigError` or `CiError` — `main.ts`'s `ci` action maps both to `DATA` unconditionally) | **no** — `ci` never constructs a `BuildError`; its only two caught error types both map to `65` |

## Output-directory safety

Two guards refuse an output directory that would clobber an input. Both exit
`65` with `OUT_DIR_OVERLAPS_INPUT`, and both run before the render.

The first compares `--out`, after resolving symlinks, with every input. The
output must not equal or contain the config directory, a `path` source root,
`docs`, `css`, `publicDir` or the `brand.logo` file. It must not lie inside
`docs` or `publicDir`. Every input is resolved through its symlinks too, so a
symlinked input cannot hide an overlap. A `--out` that does not exist yet is
compared by its nearest existing ancestor.

The second compares `--out` with the internal scratch root. It refuses an
output that is the scratch root, an ancestor of it, or a descendant of it. The
scratch root sweeps itself on cleanup, so an output inside it would be deleted.
Both comparisons use path segments, never a string prefix.

## Signals

`build` holds `SIGINT` and `SIGTERM` from the moment it creates its scratch
root. A signal does not end the process at once. The step in flight finishes,
the Astro child gets the signal too, and the build stops before the next step.
It never stops in the middle of the swap into `--out`.

Cleanup then removes the scratch root and the staging directory. `--out` is
either the old tree or the new one, never missing or half-written. Last, the
process ends by the same signal, so a shell sees exit `130` for `SIGINT` and
`143` for `SIGTERM`. A `build` that was interrupted exits by signal and does
not set one of the exit codes above.

`dev` also relays the signal to its Astro child and waits for it to exit. A
child that ignores `SIGTERM` is killed with `SIGKILL` after 5 seconds. `dev`
then removes its scratch root and returns.

## Child output

`build` and `dev` run Astro as a child process. Both relay every line the child
prints, on stdout or stderr, to this process's stderr. Each line starts with the
prefix `ocx-catalog: `. Stdout of the CLI itself stays free of child output.
