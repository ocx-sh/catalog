# CLI

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
| `--out <dir>` | output directory | `dist` (resolved against `process.cwd()`) | Directory the rendered site and mirrored source data are written to. |

Both defaults are a plain, reversible naming choice — `src/cli/build.ts`'s
own comment notes nothing in the design otherwise documents a default
explicitly — not part of a frozen contract.

## `dev`

Runs the catalog dev server.

| Flag | Argument | Default | Effect |
|---|---|---|---|
| `--source <path>` | source data directory | none | Sugar for an implicit single-entry, `root: true` config — no `brand`/`nav` customization. Mutually exclusive with `--config`. |
| `--config <path>` | path to `catalog.config.json` | `./catalog.config.json` (resolved against `process.cwd()`), used when neither `--source` nor `--config` is given | Config file to load — same resolution `build` uses. |
| `--port <n>` | port number | none — `strictPort: false`, Vite/VitePress picks a free port itself | Requested TCP port for the dev server, bound on `127.0.0.1` (never Vite's default `localhost`, so "port already in use" behavior doesn't depend on which loopback address family the machine's resolver returns first). |
| `--smoke` | flag | `false` | Starts the dev server, waits for it to report ready (bound and listening), then closes it and returns — see below for what this does and does not prove. |

### `--source`/`--config` mutual exclusion

Passing both fails immediately with exit `64` (`USAGE`) and the message
`ocx-catalog dev: --source and --config are mutually exclusive` — checked
before port parsing or anything else runs.

### `--port` parsing

`--port` arrives from commander as a raw string (no `<n>` coercion).
`runDev` parses it with `Number()` and accepts it only when the result is a
positive integer no greater than `65535`; anything else — non-numeric, `0`,
negative, fractional, or `> 65535` — fails with exit `64` (`USAGE`) and the
message `ocx-catalog dev: invalid --port value "<raw>"`. When a port is
given, the dev server also sets `strictPort: true`: if that exact port is
already bound, startup fails outright (exit `69`, `UNAVAILABLE`) rather than
silently falling back to another port.

### What `--smoke` does and does not prove

`--smoke` boots the dev server exactly as an interactive run would — same
config load, same source resolution, same scratch root and page synthesis,
same `createServer()`/`.listen()` call inside the forked worker process —
and resolves once the worker reports `{ type: "ready", port }`. It then
closes the server immediately instead of waiting for `SIGINT`.

This proves the config loads, every source resolves, and the process can
bind a TCP port. It does **not** fetch any page: `--smoke` makes no HTTP
request against the running server, so it proves nothing about whether any
page actually renders, whether the theme's client-side catalog fetch
succeeds, or whether any specific route returns a non-error response.

## `ci`

Renders or checks the generated CI workflow (see
[CI rendering](./ci-rendering.md)).

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
| `1` | `FAIL` | An error this CLI did not recognize as one of its own failure classes — propagates uncaught out of the command's action, past `main()`'s own `try`/`catch` (which only catches commander's own `CommanderError`), to whatever runs `main()`. |
| `64` | `USAGE` | Command-line usage error — either commander itself rejecting the invocation (unknown option, missing required argument), or a subcommand's own explicit usage check (see `dev`'s mutual-exclusion and `--port` checks above). |
| `65` | `DATA` | A schema/drift mismatch in catalog source data — a `ConfigError` (any command), a `BuildError` with code `DATA` (`build`/`dev`), or a `CiError` (`ci`). |
| `69` | `UNAVAILABLE` | A required service/resource is unavailable — a `BuildError` with code `UNAVAILABLE` (an unreachable `url` source, or `dev`'s requested port already bound). |

`main()`'s own doc comment states its contract directly: it "never calls
`process.exit`; sets `process.exitCode` and returns so callers control
process teardown." Every exit path this CLI takes — including every
command's own error branches — goes through `process.exitCode`, never
`process.exit()`.

### Which codes each command can emit

| Command | `0` | `1` | `64` | `65` | `69` |
|---|---|---|---|---|---|
| `build` | yes | yes (uncaught error) | yes (commander parse errors only — `runBuild` has no explicit usage check of its own) | yes (`ConfigError`, or `BuildError` code `DATA`) | yes (`BuildError` code `UNAVAILABLE`) |
| `dev` | yes | yes (uncaught error) | yes (commander parse errors, plus `--source`/`--config` exclusivity and an invalid `--port`) | yes (`ConfigError`, or `BuildError` code `DATA`) | yes (`BuildError` code `UNAVAILABLE`, e.g. a requested `--port` already bound) |
| `ci` | yes | yes (uncaught error) | yes (commander parse errors only) | yes (`ConfigError` or `CiError` — `main.ts`'s `ci` action maps both to `DATA` unconditionally) | **no** — `ci` never constructs a `BuildError`; its only two caught error types both map to `65` |

## Output-directory safety

Before handing off to VitePress, `build` (and `dev`'s equivalent
scratch-backed render) calls `assertOutDirSafe(scratchRoot, outDir)`
(`src/cli/out_dir.ts`), which refuses an output directory that is the
internal scratch root itself, an ancestor of it, or a descendant of it — a
path-segment comparison (`relative()` + split on the path separator, never a
string prefix). The scratch root self-sweeps on cleanup, so an output
directory inside it would be deleted; an output directory containing or
equal to it would delete or shadow the very source tree being rendered.
