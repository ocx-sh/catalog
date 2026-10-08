---
title: "Preview locally"
sidebar:
  label: "Preview locally"
  order: 5
---
<!-- doc_type: how-to -->
<!-- doc_tier: everyday -->

`ocx-catalog dev` boots a live Astro dev server against your sources, without a full `build` step in between. It requires Node.js `>=22.13`.

## Basic usage

```sh
npx ocx-catalog dev --source ../my-index
```

`--source` is sugar for an implicit, single-entry, `root: true` config — no `catalog.config.json` needed at all. It's mutually exclusive with `--config`; passing both exits with usage code 64.

If you omit both `--source` and `--config`, `dev` looks for `./catalog.config.json` in the current directory, same as `build`. Passing `--config` alone uses that file.

## Flags

| Flag | Effect |
|---|---|
| `--source <path>` | Preview a bare source directory, no config file |
| `--config <path>` | Preview using a real `catalog.config.json` |
| `--port <n>` | Request a specific port |
| `--smoke` | Boot, request `<base>` and `<base>data/catalog/catalog.json`, require `200` from both, then exit |

The server binds `127.0.0.1` only. Without `--port`, `dev` uses the first free port from 4321 upward and prints the URL. `--port` must be an integer between 1 and 65535, and anything else exits with usage code 64. If the requested port is already bound, `dev` exits with code 69 instead of picking another.

The site is served under your configured `base`. With `"base": "/catalog/"`, open `http://127.0.0.1:4321/catalog/`, not the bare origin.

## Live reload

`dev` watches the config file, every `path` source, `docs`, `css`, `publicDir` and `brand.logo`. After a short quiet period it rebuilds the inputs and Astro restarts in place. A failed rebuild prints the error and keeps serving the last good state. `url` and `git` sources are read again only when their config entry changes, or when you restart `dev`. Changing `base` respawns the Astro child on the same port.

## `--smoke`

```sh
npx ocx-catalog dev --source ../my-index --smoke
```

`--smoke` boots the server, requests `<base>` and `<base>data/catalog/catalog.json`, then shuts it down and exits. Both must answer `200`, or `dev` exits `1` and names the failing path. It proves the home page and catalog data are served. It does not render or check any package or docs page. Use it in CI as a cheap "does this config still boot" check, not as a substitute for a real build.

## Stopping the server

Without `--smoke`, `dev` runs until you press Ctrl-C. That sends `SIGINT`, which stops the Astro child process and removes the scratch build root it was serving from.

`dev` is a supervisor. The Astro dev server runs in a separate child process, and the CLI waits until the site answers before it prints the URL. See `src/build/dev.ts`'s header comment for the full reasoning.

:::caution
`ocx-catalog dev` never reads `_headers`. The mirror step still writes the file into the scratch tree, but nothing during a dev session interprets or applies it — there's no Cloudflare Pages or Netlify runtime behind the dev server. Local preview does not exercise the sandboxing a real deployment depends on. See [Hosting and headers](../../ops/hosting-and-headers/) before choosing where to deploy.
:::
