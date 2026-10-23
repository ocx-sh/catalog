/**
 * The grid island's DOM contract as markup (`src/site/client/grid.ts`'s header),
 * built by hand so the island tests do not depend on the Astro components. The
 * real components are held to the same contract by the landing acceptance test.
 */
const field = (name: string, extra = "") => `<span data-field="${name}" ${extra}></span>`;
const glyph = (os: string) => `<template data-grid-os="${os}"><span data-os="${os}" role="img"></span></template>`;
// A LogoTile rendered with no name and no logo, as the templates carry it (the cube for the empty state).
const tile = (size: string) => `<span class="ocx-logo-tile" data-size="${size}" data-hue="0" data-state="empty" aria-hidden="true">
  <span class="ocx-logo-tile__initials"></span><span class="ocx-logo-tile__cube"><svg data-icon="box"></svg></span>
  <img class="ocx-logo-tile__image" hidden width="38" height="38" alt=""></span>`;
const cardItem = `<li class="item"><a data-card href="#">
  ${tile("lg")}${field("title")}${field("version")}
  ${field("deprecated", "hidden")}${field("yanked", "hidden")}${field("name")}${field("description")}${field("keywords")}
  ${field("platforms")}${field("tags")}<button type="button" data-grid-install>${field("install")}</button></a></li>`;
const rowItem = `<li class="item"><a data-card href="#">
  ${tile("sm")}${field("title")}
  ${field("deprecated", "hidden")}${field("yanked", "hidden")}${field("name")}${field("description")}${field("version")}
  ${field("platforms")}${field("tags")}</a></li>`;

const toggleGroup = (id: string, active: string, values: string[]) =>
  `<div data-zag-root="toggle-group" id="toggle-group:${id}" data-zag-props='{"defaultValue":["${active}"],"deselectable":false}'>${values
    .map(
      (value) =>
        `<button data-part="item" id="toggle-group:${id}:${value}" aria-checked="${value === active}" data-state="${value === active ? "on" : "off"}">${value}</button>`,
    )
    .join("")}</div>`;

const selectBox = (options: string[], active: string) =>
  `<div data-zag-root="select"><span class="ocx-ui-select__value" data-part="value-text">${active}</span><select>${options
    .map((value) => `<option value="${value}"${value === active ? " selected" : ""}> ${value} </option>`)
    .join("")}</select></div>`;

export interface Dom {
  readonly root: HTMLElement;
  readonly search: HTMLInputElement;
  readonly cards: HTMLElement;
  readonly table: HTMLElement;
  readonly count: HTMLElement;
  readonly sentinel: HTMLElement;
  readonly noMatch: HTMLElement;
  readonly failure: HTMLElement;
  readonly skeleton: HTMLElement;
  readonly rail: HTMLElement;
  readonly more: HTMLElement;
  readonly moreList: HTMLElement;
  readonly moreFilter: HTMLInputElement;
  readonly invert: HTMLElement;
  readonly toolbar: HTMLElement;
  readonly noData: HTMLElement;
  readonly moreEmpty: HTMLElement;
}

export interface DomOptions {
  readonly base?: string;
  /** `toggle` (a `ToggleGroup`) or `none` (a single index). */
  readonly scope?: "toggle" | "none";
  readonly scopeValues?: string[];
  /** Indexes behind the "+N" popover (the toggle group holds `scopeValues`). */
  readonly scopeOverflow?: string[];
  readonly ssrScope?: string;
  /** Server-rendered card names. */
  readonly ssrCards?: string[];
}

export function gridDom(options: DomOptions = {}): Dom {
  const { base = "/", scope = "none", scopeValues = [":all", "a", "b"], scopeOverflow = [], ssrScope = ":all", ssrCards = [] } = options;
  const overflow = scopeOverflow
    .map((value) => `<button data-grid-scope-option="${value}" aria-pressed="${value === ssrScope}">${value}</button>`)
    .join("");
  const scopeBox =
    scope === "none"
      ? ""
      : `<div data-grid-scope>${toggleGroup("scope", ssrScope, scopeValues)}${overflow && `<div data-grid-scope-more>${overflow}</div>`}</div>`;
  document.body.innerHTML = `<div data-grid data-base="${base}" data-scope="${ssrScope}">
    <div data-grid-toolbar>
    ${scopeBox}
    <input type="search" data-grid-search>
    <button data-grid-platform="linux" aria-pressed="false">linux</button>
    <button data-grid-platform="darwin" aria-pressed="false">darwin</button>
    <button data-grid-platform="windows" aria-pressed="false">windows</button>
    <button data-grid-status="deprecated" aria-pressed="false">deprecated</button>
    <button data-grid-status="yanked" aria-pressed="false">yanked</button>
    <div data-grid-keywords></div>
    <div data-grid-more hidden><span data-grid-more-count>0</span><input type="search" data-grid-more-filter><div data-grid-more-list></div><p data-grid-more-empty hidden>no keyword matches</p></div>
    <p data-grid-count role="status">0 packages</p>
    <button data-grid-clear hidden>clear filters</button>
    <div data-grid-sort>${selectBox(["name", "updated", "created"], "name")}</div>
    <button data-grid-invert aria-pressed="false"></button>
    <div data-grid-view>${toggleGroup("view", "cards", ["cards", "table"])}</div>
    </div>
    <div data-grid-empty="no-data" hidden></div>
    <div data-grid-empty="no-match" hidden><p data-field="title"></p><p data-field="message"></p><button data-grid-clear-search hidden>clear search</button><button data-grid-clear hidden>clear filters</button></div>
    <div data-grid-empty="error" hidden><p data-field="message"></p><button data-grid-retry>try again</button></div>
    <ul data-grid-skeleton hidden></ul>
    <template data-grid-skeleton-item><li class="item" data-skeleton-item></li></template>
    <ul data-grid-cards>${ssrCards
      .map((name) => `<li class="item"><a data-card data-key="${name}" href="/ssr/${name}/">ssr ${name}</a></li>`)
      .join("")}</ul>
    <ul data-grid-table hidden></ul>
    <div data-grid-sentinel hidden></div>
    <template data-grid-card>${cardItem}</template>
    <template data-grid-row>${rowItem}</template>
    <template data-grid-card-keyword><span data-slot="keyword"></span></template>
    <template data-grid-chip><button data-grid-chip aria-pressed="false">${field("keyword")}</button></template>
    ${["linux", "darwin", "windows", "any"].map(glyph).join("")}
  </div>`;
  const q = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
  return {
    root: q("[data-grid]"),
    search: q("[data-grid-search]"),
    cards: q("[data-grid-cards]"),
    table: q("[data-grid-table]"),
    count: q("[data-grid-count]"),
    sentinel: q("[data-grid-sentinel]"),
    noMatch: q('[data-grid-empty="no-match"]'),
    failure: q('[data-grid-empty="error"]'),
    skeleton: q("[data-grid-skeleton]"),
    rail: q("[data-grid-keywords]"),
    more: q("[data-grid-more]"),
    moreList: q("[data-grid-more-list]"),
    moreFilter: q("[data-grid-more-filter]"),
    invert: q("[data-grid-invert]"),
    toolbar: q("[data-grid-toolbar]"),
    noData: q('[data-grid-empty="no-data"]'),
    moreEmpty: q("[data-grid-more-empty]"),
  };
}
