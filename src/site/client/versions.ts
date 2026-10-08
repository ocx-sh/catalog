/**
 * The detail page's versions island (S-008, C-016, C-033). It drives markup
 * the theme already renders (`ui/ActionMenu` in `context` mode) through its
 * documented events only; it imports nothing from the theme and owns no menu,
 * focus or positioning logic. A fetch-filled theme popover for the hover
 * preview is deferred to https://github.com/ocx-sh/website/issues/12.
 *
 * Markup contract (rendered by `components/VersionList.astro`, T.4), all
 * inside the mount root `[data-versions]`:
 *   - root attributes                  `data-base` (`/` or `/seg/`),
 *                                      `data-ns` and `data-pkg` (the route's
 *                                      bare namespace/package, never
 *                                      `root.name`), `data-wire-base` (the
 *                                      source mount prefix, `""` for the root
 *                                      source), `data-name` (the qualified
 *                                      name `DetailView.name`, the identifier
 *                                      the copy actions are built from)
 *   - `[data-zag-root="menu"]`         one `ActionMenu` with `context`,
 *                                      wrapping the list below. Its items are
 *                                      the same for every tag and their
 *                                      `value` is the action's label: "Copy
 *                                      identifier", "Copy tag", "Copy link",
 *                                      then one per `DEFAULT_INSTALL_FLAVORS`
 *                                      label. The island learns which tag the
 *                                      menu was opened on and answers
 *                                      `ocx:menu:select` by copying that tag's
 *                                      `buildTagCopyActions` command
 *   - `[data-versions-list]`           the tags, newest first. Every tag is a
 *                                      focusable element carrying
 *                                      `data-tag="<name>"` (the SSR'd newest
 *                                      `SSR_TAG_LIMIT`, then any this island
 *                                      appends)
 *   - `template[data-versions-tag]`    one tag's markup: its first element
 *                                      carries `data-tag` (value written
 *                                      here) and contains a
 *                                      `[data-tag-name]` that receives the
 *                                      tag name as text
 *   - `[data-versions-more]`           the "show all versions" button; the
 *                                      island hides it once all tags are in
 *   - `[data-versions-preview]`        one shared, initially `hidden` region
 *                                      with `role="status"`: the hovered or
 *                                      focused tag's platforms, or an inline
 *                                      error
 *   - `[data-versions-status]`         an `aria-live` line the island owns:
 *                                      "show all" result and errors, copy
 *                                      feedback
 *
 * Nothing loads before interaction (C-011): the entry is one `LazyMount`
 * registration; the session (and the wire fetch cores) are behind a dynamic
 * `import()`. The wire tree is read, never written: `fetchPackageRoot` and the
 * image-index loader build catalog-root-relative URLs from `ns`/`pkg`/
 * `wireBase` (C-016) and this file only prefixes `base` (`joinBase`). A tag's
 * digest is wire data, so it is checked through `casUrl` before it reaches a
 * URL. DOM is written with `textContent`/`setAttribute` and template clones
 * only; a failed fetch leaves the SSR'd tags as they are.
 */
import { joinBase } from "../../viewmodel/url.js";
import { createRequestGate } from "../lib/requestGate.js";
import type { FetchLike, PackageRoot } from "../lib/wireTypes.js";
import type { LazyMount } from "./mount.js";

export interface VersionsOptions {
  /** Catalog base (`/` or `/seg/`); defaults to the root's `data-base`. */
  readonly base?: string;
  /** Defaults to the global `fetch`, read at call time. */
  readonly fetch?: FetchLike;
  /** Defaults to `navigator.clipboard.writeText`, read at call time. */
  readonly copy?: (text: string) => Promise<void>;
}

const ALL_ERROR = "Could not load all versions.";
const PREVIEW_ERROR = "Could not load platforms for this version.";

function requireEl<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`versions: missing ${selector} in the versions root`);
  return el;
}

function requireData(key: string, value: string | undefined): string {
  if (value === undefined) throw new Error(`versions: no ${key} (set data-${key} on the root)`);
  return value;
}

interface Libs {
  readonly fetchPackageRoot: typeof import("../lib/packageRootFetch.js").fetchPackageRoot;
  readonly createImageIndexLoader: typeof import("../lib/imageIndexFetch.js").createImageIndexLoader;
  readonly casUrl: typeof import("../lib/cas.js").casUrl;
  readonly liveTagsNewestFirst: typeof import("../lib/liveTags.js").liveTagsNewestFirst;
  readonly visiblePlatforms: typeof import("../lib/platforms.js").visiblePlatforms;
  readonly buildTagCopyActions: typeof import("../lib/copyActions.js").buildTagCopyActions;
  readonly flavors: typeof import("../lib/installFlavors.js").DEFAULT_INSTALL_FLAVORS;
}

async function loadLibs(): Promise<Libs> {
  const [root, index, cas, live, platforms, copy, flavors] = await Promise.all([
    import("../lib/packageRootFetch.js"),
    import("../lib/imageIndexFetch.js"),
    import("../lib/cas.js"),
    import("../lib/liveTags.js"),
    import("../lib/platforms.js"),
    import("../lib/copyActions.js"),
    import("../lib/installFlavors.js"),
  ]);
  return {
    fetchPackageRoot: root.fetchPackageRoot,
    createImageIndexLoader: index.createImageIndexLoader,
    casUrl: cas.casUrl,
    liveTagsNewestFirst: live.liveTagsNewestFirst,
    visiblePlatforms: platforms.visiblePlatforms,
    buildTagCopyActions: copy.buildTagCopyActions,
    flavors: flavors.DEFAULT_INSTALL_FLAVORS,
  };
}

function startSession(root: HTMLElement, libs: Libs, options: VersionsOptions): { readonly api: undefined; stop(): void } {
  const base = options.base ?? requireData("base", root.dataset.base);
  const ns = requireData("ns", root.dataset.ns);
  const pkg = requireData("pkg", root.dataset.pkg);
  const wireBase = requireData("wire-base", root.dataset.wireBase);
  const name = requireData("name", root.dataset.name);
  const fetchImpl: FetchLike = options.fetch ?? ((url) => globalThis.fetch(url));
  const copy = options.copy ?? ((text: string) => navigator.clipboard.writeText(text));
  // The cores build catalog-root-relative URLs; `base` is added here, once.
  const fetchFn: FetchLike = (url) => fetchImpl(joinBase(base, url));
  const loadImageIndex = libs.createImageIndexLoader(fetchFn);

  const menu = requireEl<HTMLElement>(root, '[data-zag-root="menu"]');
  const list = requireEl<HTMLElement>(root, "[data-versions-list]");
  const template = requireEl<HTMLTemplateElement>(root, "template[data-versions-tag]");
  const more = requireEl<HTMLButtonElement>(root, "[data-versions-more]");
  const preview = requireEl<HTMLElement>(root, "[data-versions-preview]");
  const status = requireEl<HTMLElement>(root, "[data-versions-status]");

  let destroyed = false;
  let rootRequest: Promise<PackageRoot | null> | null = null;
  let menuTag: string | null = null;
  let previewTag: string | null = null;
  const previewGate = createRequestGate();

  const closest = (target: EventTarget | null, selector: string): HTMLElement | null =>
    target instanceof Element ? target.closest<HTMLElement>(selector) : null;
  const tagOf = (target: EventTarget | null): string | null => closest(target, "[data-tag]")?.dataset.tag ?? null;

  /** The package root, fetched once and shared by "show all" and the previews. A failure is not kept. */
  function loadRoot(): Promise<PackageRoot | null> {
    if (rootRequest === null) {
      rootRequest = libs.fetchPackageRoot(fetchFn, ns, pkg, wireBase, () => !destroyed).then((result) => {
        if (result.status === "ok") return result.root;
        if (result.status === "stale") return null;
        throw new Error("versions: package root not found");
      });
      rootRequest.catch(() => {
        rootRequest = null;
      });
    }
    return rootRequest;
  }

  async function showAll(): Promise<void> {
    // A disabled button takes no clicks, so one load is in flight at most.
    more.disabled = true;
    status.textContent = "";
    try {
      const wire = await loadRoot();
      if (wire === null) return; // destroyed mid-flight
      const shown = new Set([...list.querySelectorAll<HTMLElement>("[data-tag]")].map((el) => el.dataset.tag));
      const rest = libs.liveTagsNewestFirst(wire.tags).filter((tag) => !shown.has(tag));
      for (const tag of rest) {
        const item = template.content.firstElementChild?.cloneNode(true);
        if (!(item instanceof Element)) throw new Error("versions: the tag template is empty");
        const carrier = item.matches("[data-tag]") ? item : requireEl<HTMLElement>(item, "[data-tag]");
        carrier.setAttribute("data-tag", tag);
        requireEl<HTMLElement>(item, "[data-tag-name]").textContent = tag;
        list.append(item);
      }
      more.hidden = true;
      status.textContent = `Showing all ${list.querySelectorAll("[data-tag]").length} versions.`;
    } catch {
      more.disabled = false;
      status.textContent = ALL_ERROR;
    }
  }

  async function showPreview(tag: string): Promise<void> {
    const current = previewGate.begin();
    previewTag = tag;
    preview.hidden = false;
    preview.textContent = `${tag}: loading platforms…`;
    try {
      const wire = await loadRoot();
      const digest = wire !== null && Object.hasOwn(wire.tags, tag) ? wire.tags[tag]?.content : undefined;
      const url = libs.casUrl(`${ns}/${pkg}`, digest, "json", wireBase);
      const index = url === null || digest === undefined ? null : await loadImageIndex(ns, pkg, digest, wireBase);
      if (!current()) return;
      if (index === null) {
        preview.textContent = PREVIEW_ERROR;
        return;
      }
      const platforms = [
        ...new Set(libs.visiblePlatforms(index.manifests).map(({ platform }) => `${platform.os}/${platform.architecture}`)),
      ].sort();
      preview.textContent = `${tag}: ${platforms.length === 0 ? "no platforms" : platforms.join(", ")}`;
    } catch {
      if (current()) preview.textContent = PREVIEW_ERROR;
    }
  }

  function hidePreview(): void {
    previewGate.begin();
    previewTag = null;
    preview.hidden = true;
  }

  const onMore = (event: Event) => {
    if (closest(event.target, "[data-versions-more]")) void showAll();
  };
  const onOver = (event: Event) => {
    const tag = tagOf(event.target);
    if (tag !== null && tag !== previewTag) void showPreview(tag);
  };
  // Remember which tag the context menu opens on: `contextmenu` covers a right click and the
  // keyboard menu key, `pointerdown` the long press the menu runs on its own timer.
  const onMenuTarget = (event: Event) => {
    menuTag = tagOf(event.target);
    // Not on a tag: let the browser's own menu show instead of an action menu with nothing to copy.
    if (menuTag === null && event.type === "contextmenu") event.stopPropagation();
  };
  const onSelect = (event: Event) => {
    const { value } = (event as CustomEvent<{ value: string }>).detail;
    const action = menuTag === null ? undefined : libs.buildTagCopyActions(name, menuTag, libs.flavors).find((a) => a.label === value);
    if (action === undefined) return;
    copy(action.command).then(
      () => {
        status.textContent = `Copied: ${action.label}.`;
      },
      () => {
        status.textContent = "Could not copy to the clipboard.";
      },
    );
  };

  root.addEventListener("click", onMore);
  list.addEventListener("pointerover", onOver);
  list.addEventListener("focusin", onOver);
  list.addEventListener("pointerleave", hidePreview);
  list.addEventListener("focusout", hidePreview);
  list.addEventListener("contextmenu", onMenuTarget);
  list.addEventListener("pointerdown", onMenuTarget);
  menu.addEventListener("ocx:menu:select", onSelect);

  return {
    api: undefined,
    stop: () => {
      destroyed = true;
      root.removeEventListener("click", onMore);
      list.removeEventListener("pointerover", onOver);
      list.removeEventListener("focusin", onOver);
      list.removeEventListener("pointerleave", hidePreview);
      list.removeEventListener("focusout", hidePreview);
      list.removeEventListener("contextmenu", onMenuTarget);
      list.removeEventListener("pointerdown", onMenuTarget);
      menu.removeEventListener("ocx:menu:select", onSelect);
    },
  };
}

/**
 * Wires the versions island onto `root`: the first interaction loads the
 * session, which then answers "show all versions", tag hover/focus and the
 * copy menu's selections.
 */
export function mountVersions(root: HTMLElement, lazy: LazyMount, options: VersionsOptions = {}): { destroy(): void } {
  const handle = lazy.mount(root, {
    trigger: "interaction",
    load: async () => {
      const libs = await loadLibs();
      return { start: () => startSession(root, libs, options) };
    },
  });
  return { destroy: () => handle.destroy() };
}

/**
 * The island entry `VersionList.astro`'s script calls: `mount(el, { lazy })` with
 * the theme's `mount`. `lazy` is required rather than defaulted to a loader of
 * our own. The root carries `data-zag-root` so the theme can replay an early
 * "show all versions" click.
 */
export function mount(el: HTMLElement, options: VersionsOptions & { readonly lazy: LazyMount }): { destroy(): void } {
  const { lazy, ...rest } = options;
  return mountVersions(el, lazy, rest);
}
