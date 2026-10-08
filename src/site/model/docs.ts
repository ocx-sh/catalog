/**
 * The docs list: sidebar groups by directory, ordered by frontmatter `order`
 * then title. Pure over pre-scanned entries — the filesystem scan belongs to
 * the build (`docs_scan.ts`'s `scanDocs`, wired by the engine), so `siteModel`
 * stays pure (C-031).
 */
import { joinBase } from "../../viewmodel/url.js";

/** One docs page as scanned from the `docs` directory. */
export interface DocsSource {
  /**
   * The route under `/docs/`, `/`-separated: the path without `.md`, except that
   * an `index.md` maps to its directory — `""` for the docs root, `"guide"` for
   * `guide/index.md`. A section's index page is therefore the section's own route.
   */
  readonly slug: string;
  /** Content-collection id: the file's path without `.md` (`"index"`, `"guide/index"`). */
  readonly id: string;
  readonly title: string;
  readonly order?: number;
}

export interface DocsPageView {
  readonly slug: string;
  readonly id: string;
  readonly title: string;
  readonly href: string;
}

export interface DocsGroup {
  /** Directory name; `""` for pages at the docs root. */
  readonly label: string;
  readonly pages: readonly DocsPageView[];
}

export interface DocsView {
  readonly groups: readonly DocsGroup[];
  /** Every page, in sidebar order — `docs.astro`'s `getStaticPaths` input. */
  readonly pages: readonly DocsPageView[];
}

/** Code-unit order, so the result never depends on the build machine's locale. */
const compare = <T extends string | number>(a: T, b: T): number => (a < b ? -1 : a > b ? 1 : 0);

/** Pages ordered by `order` (absent sorts last), then title (case-insensitive), then slug. */
const byOrderThenTitle = (a: DocsSource, b: DocsSource): number =>
  compare(a.order ?? Infinity, b.order ?? Infinity) ||
  compare(a.title.toLowerCase(), b.title.toLowerCase()) ||
  compare(a.slug, b.slug);

export const docsView = (sources: readonly DocsSource[], base: string): DocsView => {
  const byDirectory = new Map<string, DocsSource[]>();
  for (const source of [...sources].sort(byOrderThenTitle)) {
    // The file's directory, so a section's `index.md` sits in that section's group.
    const directory = source.id.slice(0, Math.max(0, source.id.lastIndexOf("/")));
    byDirectory.set(directory, [...(byDirectory.get(directory) ?? []), source]);
  }
  const groups = [...byDirectory]
    .sort(([a], [b]) => compare(a, b))
    .map(([label, pages]) => ({
      label,
      pages: pages.map(({ slug, id, title }) => ({
        slug,
        id,
        title,
        href: joinBase(base, slug === "" ? "/docs/" : `/docs/${slug}/`),
      })),
    }));
  return { groups, pages: groups.flatMap((group) => group.pages) };
};
