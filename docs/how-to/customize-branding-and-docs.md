# Branding and docs mount

`catalog.config.json`'s `brand`, `css`, `nav`, and `docs` fields make a rendered catalog look and navigate like yours. This page covers each, plus the CSS variables the theme exposes for deeper styling.

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
| `logo` | The header's logo image, replacing the theme's built-in mark |

Only `title` is required.

`logo` is a **local file path only** — never a URL — resolved relative to the config file, and containment-checked the same way `docs`/`css`/`publicDir` are. The build copies it into the site's public root under its own filename and rewrites it to a site-root href for the browser. The same image also becomes the site-wide `og:image`/`twitter:image` (made absolute against `siteUrl` when that's configured).

## Custom stylesheet

```json
{ "css": "./assets/custom.css" }
```

`css` is a path relative to the config file, imported after the theme's own
stylesheet.

Source order is not what makes your rules win, though. The theme's CSS is
wrapped in a `@layer ocx` cascade layer, and **any unlayered rule beats a
layered one at any specificity** — so a plain `.package-card { … }` in your
file overrides the theme's internal rule without `!important` and without
having to out-specify it.

### Changing colours, spacing, type and shape

Every value the theme renders comes from a CSS custom property. Reassign the
ones you want:

```css
:root {
  --ocx-color-accent: #2563eb;
  --ocx-font-sans: "Inter", sans-serif;
  --ocx-radius-lg: 0; /* square corners everywhere */
}

.dark {
  --ocx-color-accent: #60a5fa;
}
```

**Set both `:root` and `.dark`.** They have the same specificity and both match
`<html>`, so a `:root`-only override applies in dark mode too and pins that
token to its light value. This is the most common way to accidentally break
dark mode.

The complete list, generated from the token sources, is in
[Theme tokens](../reference/theme-tokens.md).

### Restyling a specific component

Tokens change the whole site at once. To restyle one component, target its
`data-slot` attribute — a stable identity that does not change when the theme's
internal class names do:

```css
[data-slot="package-card"] {
  --ocx-package-card-radius: 0;
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.08);
}
```

Full list of slots and their hooks:
[Customizing components](customize-components.md).

**Never target the theme's own class names.** They are internal, unversioned,
and carry a build-specific `[data-v-…]` attribute — they will change without
notice.

## Nav links

```json
{
  "nav": [
    { "text": "GitHub", "link": "https://github.com/example/index" },
    { "text": "Status", "link": "/status" }
  ]
}
```

Each entry needs `text` and `link`. `link` must be either an absolute `http(s)` URL, or a path starting with `/` that genuinely resolves back onto the site's own origin (never `//`, which is protocol-relative and would silently leave the site). This is validated at config load, not just sanitized when the page renders — a value like `javascript:...` fails the build outright rather than surviving into a rendered `<a href>`.

`nav[]` is the header's own link list. The footer has a separate one — see [Footer links](#footer-links) below — so configuring `nav[]` alone adds nothing to the footer.

## Footer links

```json
{
  "footer": {
    "links": [{ "text": "Status", "link": "https://status.example.com" }]
  }
}
```

`footer.links[]` entries have the exact same shape and validation as `nav[]`. Omit `footer` entirely and the footer shows only its built-in `catalog json` link (a pointer at `/data/catalog/catalog.json`, the view model the site itself renders from — this package's own surface, free to change between versions, not the index's frozen `/p/**` wire format) — it does not fall back to `nav[]`.

## Other site metadata

| Field | Effect |
|---|---|
| `publicDir` | A directory (relative to the config file) copied verbatim into the site's public root — e.g. a `favicon.svg` inside it ends up served at `/favicon.svg`. Omit it and no extra public assets are copied |
| `favicon` | A site-root-relative href (e.g. `/favicon.svg`) emitted as the page's `<link rel="icon">`, with `type` inferred from the extension (`.svg`/`.png`/`.ico`; anything else emits no `type`). This is not a filesystem path this package reads — shipping the actual file is `publicDir`'s job. Omit it and no icon link is emitted at all |
| `description` | The site-wide tagline (VitePress's own `description` field), distinct from `brand.title`. Omit it and VitePress's own default applies |
| `siteUrl` | The deployment origin (e.g. `https://catalog.example.com`), feeding the sitemap and each page's `og:url`/canonical link. Omit it and the site still builds — it just skips the sitemap and those `og:url`/canonical tags |

## Docs mount

```json
{ "docs": "./docs" }
```

`docs` mounts a Markdown tree at `/docs/**`. By default this also adds a "docs" link to the top nav — you don't list it in `nav[]` yourself.

That auto entry is the *default*, not the only behaviour: `docsNav` replaces it with your own labelled entries, useful when the mounted tree isn't generically "docs" (a setup guide, for instance) or when you want more than one entry pointing into different subtrees.

```json
{
  "docs": "./docs",
  "docsNav": [
    { "text": "setup", "link": "/docs/setup/" },
    { "text": "reference", "link": "/docs/reference/" }
  ]
}
```

Every `docsNav[].link` must be `/docs/` or start with it — it labels/splits the docs mount, not a second general-purpose `nav[]`. `docsNav` requires `docs` to be set; configuring it without a docs mount fails the build outright. Omit `docsNav` and you get today's single auto "docs" entry, unchanged.

!!! warning
    The docs sidebar is a **fixed** list, not generated from your `docs` tree. It's hardcoded in `src/theme/components/docs/data/docsNav.ts` to exactly these groups and slugs — `ocx-sh/index`'s own documentation pages:

    - **Reference**: `wire-format`, `entry-schema`, `namespace-policy`, `governance-contracts`, `changelog`
    - **How-to**: `claim-a-namespace`, `announce-a-package`, `yank-a-version`
    - **Ops**: `m1-flip`, `run-reconcile-dry-run`
    - **Explanation**: `architecture`
    - **Legal**: `privacy`

    If your `docs` tree uses different filenames, the sidebar still renders these exact links, and any that don't match a file in your tree 404. Check `src/theme/components/docs/data/docsNav.ts` directly before relying on this mount for a docs tree shaped differently from `ocx-sh/index`'s own.
