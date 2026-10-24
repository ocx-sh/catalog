/**
 * Chrome props for the page shell: `neutral` renders the mirror's own
 * brand/nav/footer, `ocx` the ocx.sh header (the theme's `nav.json`, so no
 * brand, nav, footer or docs entries here). Shapes follow `Shell.astro`'s
 * `brand`/`nav`/`footer` props. Nav, footer, docs and `favicon` hrefs are
 * `base`-joined (an absolute `http(s)` one stays); `brand.logoSrc` stays
 * catalog-root-relative (C-008) — `Page.astro` joins `base` when it renders
 * it. The consumer `css` is not carried: the integration bundles it. Pure (C-031).
 */
import { basename } from "node:path";
import type { CatalogConfig } from "../../config/types.js";
import { joinBase } from "../../viewmodel/url.js";

interface ChromeLink {
  readonly label: string;
  readonly href: string;
}

export interface ChromeView {
  readonly mode: "neutral" | "ocx";
  /** `null` in `ocx` mode: the shell owns the brand. `logoSrc` is catalog-root-relative. */
  readonly brand: { readonly title: string; readonly wordmark?: string; readonly logoSrc?: string } | null;
  /** The mirror's own header links (`nav[]`), `base`-joined; empty in `ocx` mode. */
  readonly nav: readonly ChromeLink[];
  readonly footer: { readonly links: readonly ChromeLink[] };
  /** The docs-mount links, `base`-joined; empty without `docs` and in `ocx` mode. */
  readonly docsNav: readonly ChromeLink[];
  /** `base`-joined favicon href (or the absolute `http(s)` URL as written), `null` when none is configured. */
  readonly favicon: string | null;
  /** `og:site_name`: the brand title, `ocx.sh` under the ocx chrome. */
  readonly siteName: string;
  /** Site-wide tagline: the meta description of a page that has none. */
  readonly description: string | null;
  /** The docs mount's index href, `base`-joined; `null` without a `docs` mount. The ocx header does not link it: the docs are reached through the ocx.sh ecosystem menu (nav.json). */
  readonly docsHref: string | null;
  /** The catalog's `generated` timestamp, `null` when no package has activity; the footer's freshness stamp reads it. */
  readonly generated: string | null;
}

const OCX_SITE_NAME = "ocx.sh";

/** Site-relative links join `base`; absolute `http(s)` ones (validated by `loadConfig`: nav, footer, docsNav, favicon) stay. */
const joinLink = (base: string, link: string): string => (link.startsWith("/") ? joinBase(base, link) : link);

const links = (entries: readonly { text: string; link: string }[], base: string): ChromeLink[] =>
  entries.map(({ text, link }) => ({ label: text, href: joinLink(base, link) }));

export function chromeView(config: CatalogConfig, base: string, generated: string | null = null): ChromeView {
  const common = {
    favicon: config.favicon === undefined ? null : joinLink(base, config.favicon),
    description: config.description ?? null,
    docsHref: config.docs === undefined ? null : joinBase(base, "/docs/"),
    generated,
  };
  if (config.chrome === "ocx") {
    return { mode: "ocx", brand: null, nav: [], footer: { links: [] }, docsNav: [], siteName: OCX_SITE_NAME, ...common };
  }
  // `loadConfig` requires `brand` outside the ocx chrome.
  const { title, wordmark, logo } = config.brand ?? { title: "" };
  const docsNav =
    config.docs === undefined ? [] : links(config.docsNav ?? [{ text: "docs", link: "/docs/" }], base);
  return {
    mode: "neutral",
    brand: {
      title,
      ...(wordmark !== undefined && { wordmark }),
      ...(logo !== undefined && { logoSrc: `/${basename(logo)}` }),
    },
    nav: links(config.nav ?? [], base),
    footer: { links: links(config.footer?.links ?? [], base) },
    docsNav,
    siteName: title,
    ...common,
  };
}
