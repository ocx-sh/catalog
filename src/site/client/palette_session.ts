/**
 * The palette island's lazy half (C-011): the catalog fetch and the search. It
 * is imported by `palette.ts` on the first interaction, so none of this is
 * parsed before input. The markup contract is the header of `palette.ts`.
 */
import { packageHref } from "../../viewmodel/url.js";
import { CATALOG_PATH, sharedCatalogLoader } from "../lib/catalogFetch.js";
import { requireEl } from "../lib/dom.js";
import { filterPackages } from "../lib/filterPackages.js";
import type { PaletteApi, PaletteOptions } from "./palette.js";

/** Row shape of the theme's `List` (`{ value, label, description? }`). */
interface ListItem {
  readonly value: string;
  readonly label: string;
  readonly description: string;
}

const RESULT_LIMIT = 8;
const ERROR_TEXT = "Could not load the package list.";

export function startSession(
  root: HTMLElement,
  base: string,
  options: PaletteOptions,
): { readonly api: PaletteApi; stop(): void } {
  const navigate = options.navigate ?? ((href: string) => location.assign(href));
  const loader = sharedCatalogLoader(`${base}${CATALOG_PATH}`, options.fetch);

  const dialog = requireEl<HTMLElement>(root, '[data-zag-root="dialog"]', "palette");
  const input = requireEl<HTMLInputElement>(root, 'input[type="search"]', "palette");
  const list = requireEl<HTMLElement>(root, '[data-zag-root="listbox"]', "palette");
  const status = requireEl<HTMLElement>(root, "[data-palette-status]", "palette");
  let current: readonly ListItem[] = [];

  const showError = (error: unknown): never => {
    status.textContent = ERROR_TEXT;
    throw error;
  };

  async function search(query: string): Promise<{ items: ListItem[] }> {
    const text = query.trim();
    current = [];
    status.textContent = "";
    if (text === "") return { items: [] };
    const catalog = await loader.load().catch(showError);
    current = filterPackages(catalog.packages, { query: text })
      .slice(0, RESULT_LIMIT)
      .map((pkg) => ({
        value: packageHref(pkg.name, catalog.indexes, base),
        label: pkg.title,
        description: pkg.name,
      }));
    if (current.length === 0) status.textContent = `No packages match “${text}”.`;
    return { items: [...current] };
  }

  const onFetch = (event: Event) => {
    const detail = (event as CustomEvent<{ filter: string; respond(page: Promise<{ items: ListItem[] }>): void }>).detail;
    detail.respond(search(detail.filter));
  };
  const onChange = (event: Event) => {
    const [href] = (event as CustomEvent<{ value: string[] }>).detail.value;
    if (href !== undefined) navigate(href);
  };
  const onInput = () => {
    list.dispatchEvent(new CustomEvent("ocx:list:filter", { detail: { text: input.value } }));
  };
  const onEnter = (event: KeyboardEvent) => {
    const first = current[0];
    if (event.key === "Enter" && !event.isComposing && first) navigate(first.value);
  };
  // First open fetches the catalog once; a failure shows inline and the next query retries.
  const onDialogChange = (event: Event) => {
    if ((event as CustomEvent<{ open: boolean }>).detail.open) void loader.load().catch(showError).catch(() => {});
  };

  list.addEventListener("ocx:list:fetch", onFetch);
  list.addEventListener("ocx:list:change", onChange);
  input.addEventListener("input", onInput);
  input.addEventListener("keydown", onEnter);
  dialog.addEventListener("ocx:dialog:change", onDialogChange);

  return {
    api: {
      open: () => {
        document.dispatchEvent(new CustomEvent("ocx:dialog:open", { detail: { id: dialog.dataset.zagId } }));
      },
    },
    stop: () => {
      list.removeEventListener("ocx:list:fetch", onFetch);
      list.removeEventListener("ocx:list:change", onChange);
      input.removeEventListener("input", onInput);
      input.removeEventListener("keydown", onEnter);
      dialog.removeEventListener("ocx:dialog:change", onDialogChange);
    },
  };
}

