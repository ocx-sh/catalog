/**
 * Head/SEO derivation for `Page.astro` (C-022), pure so it is unit-tested
 * without rendering. The page's own `title`/`description` arrive from its view
 * (`DetailView`, landing, docs); a package whose wire root has no `desc` block
 * reaches here with an empty description and falls through to the generic
 * copy. Canonical and `og:url` exist only when the build has a `siteUrl`
 * (`Astro.site`), never as a guess.
 */

export interface MetaTag {
  readonly property?: string;
  readonly name?: string;
  readonly content: string;
}

export interface SeoInput {
  /** `og:site_name`: the brand title. */
  readonly siteName: string;
  /** Site-wide tagline, the fallback for a page without a description. */
  readonly siteDescription: string | null;
  readonly title: string;
  readonly description?: string;
  /** The page's own canonical URL; honoured only when `site` is set. */
  readonly canonical?: string | URL;
  /** Request path, including `base` (the canonical when `canonical` is absent). */
  readonly pathname: string;
  /** `Astro.site`, set exactly when `siteUrl` is configured. */
  readonly site: URL | undefined;
  /** `base`-joined brand logo href, the site-wide `og:image`. */
  readonly logoHref: string | null;
}

export interface SeoHead {
  /** The `<title>`: `title | siteName`, bare when the page is the site itself. */
  readonly title: string;
  readonly description: string;
  /** Absolute canonical/`og:url`, `null` without a `siteUrl`. */
  readonly url: string | null;
  readonly tags: readonly MetaTag[];
}

export function seoHead(input: SeoInput): SeoHead {
  const { siteName, title, site } = input;
  const documentTitle = title === siteName ? title : `${title} | ${siteName}`;
  const description = input.description || input.siteDescription || `${title} on ${siteName}.`;
  const url = site === undefined ? null : new URL(input.canonical ?? input.pathname, site).href;
  // An absolute image URL where one can be built: some crawlers require it.
  const image = input.logoHref === null ? null : site === undefined ? input.logoHref : new URL(input.logoHref, site).href;
  const tags: MetaTag[] = [
    { property: "og:site_name", content: siteName },
    { property: "og:type", content: "website" },
    { property: "og:title", content: documentTitle },
    { property: "og:description", content: description },
    ...(url === null ? [] : [{ property: "og:url", content: url }]),
    ...(image === null
      ? []
      : [
          { property: "og:image", content: image },
          { name: "twitter:image", content: image },
        ]),
    { name: "twitter:card", content: "summary" },
  ];
  return { title: documentTitle, description, url, tags };
}

const FAVICON_TYPES: Readonly<Record<string, string>> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/** The `type` of a `<link rel="icon">`, from the extension; `undefined` for anything else. */
export function faviconType(href: string): string | undefined {
  return FAVICON_TYPES[/\.[^./]+$/.exec(href)?.[0].toLowerCase() ?? ""];
}
