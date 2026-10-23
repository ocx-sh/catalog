/**
 * The tags the detail page did not prerender (D-149, D-091, D-093, D-060, D-071). The page carries a bounded
 * tree (`lib/versionTable.ts`'s `prerender`); this module, loaded by `client/detail.ts` on the first
 * interaction that needs it, fetches the package's own root and fills the gap:
 *   - `showAll()` draws the whole tree of every variant row from the root, cloning the `<template>`s
 *     `VersionList.astro` renders (the same markup, placeholder data), so a late tag has the prerendered
 *     tag's markup and scoped styles. The wire tree is read, never written.
 *   - `release(tag)` fetches one tag's image index for the hover preview and reads its platforms and
 *     annotations the way the build does (`lib/releaseFacts.ts`).
 * Nothing is fetched before one of them is called. A failed fetch leaves the prerendered page as it is and
 * says why in the status line: "Failed to load: HTTP 500" (D-091, D-093), and the next call tries again.
 *
 * Markup contract, inside the mount root `[data-versions]`:
 *   - root attributes             `data-base`, `data-ns`, `data-pkg`, `data-wire-base` (the route's bare
 *                                 namespace and package and the source mount prefix, never `root.name`),
 *                                 `data-status` (the package status the table is built with)
 *   - `[data-variant]` rows       one per variant (`""` for the default), each with a `[data-major-groups]`
 *                                 inside its `[data-breakdown]`; the row `[data-variant-other]` holds
 *                                 `[data-other-list]`
 *   - `[data-versions-status]`    an `aria-live` line this module writes
 *   - `[data-lazy]`               every `<details>` with something to fetch; cleared once it is drawn
 *   - `[data-track-list]`         the prerendered tracks and `[data-track-more]` the overflow, each redrawn from
 *                                 `template[data-tpl=track]` (a minor line with a `[data-kicker]`)
 *   - `template[data-tpl=chip]`   a tag chip; `template[data-tpl=major]` a major line with one minor line,
 *                                 one patch chip and one yank reason (`MajorGroup.astro`'s hooks: `data-major`,
 *                                 `data-minor`, `data-head`, `data-patches`, `data-count`, `data-patch-list`,
 *                                 `data-reasons`, `data-yanked-reason`)
 * Dispatches `ocx:versions:rendered` (bubbling) from the root once the tree is drawn. DOM is written with
 * `textContent`, `className`, `setAttribute` and template clones only.
 */
import { joinBase, wireHref } from "../../viewmodel/url.js";
import { createImageIndexLoader } from "../lib/imageIndexFetch.js";
import { fetchPackageRoot } from "../lib/packageRootFetch.js";
import { imageIndexFacts, type ReleaseFacts } from "../lib/releaseFacts.js";
import {
  buildVersionTable,
  minorGroupHasYanked,
  SSR_OTHER,
  SSR_TRACKS,
  tagTitle,
  type MajorGroup,
  type MinorGroup,
  type RenderedTag,
  type TrackGroup,
} from "../lib/versionTable.js";
import type { FetchLike, PackageRoot } from "../lib/wireTypes.js";
import type { Status } from "../../viewmodel/types.js";

export interface VersionsOptions {
  /** Defaults to the global `fetch`, read at call time. */
  readonly fetch?: FetchLike;
}

/** A tag's facts for the preview; `source` is already a safe `http(s)` URL or `null`. */
export type LateRelease = ReleaseFacts;

export interface Versions {
  /** Draws the whole tree; `open` also opens every `<details>`. Resolves whether the tree is drawn. */
  showAll(open: boolean): Promise<boolean>;
  /** The facts of `tag`, `null` when it has none or could not be loaded (the status line says why). */
  release(tag: string): Promise<LateRelease | null>;
}

function requireEl<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`versions: missing ${selector} in the versions root`);
  return el;
}

function requireData(key: string, value: string | undefined): string {
  if (value === undefined) throw new Error(`versions: no ${key} (set data-${key} on the root)`);
  return value;
}

function statusOf(value: string): Status {
  return value === "deprecated" || value === "yanked" ? value : "active";
}

function failure(error: unknown): string {
  return `Failed to load: ${error instanceof Error ? error.message : "unknown error"}`;
}

type ChipKind = "rolling" | "minor" | "child";

function fillChip(chip: HTMLElement, tag: string, label: string, kind: ChipKind, yanked: RenderedTag["yanked"], ephemeral: boolean, prerelease = false): HTMLElement {
  chip.dataset.tag = tag;
  chip.textContent = label;
  chip.className = `tag ${kind}${yanked === null ? "" : " yanked"}${ephemeral ? " ephemeral" : ""}${prerelease ? " prerelease" : ""}`;
  chip.toggleAttribute("data-ephemeral", ephemeral);
  chip.toggleAttribute("data-prerelease", prerelease);
  chip.toggleAttribute("data-yanked", yanked !== null);
  chip.title = tagTitle(yanked, ephemeral, prerelease);
  return chip;
}

export function createVersions(root: HTMLElement, options: VersionsOptions = {}): Versions {
  const base = requireData("base", root.dataset.base);
  const ns = requireData("ns", root.dataset.ns);
  const pkg = requireData("pkg", root.dataset.pkg);
  const wireBase = requireData("wire-base", root.dataset.wireBase);
  const packageStatus = statusOf(requireData("status", root.dataset.status));
  const statusLine = requireEl<HTMLElement>(root, "[data-versions-status]");
  // The cores build catalog-root-relative URLs; `base` is added here, once.
  const fetchImpl: FetchLike = options.fetch ?? ((url) => globalThis.fetch(url));
  const fetchFn: FetchLike = (url) => fetchImpl(joinBase(base, url));
  const loadImageIndex = createImageIndexLoader(fetchFn);
  let failed = false;
  const setStatus = (text: string): void => {
    failed = text.startsWith("Failed to load");
    statusLine.textContent = text;
  };

  let rootRequest: Promise<PackageRoot> | null = null;
  /** The package root, fetched once and shared by the opened breakdowns and the previews. A failure is not kept. */
  function loadRoot(): Promise<PackageRoot> {
    if (rootRequest === null) {
      const request = fetchPackageRoot(fetchFn, ns, pkg, wireBase).then((result) => {
        if (result.status === "ok") return result.root;
        throw new Error(`Package not found: ${ns}/${pkg}`);
      });
      rootRequest = request;
      request.catch(() => {
        rootRequest = null;
      });
    }
    return rootRequest;
  }

  /** A copy of `el` in this document: a template's content belongs to an inert one. */
  const copyOf = (el: HTMLElement): HTMLElement => root.ownerDocument.importNode(el, true);
  const clone = (name: string): HTMLElement =>
    copyOf(requireEl<HTMLElement>(requireEl<HTMLTemplateElement>(root, `template[data-tpl="${name}"]`).content, "*"));

  function renderMinor(node: HTMLElement, minor: MinorGroup, prerelease = false): HTMLElement {
    fillChip(requireEl(node, "[data-head] [data-tag]"), minor.tag, minor.label, "minor", minor.yanked, minor.ephemeral, prerelease);
    const details = requireEl<HTMLElement>(node, "[data-patches]");
    if (minor.patches.length === 0) {
      details.remove();
      return node;
    }
    const patchList = requireEl<HTMLElement>(details, "[data-patch-list]");
    const chip = requireEl<HTMLElement>(patchList, "[data-tag]");
    patchList.replaceChildren(...minor.patches.map((patch) => fillChip(copyOf(chip), patch.tag, patch.tag, "child", patch.yanked, patch.ephemeral, prerelease)));
    requireEl(details, "[data-count]").textContent = `+${minor.patches.length}`;
    const warn = minorGroupHasYanked(minor);
    const summary = requireEl<HTMLElement>(details, "summary");
    summary.classList.toggle("warn", warn);
    if (warn) summary.title = "Contains a yanked version";
    else {
      summary.removeAttribute("title");
      requireEl(summary, ".warn-icon").remove();
    }
    const reasons = requireEl<HTMLElement>(details, "[data-reasons]");
    const reason = requireEl<HTMLElement>(reasons, "[data-yanked-reason]");
    const yanked = minor.patches.flatMap((patch) => (patch.yanked === null ? [] : [{ tag: patch.tag, yank: patch.yanked }]));
    if (yanked.length === 0) reasons.remove();
    else {
      reasons.replaceChildren(
        ...yanked.map(({ tag, yank }) => {
          const item = copyOf(reason);
          for (const child of [...item.childNodes]) if (child.nodeType === 3) child.remove();
          item.append(`${tag} yanked — ${yank.reason} · ${yank.at.slice(0, 10)}`);
          return item;
        }),
      );
    }
    return node;
  }

  function renderMajor(major: MajorGroup): HTMLElement {
    const node = clone("major");
    fillChip(requireEl(node, "[data-head] [data-tag]"), major.tag, major.label, "rolling", major.yanked, major.ephemeral);
    const minorTemplate = requireEl<HTMLElement>(node, "[data-minor]");
    minorTemplate.remove();
    node.append(...major.minorGroups.map((minor) => renderMinor(copyOf(minorTemplate), minor)));
    return node;
  }

  function renderTrack(track: TrackGroup): HTMLElement {
    const node = renderMinor(clone("track"), track, true);
    requireEl(node, "[data-kicker]").textContent = track.key;
    return node;
  }

  const minorTag = (minor: Element): string | undefined => minor.querySelector<HTMLElement>("[data-head] [data-tag]")?.dataset.tag;

  function render(wire: PackageRoot): void {
    // The patch lists the visitor opened; the redraw replaces their elements, so they are reopened by minor tag.
    const opened = new Set(
      [...root.querySelectorAll("[data-minor]")].filter((minor) => minor.querySelector<HTMLDetailsElement>("details[data-patches]")?.open).map(minorTag),
    );
    const table = buildVersionTable(
      Object.fromEntries(Object.entries(wire.tags).map(([tag, entry]) => [tag, { content: entry.content, yanked: entry.yanked ?? null, ephemeral: entry.ephemeral === true, observed: entry.observed }])),
      packageStatus,
    );
    // Everything is built before anything is swapped in: a failure part-way leaves the prerendered page as it is.
    const swaps: [Element, HTMLElement[]][] = [];
    for (const rowEl of root.querySelectorAll<HTMLElement>("[data-variant]")) {
      const row = table.rows.find((candidate) => (candidate.variant ?? "") === rowEl.dataset.variant);
      const groups = rowEl.querySelector("[data-major-groups]");
      // A row the fetched root no longer has (the index moved on since the build) keeps its prerendered tags.
      if (row !== undefined && groups !== null) swaps.push([groups, row.majorGroups.map(renderMajor)]);
    }
    const other = root.querySelector("[data-other-list]");
    if (other !== null) {
      const chip = clone("chip");
      swaps.push([other, table.unknownTags.slice(SSR_OTHER).map((tag) => fillChip(copyOf(chip), tag.tag, tag.tag, "child", tag.yanked, tag.ephemeral))]);
    }
    // The first SSR_TRACKS tracks are redrawn in place (a track's own builds may have been cut); the overflow list holds the rest.
    for (const [selector, tracks] of [["[data-track-list]", table.tracks.slice(0, SSR_TRACKS)], ["[data-track-more]", table.tracks.slice(SSR_TRACKS)]] as const) {
      const list = root.querySelector(selector);
      if (list !== null) swaps.push([list, tracks.map(renderTrack)]);
    }
    for (const [target, nodes] of swaps) target.replaceChildren(...nodes);
    for (const minor of root.querySelectorAll("[data-minor]")) {
      const details = minor.querySelector<HTMLDetailsElement>("details[data-patches]");
      if (details && opened.has(minorTag(minor))) details.open = true;
    }
    for (const lazy of root.querySelectorAll("[data-lazy]")) lazy.removeAttribute("data-lazy");
    root.dispatchEvent(new CustomEvent("ocx:versions:rendered", { bubbles: true }));
  }

  let drawing: Promise<boolean> | null = null;
  async function draw(): Promise<boolean> {
    setStatus("Loading all versions…");
    try {
      render(await loadRoot());
      setStatus("");
      return true;
    } catch (error) {
      setStatus(failure(error));
      return false;
    }
  }

  return {
    async showAll(open) {
      drawing ??= draw();
      if (!(await drawing)) {
        drawing = null;
        return false;
      }
      if (open) for (const details of root.querySelectorAll<HTMLDetailsElement>("details[data-breakdown]")) details.open = true; // the patch panels float: one at a time
      return true;
    },

    async release(tag) {
      try {
        const wire = await loadRoot();
        // `Object.hasOwn`: a tag called `constructor` is a tag, not a method of the map.
        const entry = Object.hasOwn(wire.tags, tag) ? wire.tags[tag] : undefined;
        if (entry === undefined) return null;
        const index = await loadImageIndex(ns, pkg, entry.content, wireBase);
        if (index === null) throw new Error("image index unavailable");
        const facts = imageIndexFacts(index, entry.content);
        // The root's own `source` wins over the tag's annotation, as it does for a prerendered tag.
        const release = { ...facts, source: wireHref(wire.source ?? facts.source) };
        // A preview that worked supersedes an earlier failure notice.
        if (failed) setStatus("");
        return release;
      } catch (error) {
        setStatus(failure(error));
        return null;
      }
    },
  };
}
