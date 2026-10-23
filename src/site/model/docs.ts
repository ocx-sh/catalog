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
  /** Frontmatter `description`: the page's meta description. */
  readonly description?: string;
  readonly order?: number;
}

export interface DocsPageView {
  readonly slug: string;
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly href: string;
}

export interface DocsGroup {
  /** Directory path; `""` for pages at the docs root. */
  readonly label: string;
  /** The heading: the directory's own name, `-`/`_` as spaces; `""` for the docs root. */
  readonly title: string;
  /** The section's index page, when it has one: the heading links there. */
  readonly href?: string;
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

/**
 * Whether the docs-relative file `path` (`/`-separated) is carried to the built
 * site as an asset: not a dot-file or inside a dot-directory, and not a markdown
 * or MDX source. The copy (`copyDocsAssets`) and the dead-link check agree on it.
 */
export const isDocsAsset = (path: string): boolean =>
  !path.split("/").some((segment) => segment.startsWith(".")) && !/\.mdx?$/.test(path);

/** A slug as URL path segments: names may carry spaces and non-ASCII, which a link must percent-encode. */
const routePath = (slug: string): string => slug.split("/").map(encodeURIComponent).join("/");

/** A directory's own name (`ops/run-books` → `run books`), the heading its group shows. */
const groupTitle = (directory: string): string =>
  directory.slice(directory.lastIndexOf("/") + 1).replace(/[-_]+/g, " ");

export const docsView = (sources: readonly DocsSource[], base: string): DocsView => {
  const byDirectory = new Map<string, DocsSource[]>();
  for (const source of [...sources].sort(byOrderThenTitle)) {
    // The file's directory, so a section's `index.md` sits in that section's group.
    const directory = source.id.slice(0, Math.max(0, source.id.lastIndexOf("/")));
    byDirectory.set(directory, [...(byDirectory.get(directory) ?? []), source]);
  }
  // A group sorts by its index page's `order` (absent sorts last), then by path; the root group leads.
  const groupOrder = ([directory, pages]: [string, DocsSource[]]): number =>
    directory === "" ? -Infinity : (pages.find((page) => page.slug === directory)?.order ?? Infinity);
  // Groups whose own titles read the same show their raw directory path instead (`a/guide`, `a-b` vs `a_b`).
  const ownTitles = [...byDirectory.keys()].map(groupTitle);
  const groups = [...byDirectory]
    .sort((a, b) => compare(groupOrder(a), groupOrder(b)) || compare(a[0], b[0]))
    .map(([label, pages]) => {
      const views = pages.map(({ slug, id, title, description }) => ({
        slug,
        id,
        title,
        ...(description === undefined ? {} : { description }),
        href: joinBase(base, slug === "" ? "/docs/" : `/docs/${routePath(slug)}/`),
      }));
      const index = label === "" ? undefined : views.find((page) => page.slug === label);
      const shared = ownTitles.filter((title) => title === groupTitle(label)).length > 1;
      return { label, title: shared ? label : groupTitle(label), ...(index === undefined ? {} : { href: index.href }), pages: views };
    });
  return { groups, pages: groups.flatMap((group) => group.pages) };
};
