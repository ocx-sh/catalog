---
title: "Branding and docs mount"
sidebar:
  label: "Branding and docs mount"
  order: 6
---
<!-- doc_type: how-to -->
<!-- doc_tier: everyday -->

`catalog.config.json`'s `brand`, `css`, `nav`, and `docs` fields make a rendered catalog look and navigate like yours. This page covers each, plus the one styling surface that survives upgrades: the theme's design tokens.

## Brand

```json
{
  "brand": {
    "title": "My Catalog",
    "wordmark": "catalog.example.com",
    "logo": "./assets/logo.svg"
  }
}
```

| Field | Drives |
|---|---|
| `title` | The page `<title>`, `og:site_name`, and the header text — unless `wordmark` is set |
| `wordmark` | The text shown beside the logo in the header, when it should read differently from `title` (e.g. a prose site title vs. the bare host it's served from). Absent → the header falls back to `title` |
| `logo` | The header's logo image, replacing the built-in OCX mark. Omit it and the header keeps the built-in OCX mark |

Only `title` is required. The exception is `chrome: "ocx"`, where the ocx.sh shell owns the header and `brand` is rejected. See [`chrome`](../../reference/config-schema/#chrome).

`logo` is a **local file path only**, never a URL. It is resolved relative to the config file and containment-checked the same way `docs`/`css`/`publicDir` are. The build copies it into the site's public root under its own filename, and the page links it under your `base`. Its file name becomes a [reserved name](../../reference/config-schema/#reserved-names), so no index label or root namespace may match it. The same image also becomes the site-wide `og:image`/`twitter:image` (made absolute against `siteUrl` when that's configured).

## Custom stylesheet

```json
{ "css": "./assets/custom.css" }
```

`css` is a path relative to the config file. The build bundles it with the theme's styles and links the result from every page. A relative `@import` and a relative `url()` resolve from the file's own directory. The output is minified and content-hashed under `_astro/`, so it is not served at the file's own name. A missing file or a directory fails the build with exit `65`. So does any file its `@import` or `url()` reaches outside the config directory, symlinks followed. A bare package name such as `@import "pkg/x.css"` is the exception: it may resolve into any `node_modules`, including a hoisted one above the config directory. `dev` lets its server read the whole config directory for this.

Your rules win because of the cascade, not because of where the file is linked. Every theme rule sits inside a cascade layer, and **an unlayered rule beats a layered one at any specificity**. A plain rule in your file overrides the theme without `!important` and without out-specifying it.

:::caution[No stable selector contract]
The theme's class names, element structure and `data-slot` attributes can change in any release. A rule that targets them can break on upgrade with no warning. Only the `:root` token overrides below are expected to survive upgrades. The 0.5.x `@layer ocx` override contract and `--ocx-*` component hooks no longer exist.
:::

### Changing colours, spacing, type and shape

Every value the theme renders comes from a CSS custom property. Reassign the ones you want:

```css
:root {
  --ocx-color-accent: #2563eb;
  --ocx-font-sans: "Inter", sans-serif;
  --ocx-radius-lg: 0; /* square corners everywhere */
}

:root[data-theme="dark"] {
  --ocx-color-accent: #60a5fa;
}
```

**Set both `:root` and `:root[data-theme="dark"]`.** The theme switches dark mode with a `data-theme` attribute on `<html>`. Your unlayered `:root` rule beats the theme's layered dark rule. A `:root`-only override therefore applies in dark mode too and pins the token to its light value. This is the most common way to accidentally break dark mode.

The tokens come from the `@ocx-sh/theme` package, in its `tokens.css`. Read that file for the full list of names and their light and dark values.

## Nav links

```json
{
  "nav": [
    { "text": "GitHub", "link": "https://github.com/example/index" },
    { "text": "Status", "link": "/status" }
  ]
}
```

Each entry needs `text` and `link`. `link` must be either an absolute `http(s)` URL, or a path starting with `/` that genuinely resolves back onto the site's own origin (never `//`, which is protocol-relative and would silently leave the site). A path is written relative to the catalog root and joined onto `base`, so `/status` becomes `/catalog/status` under `"base": "/catalog/"`. This is validated at config load, not just sanitized when the page renders — a value like `javascript:...` fails the build outright rather than surviving into a rendered `<a href>`.

`nav[]` is the header's own link list. The footer has a separate one — see [Footer links](#footer-links) below — so configuring `nav[]` alone adds nothing to the footer.

## Footer links

```json
{
  "footer": {
    "links": [{ "text": "Status", "link": "https://status.example.com" }]
  }
}
```

`footer.links[]` entries have the exact same shape and validation as `nav[]`. The footer always carries a `catalog json` link to the site's own view model. Omit `footer` entirely and that is the only link. It does not fall back to `nav[]`.

## Other site metadata

| Field | Effect |
|---|---|
| `publicDir` | A directory (relative to the config file) copied verbatim into the site's public root. A `favicon.svg` inside it is served at `<base>favicon.svg`. Omit it and no extra public assets are copied. Its top-level entries become [reserved names](../../reference/config-schema/#reserved-names). A file there may not sit at a path the build writes, such as `_headers`, or the build fails with exit `65` |
| `favicon` | Emitted as the page's `<link rel="icon">`, with `type` inferred from the extension (`.svg`/`.png`/`.ico`; anything else emits no `type`). Either a catalog-root-relative href (e.g. `/favicon.svg`), joined onto `base`, or an absolute `http(s)` URL, used as written. A `//host` value, a bare file name, a `javascript:` value or a path with a dot segment fails with exit `65`. The build never reads the file, so it can come from `publicDir`, `brand.logo`, the host or a CDN. Omit it and no icon link is emitted at all |
| `description` | The site-wide tagline, used as the meta description of any page that has none of its own. It is distinct from `brand.title`. Omit it and those pages carry no description |
| `ownerUrl` | The owner-profile link template for a package page's `owners` row, e.g. `https://gitlab.com/{login}`. It must be an absolute `http(s)` URL containing `{login}` exactly once; the owner's login (from the index) is URL-encoded into it. Omit it and owners link to `https://github.com/<login>`, as before. Owner logins come from the index and it does not say which forge they belong to, so a deployment whose owners live on GitLab or a self-hosted forge sets this. A source's own `sources[].ownerUrl` overrides it for that source's packages ([Configure sources](../configure-sources/)) |
| `siteUrl` | The deployment URL (e.g. `https://catalog.example.com`), feeding the sitemap and each page's `og:url`/canonical link. A path in it is the default for `base`. Omit it and the site still builds, but it skips the sitemap and those `og:url`/canonical tags |
| `base` | The URL path prefix the site is served under, such as `/catalog/`. Defaults to the path of `siteUrl`, else `/`. See [`base`](../../reference/config-schema/#base) |

## Docs mount

```json
{ "docs": "./docs" }
```

`docs` mounts a Markdown tree at `<base>docs/**`. The mount adds a "docs" link to the top nav by default. You do not list it in `nav[]` yourself.

That default entry points at `/docs/`. It leads to a page only when your tree has a `docs/index.md`. Use `docsNav` to link specific pages. It replaces the default with your own labelled entries. That is also useful when the mounted tree is not generically "docs", or when you want several entries pointing into different subtrees.

```json
{
  "docs": "./docs",
  "docsNav": [
    { "text": "setup", "link": "/docs/setup/install/" },
    { "text": "reference", "link": "/docs/reference/cli/" }
  ]
}
```

Every `docsNav[].link` must be `/docs/` or start with it. It labels or splits the docs mount, and is not a second general-purpose `nav[]`. `docsNav` requires `docs` to be set, or the build fails.

### How the tree becomes a site

The sidebar is generated from your `docs` tree. It is not a fixed list.

| Source | Effect |
|---|---|
| Directory | A sidebar group named after the directory. The group heading links to the directory's `index.md` when it has one. Pages at the docs root form an unnamed group |
| File `guide/install.md` | The page `<base>docs/guide/install/` |
| File `index.md` | The page for its directory. `docs/index.md` is `<base>docs/`, and `guide/index.md` is `<base>docs/guide/` |
| Frontmatter `title` | The page title and sidebar label. Without it, the text of the page's first `#` heading, else the file name |
| Frontmatter `description` | The page's meta description. Without it, the site `description` |
| Frontmatter `order` | A number that sorts pages within a group. Pages without one sort last |
| Other files (images, downloads) | Copied to the same path under `<base>docs/`, so `docs/img/logo.png` is `<base>docs/img/logo.png` |

Pages sort by `order`, then title. Groups sort by the `order` of their `index.md`, then by directory path. Groups without an `index.md` sort after those with one, and the unnamed root group comes first. Two groups whose directories share a name, such as `a/guide` and `b/guide`, show their full paths as headings.

### What the mount does not render

The mount accepts a restricted Markdown dialect. If your tree was written for VitePress, check it:

- Only `.md` files are mounted as pages. `.mdx` files are skipped. Dot-files and dot-directories are skipped, and the Markdown source is never copied into the output.
- VitePress-only syntax is not interpreted. `::: details` and `::: tip` blocks show as plain text. Use a plain `<details>` element or ordinary Markdown instead.
- `{#custom-id}` heading anchors are not supported. The suffix stays in the heading text and its generated id. Remove the suffix and link to the generated id.
- `<span v-pre>` wrappers are not needed. Write plain inline code.
- Links to pages are rewritten. Every page URL is a directory ending in `/`, and the build resolves a relative link such as `./install.md`, `../guide/install.md` or `./install` against its own file. It drops `.md`, maps `index.md` to its directory and keeps any `?query` and `#fragment`. A root-relative link such as `/docs/guide/install/` gains `base`.
- A relative link or image to another file, such as `./diagram.svg`, is resolved against its own file and served from `<base>docs/`. Write it as `![](./diagram.svg)` and the copied file renders. A root-relative image such as `/img/logo.png` gains `base`.
- A link to a page or file that does not exist fails the build, naming the page and the link. Dot-files and `.mdx` or `.md` sources count as missing, because the build does not serve them. A root-relative `/docs/` link to a file in your `publicDir` is found there.
- External links (`http`, `https` and `//`) open in a new tab with `rel="noreferrer"`. `mailto:` and `#fragment` links stay as written. A link written as raw HTML (`<a href>`) is not rewritten, so write it in Markdown.
- Every heading gets a permalink: a `#` that appears when you hover or focus the heading.
- Heading ids are generated and can differ from VitePress ids. A heading like `config.json` becomes `configjson`. Check every `#fragment` link.
- Fenced code blocks are syntax-highlighted. The colours follow the theme's light and dark code tokens. Give the fence a language, as in ` ```sh `, to choose the grammar.
- A file name may use spaces and non-ASCII letters, and the page URL percent-encodes them. A name with `#`, `?`, `%`, `\` or a control character fails the build with exit `65`. So do two names that differ only in letter case or Unicode normalisation (`Guide.md` and `guide.md`).
- A symbolic link anywhere in the docs tree fails the build with exit `65`. So does a copied file that would take a page's place, such as `guide/index.html` next to a `guide` page. So does a file that would overwrite one already in `publicDir/docs/`. Rename the file.

The mount shows an "On this page" outline of each page's `##` and `###` headings from 75rem wide. Below 40rem the sidebar and outline fold into a "Contents" button that opens them in a drawer.

Docs are trusted content rendered at build time, so review a docs change the way you review code.
