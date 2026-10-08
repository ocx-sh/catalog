/**
 * The ⌘K command palette island (S-009, C-019). It drives markup the theme
 * already renders and animates (`ui/Dialog`, `ui/SearchField`, an async
 * `ui/List`) through their documented DOM events only; it imports nothing
 * from the theme and owns no dialog, focus or listbox logic.
 *
 * Markup contract (rendered by `components/Palette.astro`, K.2), all inside
 * the mount root:
 *   - `[data-palette-trigger]`          the header button
 *   - `[data-zag-root="dialog"]`        the `Dialog` (its `data-zag-id` is the
 *                                       id `ocx:dialog:open` is keyed on)
 *   - `input[type="search"]`            the `SearchField` input
 *   - `[data-zag-root="listbox"]`       the async `List`
 *   - `[data-palette-status]`           an `aria-live` line the island owns
 *                                       (inline error and empty state)
 *
 * Event wiring: the search input emits `ocx:list:filter` on the list; the
 * list answers by firing `ocx:list:fetch`, which this file answers with
 * `detail.respond(...)`; picking a row fires `ocx:list:change`, whose value
 * is the row's href, so a click and Enter navigate identically.
 *
 * Nothing loads before interaction (C-011): the entry is a few listeners; the
 * filter code is a dynamic `import()` behind `LazyMount.load`, and
 * `catalog.json` is fetched once, when the dialog first opens. `base` comes
 * from `options.base` or `data-base` on the root, never a global (C-033).
 * Every detail link is `packageHref` (C-009). DOM is written with
 * `textContent` only.
 */
import { isEditableTarget, requireEl } from "../lib/dom.js";
import type { FetchLike } from "../lib/wireTypes.js";
import type { LazyMount } from "./mount.js";

export interface PaletteOptions {
  /** Catalog base (`/` or `/seg/`); defaults to the root's `data-base`. */
  readonly base?: string;
  /** Defaults to the global `fetch`, read at call time. */
  readonly fetch?: FetchLike;
  /** Defaults to `location.assign`. */
  readonly navigate?: (href: string) => void;
}

/** What `LazyMount`'s `api` is once the session is live. */
export interface PaletteApi {
  open(): void;
}

function resolveBase(root: HTMLElement, options: PaletteOptions): string {
  const base = options.base ?? root.dataset.base;
  if (base === undefined) throw new Error("palette: no base (set data-base on the root or pass options.base)");
  return base;
}

/**
 * Wires the palette onto `root`: `Mod+K` (and the header trigger) open the
 * dialog, starting the lazy module first when it is not live yet.
 */
export function mountPalette(
  root: HTMLElement,
  lazy: LazyMount,
  options: PaletteOptions = {},
): { destroy(): void } {
  const base = resolveBase(root, options);
  const trigger = requireEl<HTMLElement>(root, "[data-palette-trigger]", "palette");
  const handle = lazy.mount(root, {
    trigger: "interaction",
    // The entry handles trigger clicks itself; a replayed click would open twice.
    replay: false,
    load: async () => {
      // The search and the catalog fetch are one lazy chunk: nothing of them is parsed before input.
      const { startSession } = await import("./palette_session.js");
      return { start: () => startSession(root, base, options) };
    },
  });

  const open = async () => {
    if (!handle.api) await handle.start();
    (handle.api as PaletteApi | undefined)?.open();
  };
  const onKeydown = (event: KeyboardEvent) => {
    if (isEditableTarget(document.activeElement)) return;
    const modK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
    if (!modK) return;
    event.preventDefault();
    void open();
  };
  const onTriggerClick = () => void open();

  document.addEventListener("keydown", onKeydown);
  trigger.addEventListener("click", onTriggerClick);
  return {
    destroy: () => {
      document.removeEventListener("keydown", onKeydown);
      trigger.removeEventListener("click", onTriggerClick);
      handle.destroy();
    },
  };
}
