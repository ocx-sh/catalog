/**
 * The detail page's own script (D-052, D-055, D-058, D-060, D-061, D-071, D-073, D-074, D-149, D-171). It
 * starts on the first interaction with the page, or at once for a visitor with a stored pin (`detail_entry.ts`:
 * the server already rendered the default pick, so a first visit pays none of these bytes before input). It
 * fetches nothing at start: the facts of every prerendered tag are already in
 * the HTML, so its platforms, licence, source and revision are shown by revealing what the server rendered.
 * A tag the page left out (`lib/versionTable.ts`'s `prerender`), a breakdown or track list with something
 * to fetch load `client/versions.ts` on first need, which fetches the package root and the tag's image
 * index. Small by design (C-017's pre-input budget): that module and the copy code of
 * `@ocx-sh/theme/copy` are their own chunks. It writes DOM through `textContent`, `setAttribute`, `hidden` and `replaceChildren` only.
 *
 * Copying: a click (so Enter and Space, on a button) on a tag, the package-name badge, an install command
 * or the registry row copies and toasts; the element carries `data-copied` for 1.5 s, which is also the
 * guard against a second click. The same elements are the hosts of the page's `CopyMenu`s (context mode):
 * this script writes each host's `data-copy` (`lib/cardCopy.ts`, the one list of copy items), the install
 * commands' on every retarget. The menu, its keys and its focus return are the theme's.
 *
 * Markup contract (rendered by `pages/package.astro` and the components under it), inside the mount root
 * `[data-detail]` (`data-package`: the qualified name):
 *   - `[data-releases]`        `<ul hidden>` of `<li data-release="<i>" data-platform-set data-license
 *                              data-source-url data-revision>`: one per distinct image index; an empty
 *                              attribute means that release has no such fact. `data-initial` on the list
 *                              is the release the page opens on (empty for none)
 *   - `[data-tag][data-release]`  a tag button in the version tree: its `data-release` is an index above;
 *                              a click copies `name:tag`;
 *                              so does a click anywhere on a `[data-support-matrix]` row
 *                              (the Platforms card's dialog, `PlatformMatrix.astro`, whose rows
 *                              `client/support_matrix.ts` draws on the first click of its trigger)
 *                              ("Copied — :<tag> identifier")
 *   - `[data-name-copy]`       the package-name badge: a click copies the name ("package name")
 *   - `[data-registry-copy]`   the metadata registry row: a click copies its `data-registry`
 *                              ("registry address")
 *   - `[data-platforms]`       holds `[data-platform-set="<i>"][data-platform-key]` blocks (all but the open
 *                              one `hidden`; the key is the set's `os/arch` list, comma-joined), one
 *                              and one `[data-platform-empty]` note shown when a tag has none
 *   - `[data-versions]`        the version card (`client/versions.ts`'s contract): tags not prerendered
 *                              have no `data-release`; opening a `details[data-lazy]` loads
 *                              that module and the package root.
 *                              `ocx:versions:rendered` (bubbling) says new tags are in the tree
 *   - `[data-row="license|source|revision"]`  metadata rows (`hidden` when the release has none), each
 *                              with a `[data-field]` whose text is the value; the source row's `a` takes
 *                              the URL, the revision's `code` the text
 *   - `[data-install]`         the install card: `data-name` (the qualified name), `data-initial-tag`,
 *                              `[data-install-row]` rows each carrying `data-template` (a command with
 *                              `{name}`) and a `[data-install-copy][data-label]` button holding the
 *                              `[data-command]` (a click copies the command, "<label>"), optional
 *                              `select[data-install-variant]`, the theme `CommandBar[data-install-pin]`
 *                              (picker = pin choices, copy = the identifier; the island sets it through
 *                              `ocx:command-bar:set {choices, value}` and hears `ocx:select:change`) and
 *                              `template[data-install-options][data-variant]` (the `<option>`s of one
 *                              variant's pins, each with `data-rank` and `data-level`)
 */
import { cardCopyData } from "../lib/cardCopy.js";
import { DEFAULT_INSTALL_FLAVORS, installCommand } from "../lib/installFlavors.js";
import {
  browserStorage,
  installTarget,
  isPinLevel,
  pickPinned,
  readPin,
  writePin,
  type PinOption,
  type PinStorage,
} from "../lib/installPin.js";
import { absolutizeProvenance } from "./readme_provenance.js";
import type { FetchLike } from "../lib/wireTypes.js";
import type { Versions } from "./versions.js";

export interface DetailOptions {
  /** Defaults to the global `fetch` (the tags the page did not prerender). */
  readonly fetch?: FetchLike;
  /** Defaults to `localStorage` where it is readable. */
  readonly storage?: PinStorage | null;
}

/** How long a copied element reads as copied, and ignores a second click. */
const COPIED_MS = 1500;
// The install commands are the theme CommandBar: it copies and toasts itself, so only the context menu host is ours.
const COPY_CLICK = "[data-tag],[data-name-copy],[data-registry-copy],[data-support-matrix] tbody tr[data-ocx-row]";

/** Tag name to the release it shows; the first chip of a tag wins (a tag can appear twice in the tree). */
function tagReleases(root: HTMLElement): Map<string, number> {
  const releases = new Map<string, number>();
  for (const el of root.querySelectorAll<HTMLElement>("[data-tag][data-release]")) {
    // The selector guarantees both attributes, so `dataset.tag` is a string.
    const tag = String(el.dataset.tag);
    if (!releases.has(tag)) releases.set(tag, Number(el.dataset.release));
  }
  return releases;
}

/** Writes the texts the theme's `CopyMenu` offers on `host` (`null` tag: the bare package). */
function writeCopyData(host: HTMLElement, name: string, tag: string | null): void {
  host.dataset.copy = JSON.stringify(cardCopyData(name, tag, DEFAULT_INSTALL_FLAVORS));
}

/** What a click on a copy element copies, and what the toast calls it. */
function clickCopy(el: HTMLElement, name: string): { text: string; meaning: string } {
  const identifier = (tag: string | null) => String(cardCopyData(name, tag, []).identifier);
  if (el.matches("[data-tag]")) return { text: identifier(String(el.dataset.tag)), meaning: `:${el.dataset.tag} identifier` };
  if (el instanceof HTMLTableRowElement) {
    const tag = String(el.cells[0]?.textContent).trim();
    return { text: identifier(tag), meaning: `:${tag} identifier` };
  }
  if (el.matches("[data-name-copy]")) return { text: identifier(null), meaning: "package name" };
  // `COPY_CLICK`'s last host: the registry row.
  return { text: String(el.dataset.registry), meaning: "registry address" };
}

function setText(el: Element | null, text: string): void {
  if (el) el.textContent = text;
}

export function mount(root: HTMLElement, options: DetailOptions = {}): { destroy(): void; replay(event: Event): void } {
  const releaseTable = root.querySelector<HTMLElement>("[data-releases]");
  const releases = new Map<number, HTMLElement>();
  for (const el of releaseTable?.querySelectorAll<HTMLElement>("[data-release]") ?? []) {
    releases.set(Number(el.dataset.release), el);
  }
  const tagRelease = tagReleases(root);
  const platforms = [...root.querySelectorAll<HTMLElement>("[data-platforms] [data-platform-set]")];
  const platformEmpty = root.querySelector<HTMLElement>("[data-platform-empty]");
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  const cleanups: (() => void)[] = [];
  const on = (target: EventTarget, type: string, listener: (event: Event) => void, capture = false): void => {
    target.addEventListener(type, listener, capture);
    cleanups.push(() => target.removeEventListener(type, listener, capture));
  };

  /** What the install card's pick shows: the platform block of its release. */
  interface Shown {
    readonly set: string | undefined;
    readonly license: string;
    readonly source: string;
    readonly revision: string;
  }
  const shownRelease = (index: number | null): Shown | undefined => {
    const data = index === null ? undefined : releases.get(index)?.dataset;
    if (data === undefined) return undefined;
    return { set: data.platformSet, license: String(data.license), source: String(data.sourceUrl), revision: String(data.revision) };
  };

  /** Shows one release's platforms and annotations; `undefined` is the empty state. */
  function show(release: Shown | undefined): void {
    const set = release?.set;
    for (const el of platforms) el.hidden = el.dataset.platformSet !== set;
    if (platformEmpty) platformEmpty.hidden = set !== undefined;
    for (const field of ["license", "revision"] as const) {
      const value = release?.[field] ?? "";
      const row = root.querySelector<HTMLElement>(`[data-row="${field}"]`);
      if (row) row.hidden = value === "";
      setText(row?.querySelector("code") ?? row?.querySelector("[data-field]") ?? null, value);
    }
    const url = release?.source ?? "";
    const sourceRow = root.querySelector<HTMLElement>('[data-row="source"]');
    if (sourceRow) sourceRow.hidden = url === "";
    if (url !== "") {
      sourceRow?.querySelector("a")?.setAttribute("href", url);
      setText(sourceRow?.querySelector("[data-source-text]") ?? null, url);
    }
  }

  // The tags the page did not prerender: their facts, and the whole tree, come from `versions.ts`, loaded
  // by the first interaction that needs it.
  const versionsRoot = root.querySelector<HTMLElement>("[data-versions]");
  let versions: Promise<Versions> | undefined;
  const lazyVersions = (el: HTMLElement): Promise<Versions> =>
    (versions ??= import("./versions.js").then(({ createVersions }) => createVersions(el, { fetch: options.fetch })));

  if (versionsRoot) {
    const showAll = (open: boolean): void => void lazyVersions(versionsRoot).then((loaded) => loaded.showAll(open));
    // `toggle` does not bubble: take it on the way down. A breakdown with something to fetch loads it on opening.
    on(
      versionsRoot,
      "toggle",
      (event) => {
        const details = event.target;
        if (details instanceof HTMLDetailsElement && details.open && details.hasAttribute("data-lazy")) showAll(false);
      },
      true,
    );
  }

  const name = String(root.dataset.package);
  const writeTagHosts = (): void => {
    for (const host of root.querySelectorAll<HTMLElement>("[data-tag]:not([data-copy])")) writeCopyData(host, name, String(host.dataset.tag));
  };
  writeTagHosts();
  // The tags `versions.ts` draws later are hosts of the same menu.
  on(root, "ocx:versions:rendered", writeTagHosts);
  for (const host of root.querySelectorAll<HTMLElement>("[data-name-copy]")) writeCopyData(host, name, null);
  // A minor line's patches float in a panel: a click anywhere else, or Escape, closes it.
  const closePatches = (except: Element | null): void => {
    for (const open of root.querySelectorAll<HTMLDetailsElement>("details.patches[open]")) if (open !== except) open.open = false;
  };
  on(document, "click", (event) => closePatches(event.target instanceof Element ? event.target.closest("details.patches") : null));
  on(document, "keydown", (event) => {
    if ((event as KeyboardEvent).key === "Escape") closePatches(null);
  });
  // The support matrix loads on the first click of its dialog trigger (D-149): the shell and a skeleton are in
  // the page, `support_matrix.ts` fetches the rows, owns the platform chips and writes each row's copy texts.
  const matrixHost = root.querySelector<HTMLElement>("[data-support-matrix]");
  let matrix: Promise<unknown> | undefined;
  const onMatrixClick = (event: Event): void => {
    const trigger = event.target instanceof Element ? event.target.closest('.support-dialog [data-part="trigger"]') : null;
    if (trigger && matrixHost)
      matrix ??= import("./support_matrix.js").then(({ mountSupportMatrix }) => {
        const mounted = mountSupportMatrix(matrixHost, { fetch: options.fetch, name: String(root.dataset.package) });
        cleanups.push(mounted.destroy);
      });
  };
  on(root, "click", onMatrixClick);
  const copiedTimers = new Set<ReturnType<typeof setTimeout>>();
  cleanups.push(() => copiedTimers.forEach(clearTimeout));
  const onCopyClick = (event: Event): void => {
    const el = event.target instanceof Element ? event.target.closest<HTMLElement>(COPY_CLICK) : null;
    // `data-copied` is set at once: a second click, or a replay of this one, must not copy twice.
    if (!el) return;
    // A version chip also pins its tag in the install card.
    if (el.matches("[data-tag]")) root.querySelector("[data-install]")?.dispatchEvent(new CustomEvent("ocx:install:pin", { detail: { tag: el.dataset.tag } }));
    if (el.hasAttribute("data-copied")) return;
    el.setAttribute("data-copied", "");
    const { text, meaning } = clickCopy(el, name);
    void import("@ocx-sh/theme/copy").then(async ({ copyWithToast }) => {
      if (!(await copyWithToast(el, text, meaning))) return el.removeAttribute("data-copied");
      copiedTimers.add(setTimeout(() => el.removeAttribute("data-copied"), COPIED_MS));
    });
  };
  on(root, "click", onCopyClick);

  const card = root.querySelector<HTMLElement>("[data-install]");
  if (card) cleanups.push(mountInstall(card, storage, tagRelease, (index) => show(shownRelease(index))));

  // The README provenance menu's links name this page's origin (`readme_provenance.ts`).
  const provenance = root.querySelector<HTMLElement>("[data-readme-provenance]");
  if (provenance) absolutizeProvenance(provenance, location.href);

  return {
    destroy: () => cleanups.forEach((cleanup) => cleanup()),
    /** Runs the click handlers on a click that came before this module did (`detail_entry.ts`). */
    replay: (event) => {
      onMatrixClick(event);
      onCopyClick(event);
    },
  };
}

/** The pin choices of one variant's `template[data-install-options]`: the pin levels and the picker's choices. */
function variantPins(name: string, template: HTMLTemplateElement | undefined): { pins: PinOption[]; choices: { value: string; label: string; command: string }[] } {
  const options = [...(template?.content.querySelectorAll("option") ?? [])];
  return {
    pins: options.map((option) => ({
      tag: option.value,
      rank: Number(option.dataset.rank),
      label: isPinLevel(option.dataset.level) ? option.dataset.level : "rolling",
    })),
    choices: options.map((option) => ({
      value: option.value,
      label: String(option.dataset.level),
      command: installTarget(name, option.value),
    })),
  };
}

/** The install card: retargets the commands on a pick and restores the stored pick. */
function mountInstall(
  card: HTMLElement,
  storage: PinStorage | null,
  tagRelease: ReadonlyMap<string, number>,
  onTarget: (release: number | null) => void,
): () => void {
  const name = card.dataset.name ?? "";
  const variantSelect = card.querySelector<HTMLSelectElement>("select[data-install-variant]");
  const pinBar = card.querySelector<HTMLElement>("[data-install-pin]");
  const templates = [...card.querySelectorAll<HTMLTemplateElement>("template[data-install-options]")];
  /** The commands are hosts of the card's `CopyMenu`: its texts name the tag the card shows. */
  const writeHosts = (tag: string | null): void => {
    for (const host of card.querySelectorAll<HTMLElement>("[data-install-copy]")) writeCopyData(host, name, tag);
  };
  const cleanups: (() => void)[] = [];
  const on = (target: EventTarget, type: string, listener: (event: Event) => void): void => {
    target.addEventListener(type, listener);
    cleanups.push(() => target.removeEventListener(type, listener));
  };
  // A pick in the variant Select arrives as `ocx:select:change`; the handler below listens for the native select's change.
  on(card, "ocx:select:change", (event) => {
    const root = event.target instanceof Element ? event.target.closest('[data-zag-root="select"]') : null;
    const native = root?.querySelector("select");
    if (!native || root?.closest("[data-install-pin]")) return;
    native.value = String((event as CustomEvent<{ value?: string }>).detail?.value);
    native.dispatchEvent(new Event("change", { bubbles: true }));
  });

  if (pinBar) {
    const bar = pinBar;
    const variantTemplate = (): HTMLTemplateElement | undefined =>
      templates.find((template) => template.dataset.variant === (variantSelect?.value ?? template.dataset.variant));
    let pins = variantPins(name, variantTemplate()).pins;

    /** Points every command at `tag` and the page at its release. */
    function retarget(tag: string): void {
      const target = installTarget(name, tag === "" ? null : tag);
      if (target === null) return;
      for (const row of card.querySelectorAll<HTMLElement>("[data-install-row]")) {
        row.dispatchEvent(
          new CustomEvent("ocx:command-bar:set", {
            detail: { command: installCommand(row.dataset.template ?? "", target), label: row.dataset.label },
          }),
        );
      }
      writeHosts(tag);
      onTarget(tagRelease.get(tag) ?? null);
    }

    /** The version nearest the stored level, on the chain now in the picker; `choices` replaces the picker's when given. */
    function applyPin(choices?: { value: string; label: string; command: string }[]): void {
      const picked = pickPinned(pins, readPin(storage));
      if (picked === null) return;
      bar.dispatchEvent(new CustomEvent("ocx:command-bar:set", { detail: { choices, value: picked.tag } }));
      retarget(picked.tag);
    }

    // A pick in the picker: only a person's pick is stored, the fallback in `applyPin` never overwrites it.
    on(bar, "ocx:select:change", (event) => {
      const tag = String((event as CustomEvent<{ value?: string }>).detail?.value);
      const level = pins.find((pin) => pin.tag === tag)?.label;
      if (level !== undefined) writePin(storage, level);
      retarget(tag);
    });
    // A clicked version chip pins that tag.
    on(card, "ocx:install:pin", (event) => {
      const tag = String((event as CustomEvent<{ tag?: string }>).detail?.tag);
      if (!pins.some((pin) => pin.tag === tag)) return;
      bar.dispatchEvent(new CustomEvent("ocx:command-bar:set", { detail: { value: tag } }));
      retarget(tag);
    });
    if (variantSelect) {
      on(variantSelect, "change", () => {
        const next = variantPins(name, variantTemplate());
        pins = next.pins;
        applyPin(next.choices);
      });
    }
    applyPin();
  } else writeHosts(card.dataset.initialTag ?? null);

  return () => cleanups.forEach((cleanup) => cleanup());
}
