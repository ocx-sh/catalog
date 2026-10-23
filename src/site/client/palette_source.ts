/**
 * The palette's lazy half (C-011): the catalog's search, handed to the theme's
 * `mountCommandPalette` as its `source`. Imported on the first open only, so
 * none of MiniSearch, the loader or the fetches are parsed before input.
 *
 * `search` answers a query with a "Packages" group (`filterPackages` over
 * `catalog.json`, 8 rows, each linked by `packageHref`, C-009) and, when the
 * site has a docs mount, a "Docs" group (`searchDocs` over `docs-index.json`,
 * breadcrumbs as the description). `warm` runs on every open and fetches both
 * ahead of the first query. A catalog failure rejects, which the theme shows as
 * its error line (the next query retries); a docs failure only drops the Docs
 * group, so packages keep working. `base` and the docs flag come from the
 * `.ocx-palette` wrapper's `data-base` / `data-docs`, never a global (C-033).
 */
import { packageHref } from "../../viewmodel/url.js";
import { CATALOG_PATH, sharedCatalogLoader } from "../lib/catalogFetch.js";
import { searchDocs } from "../lib/docsIndex.js";
import { DOCS_INDEX_PATH, type DocsIndexEntry } from "../lib/docsIndexWire.js";
import { filterPackages } from "../lib/filterPackages.js";
import { byRelevance, scorePackages } from "../lib/packageSearch.js";
import type { FetchLike } from "../lib/wireTypes.js";
import type { PaletteGroup, PaletteItem, PaletteSource } from "@ocx-sh/theme/command-palette";

const RESULT_LIMIT = 8;

export interface PaletteSourceEnv {
  /** Catalog base (`/` or `/seg/`). */
  readonly base: string;
  /** The site has a docs mount, so `docs-index.json` exists. */
  readonly docs: boolean;
  /** Defaults to the global `fetch`, read at call time. */
  readonly fetch?: FetchLike;
}

/** The Docs group's rows; a malformed entry drops this group, never the Packages group beside it. */
function docsItems(pages: DocsIndexEntry[], text: string): PaletteItem[] {
  try {
    return searchDocs(pages, text, RESULT_LIMIT).map((page) => ({
      href: page.href,
      label: page.title,
      ...(page.crumbs.length === 0 ? {} : { description: page.crumbs.join(" › ") }),
    }));
  } catch {
    return [];
  }
}

export function createPaletteSource({ base, docs, fetch }: PaletteSourceEnv): Required<PaletteSource> {
  const loader = sharedCatalogLoader(`${base}${CATALOG_PATH}`, fetch);
  let docsIndex: Promise<DocsIndexEntry[]> | undefined;

  // Cached on success; a failure is dropped so the next query retries.
  const loadDocs = (): Promise<DocsIndexEntry[]> => {
    docsIndex ??= (async () => {
      const response = await (fetch ?? ((url) => globalThis.fetch(url)))(`${base}${DOCS_INDEX_PATH}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data: unknown = await response.json();
      if (!Array.isArray(data)) throw new Error("docs-index.json is not a docs index");
      return data as DocsIndexEntry[];
    })().catch((error: unknown) => {
      docsIndex = undefined;
      throw error;
    });
    return docsIndex;
  };

  // A docs failure only drops the Docs group.
  const docsPages = (): Promise<DocsIndexEntry[]> => (docs ? loadDocs().catch(() => []) : Promise.resolve([]));

  return {
    async search(query) {
      const text = query.trim();
      if (text === "") return [];
      const [catalog, pages] = await Promise.all([loader.load(), docsPages()]);
      const groups: PaletteGroup[] = [
        {
          label: "Packages",
          items: byRelevance(filterPackages(catalog.packages, { query: text }), scorePackages(catalog.packages, text))
            .slice(0, RESULT_LIMIT)
            .map((pkg) => ({
              href: packageHref(pkg.name, catalog.indexes, base),
              label: pkg.title,
              description: pkg.name,
            })),
        },
      ];
      if (docs) {
        groups.push({
          label: "Docs",
          items: docsItems(pages, text),
        });
      }
      return groups;
    },
    warm: () => Promise.all([loader.load(), docsPages()]),
  };
}

let live: Required<PaletteSource> | undefined;

/** The source for this page, built on first use from the wrapper's `data-*` (the theme calls the exports below). */
function pageSource(): Required<PaletteSource> {
  if (live) return live;
  const wrapper = document.querySelector<HTMLElement>(".ocx-palette");
  const base = wrapper?.dataset.base;
  if (base === undefined) throw new Error("palette: no data-base on .ocx-palette");
  return (live = createPaletteSource({ base, docs: wrapper?.dataset.docs !== undefined }));
}

export const search: PaletteSource["search"] = (query, signal) => pageSource().search(query, signal);
export const warm = (): unknown => pageSource().warm();
