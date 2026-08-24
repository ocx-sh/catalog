# Hosting and headers

Two independent things can go wrong when you pick a host for a rendered
catalog site, and neither shows up until you've already deployed.

**Failure mode 1 — wrong domain shape.** No page or fetch this package
emits is prefix-aware (see [Known limitations](known-limitations.md#1-no-subpath-support)):
every client-side request is a literal root-relative path like
`/data/catalog/catalog.json` or `/p/<ns>/<pkg>.json`. Serve the site under
any path prefix and every one of those requests resolves against the wrong
location — the symptom is a blank site or every asset 404ing.

**Failure mode 2 — `_headers` goes unread.** `src/sources/mirror.ts` emits a
Cloudflare Pages/Netlify-format `_headers` file that sandboxes every
mirrored, untrusted `/p/*` path (a README, a logo, a package root — content
handed to this renderer by a configured source, never authored by it). Only
Cloudflare Pages and Netlify actually read that file format. On every other
host it still ships to `dist/_headers` but does nothing: the untrusted
content is then served with none of the isolation this package assumes is
in place.

The two headers, and exactly which paths they cover
(`renderHeaders()` in `src/sources/mirror.ts`):

```
/p/*
  Content-Security-Policy: sandbox
  X-Content-Type-Options: nosniff

/index/<label>/p/*
  Content-Security-Policy: sandbox
  X-Content-Type-Options: nosniff
```

(the leading `/p/*` block only exists when one of your sources sets
`root: true`; every other source gets its own `/index/<label>/p/*` block
regardless.) Translating those two rules into your host's own per-path
response-header mechanism, if it has one, is the deployer's responsibility —
this package does not ship or test a translation for any host but
Cloudflare Pages and Netlify.

## Decision table

| Host | Reads `_headers`? | Domain root by default? | What you must do yourself |
|---|---|---|---|
| **Cloudflare Pages** | Yes, natively — the format this package targets | Yes, both the `*.pages.dev` subdomain and a configured custom domain | Nothing, for these two concerns |
| **Netlify** | Yes — the format Cloudflare Pages adopted from Netlify | Yes, both the `*.netlify.app` subdomain and a configured custom domain | Nothing, for these two concerns |
| **GitHub Pages** | No — the file ships but is inert | Only a **user/org site** (`https://<user>.github.io/`); a **project site** (`https://<user>.github.io/<repo>/`) is a subpath | Use a user/org site or a custom domain, not a project site path; translate the two headers into GitHub Pages' own mechanism, or accept the risk knowingly |
| **GitLab Pages** | No | Only with the unique-domain feature, or a configured custom domain — the traditional `https://<namespace>.gitlab.io/<project>/` shape is a subpath | Enable a unique/custom domain; translate the headers yourself, or accept the risk knowingly |
| **S3 + CDN** | No | Depends entirely on your CDN's routing/domain config | Configure the CDN for a root domain; add the two headers via whatever edge-function/response-header mechanism your CDN offers, or accept the risk knowingly |
| **Self-managed nginx/Caddy** | No | Whatever you configure — typically a root domain | Configure a root domain; add the two headers as server-level response-header rules, or accept the risk knowingly |

"Accept the risk knowingly" is a real option, not a euphemism for skipping
the work: it means deploying without the CSP sandbox / MIME-sniffing
protection on mirrored third-party content and deciding that's acceptable
for your sources (a single, fully-trusted internal index, for instance).
It is not the default this package assumes — see
[Security and trust model](../explanation/security-and-trust-model.md) for
what the sandbox is defending against.
