---
title: "Hosting and headers"
sidebar:
  order: 2
---
<!-- doc_type: explanation -->

Two independent things can go wrong when you pick a host for a rendered
catalog site. Neither shows up until you have already deployed.

**Failure mode 1: the prefix does not match `base`.** Every page link, asset
and client-side fetch carries the `base` the site was built with. Serve the
site under a different prefix and every request resolves against the wrong
location. The symptom is a blank site, or every asset answering 404.

The fix is to set `base` to the prefix your host serves. See
[`base`](../../reference/config-schema/#base).

**Failure mode 2: `_headers` goes unread.** `ocx-catalog build` emits a
Cloudflare Pages and Netlify format `_headers` file. It sandboxes every
mirrored, untrusted `/p/*` path: a README, a logo or a package root that a
configured source handed this renderer. Only Cloudflare Pages and Netlify read
that file format. On every other host it ships to `dist/_headers` and does
nothing.

The untrusted content is then served without the isolation this package
assumes.

## Serving under a base

Set `base` to the path your host mounts the site at. It has a leading and a
trailing `/`. You can also give `siteUrl` a path and let `base` follow it.

```json
{
  "siteUrl": "https://example.github.io/my-index/",
  "base": "/my-index/"
}
```

When both carry a path, they must agree, or the config fails with
`BASE_SITEURL_MISMATCH`. The build output does not move. You still deploy the
`--out` directory as the root of the host's site. The host decides that its
URL begins with `/my-index/`.

`ocx-catalog dev` serves under the same `base`, so a preview of the example
above lives at `http://127.0.0.1:4321/my-index/`.

Detail pages are directories, and their URLs end in `/`. Most static hosts
redirect `/foo` to `/foo/` on their own. Check yours if bare links 404.

## What `_headers` contains

The two headers, and exactly which paths they cover (`renderHeaders()` in
`src/sources/mirror.ts`). The example uses `"base": "/catalog/"`. Every pattern
starts with your `base`, so with the default `/` the prefix is empty.

```
/catalog/p/*
  Content-Security-Policy: sandbox
  X-Content-Type-Options: nosniff

/catalog/index/<label>/p/*
  Content-Security-Policy: sandbox
  X-Content-Type-Options: nosniff
```

The leading `/p/*` block exists only when one of your sources sets
`root: true`. Every other source gets its own `/index/<label>/p/*` block
regardless.

Translating those two rules into your host's per-path response-header
mechanism is the deployer's job, if the host has one. This package ships and
tests a translation for no host but Cloudflare Pages and Netlify. When you
translate the rules, include the `base` in each path.

## Decision table

| Host | Reads `_headers`? | Serves a path prefix? | What you must do yourself |
|---|---|---|---|
| **Cloudflare Pages** | Yes, natively. It is the format this package targets | Yes, at the domain root. For a prefix, set `base` and mount accordingly | Nothing for the headers. Set `base` if you use a prefix |
| **Netlify** | Yes. Cloudflare Pages adopted the format from Netlify | Yes, at the domain root. For a prefix, set `base` and mount accordingly | Nothing for the headers. Set `base` if you use a prefix |
| **GitHub Pages** | No. The file ships but is inert | A **project site** is served at `https://<user>.github.io/<repo>/`. Set `base` to `/<repo>/` | Set `base`. Translate the two headers into GitHub Pages' own mechanism, or accept the risk knowingly |
| **GitLab Pages** | No | The traditional shape is `https://<namespace>.gitlab.io/<project>/`. Set `base` to match. A unique or custom domain serves the root | Set `base`. Translate the headers yourself, or accept the risk knowingly |
| **Bunny CDN** | No. Bunny ignores `_headers` | Whatever you mount, such as `/catalog/` | Set `base`. Add an edge rule that sets both headers on the `p/*` paths. Run the probe below. See [Known limitations](../known-limitations/#bunny-cdn-deploys) |
| **S3 + CDN** | No | Depends on your CDN's routing and domain config | Set `base` to the mounted prefix. Add the two headers through your CDN's edge-function or response-header mechanism, or accept the risk knowingly |
| **Self-managed nginx/Caddy** | No | Whatever you configure | Set `base` to the prefix you serve. Add the two headers as server-level response-header rules, or accept the risk knowingly |

## Probe the headers after you deploy

On any host where you translated `_headers` yourself, check that the result
works. Request one package root and one per-index package root:

```sh
curl -sI https://example.com/my-index/p/<ns>/<pkg>.json
curl -sI https://example.com/my-index/index/<label>/p/<ns>/<pkg>.json
```

Both responses must include these two header lines:

```text
content-security-policy: sandbox
x-content-type-options: nosniff
```

If you see neither, the translation did not take effect. The ocx.sh deploy
treats this probe as a gate before a release goes live.

"Accept the risk knowingly" is a real option, not a euphemism for skipping the
work. It means deploying without the CSP sandbox and MIME-sniffing protection
on mirrored third-party content, and deciding that is acceptable for your
sources. A single, fully trusted internal index is one example. It is not the
default this package assumes. See
[Security and trust model](../../explanation/security-and-trust-model/) for
what the sandbox is defending against.
