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

`css` is a path relative to the config file. It's imported **after** the theme's own stylesheet in the generated build, so any custom property or selector your file redeclares wins the cascade.

### CSS custom properties

The theme exposes its full design system as CSS custom properties (`src/theme/styles/tokens/*.css`), scoped to `:root` (light) and `.dark` (dark mode). Override any of them from your `css` file:

```css
:root {
  --c-accent: #2563eb;
  --font-sans: "Inter", sans-serif;
}

.dark {
  --c-accent: #60a5fa;
}
```

| Family | File | Example tokens |
|---|---|---|
| Color | `palette.css` | `--c-bg`, `--c-surface`, `--c-surface-2`, `--c-line`, `--c-text-1`/`-2`/`-3`, `--c-accent`, `--c-accent-hover`, `--c-accent-text`, `--c-ok`, `--c-warn`, `--c-kw`, `--c-code-bg`, `--c-code-text`, `--c-overlay` |
| Shape | `shape.css` | `--radius-sm`/`-md`/`-lg`/`-full`, `--space-1` through `--space-8` |
| Type | `type.css` | `--font-sans`, `--font-mono`, `--text-2xl` through `--text-2xs` |

Only reassign variables — the example above is the whole pattern. Anything set under `.dark` overrides that variable for dark mode only.

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

`docs` mounts a Markdown tree at `/docs/**` and automatically adds a "docs" link to the top nav — you don't list it in `nav[]` yourself.

!!! warning
    The docs sidebar is a **fixed** list, not generated from your `docs` tree. It's hardcoded in `src/theme/components/docs/data/docsNav.ts` to exactly these groups and slugs — `ocx-sh/index`'s own documentation pages:

    - **Reference**: `wire-format`, `entry-schema`, `namespace-policy`, `governance-contracts`, `changelog`
    - **How-to**: `claim-a-namespace`, `announce-a-package`, `yank-a-version`
    - **Ops**: `m1-flip`, `run-reconcile-dry-run`
    - **Explanation**: `architecture`
    - **Legal**: `privacy`

    If your `docs` tree uses different filenames, the sidebar still renders these exact links, and any that don't match a file in your tree 404. Check `src/theme/components/docs/data/docsNav.ts` directly before relying on this mount for a docs tree shaped differently from `ocx-sh/index`'s own.
