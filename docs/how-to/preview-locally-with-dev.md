# Preview locally

`ocx-catalog dev` boots a live VitePress dev server against your sources, without a full `build` step in between.

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
| `--smoke` | Boot, confirm the server is listening, then exit |

`--port` must be an integer between 1 and 65535 — anything else exits with usage code 64. If the port is already bound, `dev` exits with code 69.

## `--smoke`

```sh
npx ocx-catalog dev --source ../my-index --smoke
```

`--smoke` boots the server, waits for it to confirm it's listening, then shuts it down and exits. It proves the server *starts* — it does not render or check any page. Use it in CI as a cheap "does this config still boot" check, not as a substitute for a real build/render pass.

## Stopping the server

Without `--smoke`, `dev` runs until you press Ctrl-C. That sends `SIGINT`, which shuts down the forked VitePress worker process and disposes the scratch build root it was serving from.

`dev` runs the actual VitePress server in a forked child process rather than in the CLI's own process — VitePress's `createServer()` must never share a process with another Vite instance, which the CLI's own process could otherwise become depending on how it's invoked. See `src/build/dev.ts`'s header comment for the full reasoning.

!!! warning
    `ocx-catalog dev` never reads `_headers`. The mirror step still writes the file into the scratch tree, but nothing during a dev session interprets or applies it — there's no Cloudflare Pages/Netlify runtime behind Vite's dev server. Local preview does not exercise the sandboxing a real deployment depends on. See [Hosting and headers](../ops/hosting-and-headers.md) before choosing where to deploy.
