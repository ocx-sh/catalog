// @vitest-environment happy-dom
//
// The detail page's eager script (D-052, D-055, D-056, D-058, D-060, D-061, D-071, D-073, D-074, D-171). The test builds the markup
// `pages/package.astro` and its components render (the contract is the header of `client/detail.ts`)
// and drives the island the way a visitor does: hover, focus, pick, click to copy. Nothing is fetched.
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { mount, type DetailOptions } from "../../../src/site/client/detail.js";
import type { FetchLike } from "../../../src/site/lib/wireTypes.js";
import { DEFAULT_INSTALL_FLAVORS } from "../../../src/site/lib/installFlavors.js";
import type { PinStorage } from "../../../src/site/lib/installPin.js";

interface ReleaseSpec {
  readonly platformSet: number;
  readonly license?: string;
  readonly source?: string;
  readonly revision?: string;
}

interface DomOptions {
  readonly initial?: string;
  readonly releases?: readonly ReleaseSpec[];
  readonly tags?: readonly (readonly [string, number])[];
  /** Install card: variant -> [tag, rank, level][]. The first variant is the one open. */
  readonly variants?: Readonly<Record<string, readonly (readonly [string, number, string])[]>>;
  readonly selected?: string;
  readonly card?: boolean;
  readonly rows?: boolean;
  /** The bounded tree: a breakdown with something to fetch and the templates the late tags are drawn from. */
  readonly lazy?: boolean;
  readonly base?: string;
}

const COMMANDS = [
  ["Add to project", "ocx add {name}"],
  ["Install package", "ocx package install {name}"],
] as const;

function html(strings: TemplateStringsArray, ...values: string[]): string {
  return String.raw({ raw: strings }, ...values);
}

/** The markup of the detail page, minus the theme's styling. */
function detailDom(options: DomOptions = {}): HTMLElement {
  const { releases = [], tags = [], variants = {}, card = true, rows = true } = options;
  const names = Object.keys(variants);
  const open = names[0] === undefined ? [] : variants[names[0]]!;
  const selected = options.selected ?? open[0]?.[0] ?? "";
  const root = document.createElement("article");
  root.setAttribute("data-detail", "");
  root.setAttribute("data-package", "idx/acme/tool");
  root.innerHTML = html`
    <button type="button" data-name-copy><code>idx/acme/tool</code></button>
    <section data-versions data-base="${options.base ?? "/"}" data-ns="acme" data-pkg="tool" data-wire-base="" data-status="active"><div data-versions-list>
      ${tags.map(([tag, release]) => `<button type="button" data-tag="${tag}" data-release="${release}"><b>${tag}</b></button>`).join("")}
      <button type="button" data-tag="unreleased"></button>
      <div data-variant=""><details id="plain"><summary></summary><div data-major-groups></div></details></div>
      ${
        options.lazy
          ? `<div data-variant="slim"><details id="cut" data-breakdown data-lazy><summary></summary><div data-major-groups></div></details></div>`
          : ""
      }
    </div>
    <p data-versions-status></p>
    ${
      options.lazy
        ? `<template data-tpl="chip"><button type="button" class="tag child" data-tag=""></button></template>
           <template data-tpl="major"><div data-major><div data-head><button type="button" class="tag rolling" data-tag=""></button></div>
             <div data-minor><div data-head><button type="button" class="tag minor" data-tag=""></button></div>
               <details data-patches><summary><span data-count></span></summary>
                 <div data-patch-list><button type="button" class="tag child" data-tag=""></button></div>
                 <ul data-reasons><li data-yanked-reason></li></ul></details></div></div></template>`
        : ""
    }
    </section>
    <section data-platforms>
      <div data-platform-set="0" data-platform-key="linux/amd64" hidden>set zero</div>
      <div data-platform-set="1" data-platform-key="darwin/arm64,linux/arm64" hidden>set one</div>
      <p data-platform-text hidden></p>
      <p data-platform-empty hidden>none</p>
    </section>
    <dl>
      <button type="button" data-registry-copy data-registry="ghcr.io/acme/tool">oci://ghcr.io/acme/tool</button>
      ${
        rows
          ? `<div data-row="source" hidden><dd data-field="source"><a href="https://old.example/"><span data-source-text>old</span></a></dd></div>
             <div data-row="license" hidden><dd data-field="license"></dd></div>
             <div data-row="revision" hidden><dd data-field="revision"><code></code></dd></div>`
          : ""
      }
    </dl>
    <ul hidden data-releases data-initial="${options.initial ?? ""}">
      ${releases
        .map(
          (r, i) =>
            `<li data-release="${i}" data-platform-set="${r.platformSet}" data-license="${r.license ?? ""}" data-source-url="${r.source ?? ""}" data-revision="${r.revision ?? ""}"></li>`,
        )
        .join("")}
    </ul>
    ${
      card
        ? `<section data-install data-name="idx/acme/tool" ${selected === "" ? "" : `data-initial-tag="${selected}"`}>
            ${
              names.length === 0
                ? ""
                : `${names.length > 1 ? `<select data-install-variant>${names.map((n) => `<option value="${n}">${n}</option>`).join("")}</select>` : ""}
                   <select <div data-install-pin></div>
                   ${names
                     .map(
                       (n) =>
                         `<template data-install-options data-variant="${n}">${variants[n]!.map(([tag, rank, level]) => `<option value="${tag}" data-rank="${rank}" data-level="${level}">${tag}</option>`).join("")}</template>`,
                     )
                     .join("")}`
            }
            <ul>${COMMANDS.map(
              ([label, template]) =>
                `<li data-install-row data-template="${template}"><button type="button" data-install-copy data-label="${label}"><span aria-hidden="true">$</span><span data-command>${template.replace("{name}", `idx/acme/tool${selected === "" || selected === "latest" ? "" : `:${selected}`}`)}</span></button></li>`,
            ).join("")}</ul>
          </section>`
        : ""
    }`;
  document.body.replaceChildren(root);
  return root;
}

const memory = (initial?: string): PinStorage & { value: string | undefined } => {
  const store = {
    value: initial,
    getItem: (key: string) => (key === "ocx-install-pin" ? (store.value ?? null) : null),
    setItem: (_key: string, value: string) => void (store.value = value),
  };
  return store;
};

const RELEASES: ReleaseSpec[] = [
  { platformSet: 0, license: "MIT", source: "https://github.com/acme/tool", revision: "9e8a183" },
  { platformSet: 1 },
];
const TAGS = [
  ["latest", 0],
  ["3.1.0", 0],
  ["2.0.0", 1],
] as const;
const CHAIN = [
  ["latest", 0, "latest"],
  ["3", 1, "major"],
  ["3.1", 2, "minor"],
  ["3.1.0", 3, "pinned"],
] as const;

let handle: { destroy(): void } | undefined;
function start(root: HTMLElement, options: DetailOptions = {}) {
  handle = mount(root, { storage: memory(), fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }), ...options });
  return handle;
}

const q = <T extends Element = HTMLElement>(root: ParentNode, selector: string) => root.querySelector<T>(selector)!;
const visibleSets = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>("[data-platform-set]")].filter((el) => !el.hidden && el.closest("[data-platforms]")).map((el) => el.dataset.platformSet);
const tick = (ms = 5) => new Promise<void>((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  document.body.replaceChildren();
});

afterEach(() => {
  handle?.destroy();
  handle = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** What the theme's `CommandBar`s are told: the `ocx:command-bar:set` details the picker and each command row hear. */
interface BarSet {
  readonly command?: string;
  readonly label?: string;
  readonly value?: string;
  readonly choices?: readonly { value: string; label: string; command: string }[];
}
/** Listens on the install card; attach before `start`, since the card retargets at mount. */
function watchCard(root: HTMLElement) {
  const picker: BarSet[] = [];
  const bar = root.querySelector("[data-install-pin]");
  bar?.addEventListener("ocx:command-bar:set", (event) => picker.push((event as CustomEvent<BarSet>).detail));
  const rows = [...root.querySelectorAll("[data-install-row]")];
  const heard = rows.map(() => "");
  rows.forEach((row, i) => row.addEventListener("ocx:command-bar:set", (event) => void (heard[i] = String((event as CustomEvent<BarSet>).detail.command))));
  return { picker, commands: () => heard, value: () => picker.at(-1)?.value };
}
/** A person's pick in the picker: the theme Select announces it as `ocx:select:change`. */
const pickPin = (root: HTMLElement, value: string) =>
  q(root, "[data-install-pin]").dispatchEvent(new CustomEvent("ocx:select:change", { detail: { value } }));

describe("the Platforms card and the metadata follow the install card's picked tag (D-060, D-061, D-071)", () => {
  const card = (options: DomOptions = {}) => detailDom({ releases: RELEASES, tags: TAGS, variants: { default: CHAIN }, ...options });

  test("D-061: opens on the release of the tag the card starts on, which the server rendered hidden", () => {
    const root = card();
    start(root);

    expect(visibleSets(root)).toEqual(["0"]);
  });

  test("D-060: picking a tag swaps the platforms, licence, revision and source to that tag's release", () => {
    const root = card({ tags: [["latest", 0], ["3", 1], ["3.1.0", 0]] });
    start(root);
    expect(q(root, '[data-row="license"] [data-field]').textContent).toBe("MIT");
    expect(q(root, '[data-row="revision"] code').textContent).toBe("9e8a183");
    expect(q(root, '[data-row="source"] a').getAttribute("href")).toBe("https://github.com/acme/tool");
    expect(q(root, "[data-source-text]").textContent).toBe("https://github.com/acme/tool");

    pickPin(root, "3");

    expect(visibleSets(root)).toEqual(["1"]);
    for (const row of ["license", "revision", "source"]) expect(q(root, `[data-row="${row}"]`).hidden).toBe(true);

    pickPin(root, "3.1.0");
    expect(visibleSets(root)).toEqual(["0"]);
    expect(q(root, '[data-row="license"] [data-field]').textContent).toBe("MIT");
  });

  test("D-071: clicking a version chip pins its tag in the card and shows its release; a chip the card has no option for changes nothing", () => {
    const root = card({ tags: [["latest", 0], ["3", 1], ["2.0.0", 1]] });
    const watched = watchCard(root);
    start(root);
    const heardBefore = watched.picker.length;

    q(root, '[data-tag="3"]').click();
    expect(watched.value()).toBe("3");
    expect(visibleSets(root)).toEqual(["1"]);

    q(root, '[data-tag="2.0.0"]').click();
    expect(watched.picker).toHaveLength(heardBefore + 1);
    expect(visibleSets(root)).toEqual(["1"]);
  });

  test("D-071: hovering or focusing a tag chip previews nothing; the page shows the picked tag only", async () => {
    const root = card();
    start(root);

    q(root, '[data-tag="2.0.0"]').dispatchEvent(new Event("pointerover", { bubbles: true }));
    q(root, '[data-tag="2.0.0"]').dispatchEvent(new Event("focusin", { bubbles: true }));
    await tick();

    expect(visibleSets(root)).toEqual(["0"]);
  });

  test("a tag that appears twice shows its first release", () => {
    const root = card({ tags: [["latest", 1], ["latest", 0]] });
    start(root);
    expect(visibleSets(root)).toEqual(["1"]);
  });

  test("a tag whose release the page does not know shows the empty note", () => {
    const root = card({ releases: [], tags: [["latest", 5]] });
    start(root);

    expect(visibleSets(root)).toEqual([]);
    expect(q(root, "[data-platform-empty]").hidden).toBe(false);
    expect(q(root, '[data-row="license"]').hidden).toBe(true);
  });

  test("a tag the page left out of its tree has no release: the empty note shows", () => {
    const root = card({ tags: [["3", 1]] });
    start(root);
    expect(visibleSets(root)).toEqual([]);
    expect(q(root, "[data-platform-empty]").hidden).toBe(false);
  });

  test("a release whose attributes are absent, not just empty, carries no facts", () => {
    const root = card({ releases: [{ platformSet: 0 }], tags: [["latest", 0]] });
    root.querySelector("[data-release]")!.removeAttribute("data-license");
    start(root);

    expect(visibleSets(root)).toEqual(["0"]);
    expect(q(root, '[data-row="license"]').hidden).toBe(true);
  });

  test("a license row with no [data-field] or code takes no text and a missing row is skipped", () => {
    const root = card();
    q(root, '[data-row="license"]').replaceChildren();
    q(root, '[data-row="source"]').replaceChildren();
    q(root, '[data-row="revision"]').remove();
    start(root);

    expect(q(root, '[data-row="license"]').hidden).toBe(false);
    expect(q(root, '[data-row="source"]').hidden).toBe(false);
  });

  test("a page without the metadata rows still shows the platforms", () => {
    const root = card({ rows: false });
    start(root);
    expect(visibleSets(root)).toEqual(["0"]);
  });

  test("a page without platform markup or release table does nothing and does not throw", () => {
    const root = document.createElement("article");
    root.innerHTML = `<span data-tag="latest" data-release="0"></span>
      <section data-install data-name="x"><div data-install-pin></div>
        <template data-install-options data-variant="v"><option value="latest" data-rank="0" data-level="latest"></option></template></section>`;
    expect(() => start(root)).not.toThrow();
    expect(root.querySelector("[data-platform-empty]")).toBeNull();
  });

  test("an empty page mounts and destroys cleanly", () => {
    const root = document.createElement("article");
    expect(() => start(root).destroy()).not.toThrow();
  });

  test("never fetches", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const root = card();
    start(root);
    pickPin(root, "3");
    q(root, '[data-tag="2.0.0"]').click();
    await tick();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("the version tree's patch panels and the support matrix's platform chips", () => {
  const patchPanels = (root: HTMLElement) => {
    root.querySelector("[data-versions-list]")!.insertAdjacentHTML(
      "beforeend",
      `<details class="patches" id="p1" open><summary></summary><span id="in1">chips</span></details><details class="patches" id="p2" open></details>`,
    );
    return [q<HTMLDetailsElement>(root, "#p1"), q<HTMLDetailsElement>(root, "#p2")] as const;
  };

  test("a click outside a patch panel closes the open ones; a click inside one keeps it", () => {
    const root = detailDom({ releases: RELEASES, tags: TAGS });
    start(root);
    const [first, second] = patchPanels(root);

    q(root, "#in1").click();
    expect([first.open, second.open]).toEqual([true, false]);

    document.body.click();
    expect([first.open, second.open]).toEqual([false, false]);
  });

  test("Escape closes the open patch panels; another key does not", () => {
    const root = detailDom({ releases: RELEASES, tags: TAGS });
    start(root);
    const [first, second] = patchPanels(root);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect([first.open, second.open]).toEqual([true, true]);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect([first.open, second.open]).toEqual([false, false]);
  });

  test("D-149 the support matrix loads on the first click of its dialog trigger: nothing at start, one request however often it is clicked", async () => {
    const root = detailDom({ releases: RELEASES, tags: TAGS });
    root.insertAdjacentHTML(
      "beforeend",
      `<div class="support-dialog"><button type="button" data-part="trigger"><span>support matrix</span></button>
         <div data-support-matrix data-support-url="/data/catalog/support/idx/acme/tool.json">
           <button type="button" data-matrix-require="linux/amd64" aria-pressed="false">linux/amd64</button>
           <table data-matrix-table aria-busy="true"><thead><tr><th>Version</th><th data-matrix-col="linux/amd64">linux/amd64</th></tr></thead><tbody data-matrix-rows></tbody></table>
           <template data-matrix-flags><span data-flag="deprecated"></span></template>
           <div data-matrix-skeleton></div><p data-matrix-empty hidden></p><p data-matrix-error hidden></p>
         </div></div>
       <button type="button" data-part="trigger" id="other">another dialog</button>`,
    );
    const fetched: string[] = [];
    const rows = { rows: [{ tag: "3.1.0", platforms: ["linux/amd64"], ephemeral: false, yanked: null }], deprecated: null };
    start(root, { fetch: async (url) => (fetched.push(url), { ok: true, status: 200, json: async () => rows }) });
    expect(fetched).toEqual([]);

    q(root, "#other").click();
    q(root, ".support-dialog span").click();
    q(root, ".support-dialog [data-part='trigger']").click();
    await vi.waitFor(() => expect(q(root, "[data-matrix-rows] tr")).not.toBeNull());

    expect(fetched).toEqual(["/data/catalog/support/idx/acme/tool.json"]);
    expect(q(root, "[data-matrix-rows] tr td").textContent).toBe("3.1.0");
    expect(hostMap(q(root, "[data-matrix-rows] tr")).identifier).toBe("idx/acme/tool:3.1.0");
    q(root, "[data-matrix-require]").click();
    expect(q(root, "[data-matrix-require]").getAttribute("aria-pressed")).toBe("true");
  });

  test("D-149 a page whose dialog is absent has nothing to load on a trigger click", () => {
    const root = detailDom({ releases: RELEASES, tags: TAGS });
    root.insertAdjacentHTML("beforeend", `<button type="button" data-part="trigger" class="support-dialog">x</button>`);
    const fetch = vi.fn();
    start(root, { fetch });

    q(root, ".support-dialog").click();

    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("tags the page did not prerender (D-149, D-060, D-071, D-091, D-093)", () => {
  const HEX = "a".repeat(64);
  const DIGEST = `sha256:${HEX}`;
  const ROOT_URL = "/p/acme/tool/_root.json";
  const IMAGE_URL = `/p/acme/tool/o/sha256/${HEX}.json`;
  const LATE = { tags: { "9.9.0": { content: DIGEST }, "9.9.1": { content: DIGEST, yanked: { reason: "bad", at: "2026-01-02T00:00:00Z" } } } };
  const annotations = {
    "org.opencontainers.image.licenses": "Apache-2.0",
    "org.opencontainers.image.source": "https://github.com/acme/late",
    "org.opencontainers.image.revision": "1234567",
  };

  /** A fetch answering the root and one image index; every other URL is a 404. */
  function wire(manifests: unknown[], pending?: Promise<void>, notes: Record<string, string> = annotations, rootSource?: string) {
    const calls: string[] = [];
    const bodies: Record<string, unknown> = { [ROOT_URL]: { ...LATE, source: rootSource }, [IMAGE_URL]: { manifests, annotations: notes } };
    const fetch = vi.fn(async (url: string) => {
      calls.push(url);
      await pending;
      return url in bodies ? { ok: true, status: 200, json: async () => bodies[url] } : { ok: false, status: 404, json: async () => ({}) };
    }) as unknown as FetchLike & ReturnType<typeof vi.fn>;
    return { fetch, calls };
  }
  const status = (root: HTMLElement) => q(root, "[data-versions-status]").textContent;
  const waitFor = async (condition: () => boolean) => {
    for (let i = 0; i < 100 && !condition(); i++) await tick(10);
    expect(condition()).toBe(true);
  };

  /** Opens the cut breakdown the way a visitor does: the browser's `toggle` fires on a `details[data-lazy]` that is now open. */
  const openCut = (root: HTMLElement) => {
    const cut = q<HTMLDetailsElement>(root, "#cut");
    cut.open = true;
    cut.dispatchEvent(new Event("toggle"));
  };
  const lateChip = (root: HTMLElement) => root.querySelector('[data-variant=""] [data-tag="9.9.0"]');

  test("D-149: nothing is fetched until a breakdown with something to fetch is opened", async () => {
    const { fetch, calls } = wire([]);
    const root = detailDom({ initial: "0", releases: RELEASES, tags: TAGS, lazy: true, variants: { default: CHAIN } });
    start(root, { fetch });

    q(root, '[data-tag="2.0.0"]').click();
    q(root, "#plain").dispatchEvent(new Event("toggle"));
    q(root, "#cut").dispatchEvent(new Event("toggle"));
    q(root, "[data-versions-list]").click();
    await tick(30);

    expect(calls).toEqual([]);
  });

  test("D-149: opening a breakdown with something to fetch draws the late tags and makes them hosts of the copy menu", async () => {
    const { fetch, calls } = wire([]);
    const root = detailDom({ initial: "0", releases: RELEASES, tags: TAGS, lazy: true });
    start(root, { fetch });

    openCut(root);
    await waitFor(() => lateChip(root) !== null);

    expect(calls).toEqual([ROOT_URL]);
    expect(q(root, "#cut").open).toBe(true);
    const chip = lateChip(root) as HTMLElement;
    expect(JSON.parse(chip.dataset.copy!)).toBeTypeOf("object");
    expect(chip.getAttribute("data-copy")).toContain("9.9.0");
  });

  test("D-091: a failed load says why and the next opening tries again", async () => {
    const { fetch, calls } = wire([]);
    const failing = vi.fn(async (url: string) => (calls.length === 0 && calls.push(url) ? { ok: false, status: 500, json: async () => ({}) } : fetch(url)));
    const root = detailDom({ initial: "0", releases: RELEASES, tags: TAGS, lazy: true });
    start(root, { fetch: failing as unknown as FetchLike });

    openCut(root);
    await waitFor(() => status(root) === "Failed to load: HTTP 500");
    expect(lateChip(root)).toBeNull();

    openCut(root);
    await waitFor(() => lateChip(root) !== null);
    expect(status(root)).toBe("");
  });

  test("D-149: the tree is drawn without opening the other breakdowns", async () => {
    const { fetch, calls } = wire([]);
    const root = detailDom({ initial: "0", releases: RELEASES, tags: TAGS, lazy: true });
    start(root, { fetch });

    openCut(root);
    await waitFor(() => lateChip(root) !== null);

    expect(calls).toEqual([ROOT_URL]);
    expect(q<HTMLDetailsElement>(root, "#plain").open).toBe(false);
  });

  test("D-149: closing a breakdown fetches nothing", async () => {
    const { fetch, calls } = wire([]);
    const root = detailDom({ initial: "0", releases: RELEASES, tags: TAGS, lazy: true });
    start(root, { fetch });

    q(root, "#cut").dispatchEvent(new Event("toggle"));
    await tick(30);

    expect(calls).toEqual([]);
  });

  test("D-149: a catalog under /catalog/ fetches below its base", async () => {
    const calls: string[] = [];
    const fetch = (async (url: string) => (calls.push(url), { ok: false, status: 404, json: async () => ({}) })) as unknown as FetchLike;
    const root = detailDom({ initial: "0", releases: RELEASES, tags: TAGS, lazy: true, base: "/catalog/" });
    start(root, { fetch });

    openCut(root);
    await waitFor(() => status(root) !== "");

    expect(calls[0]).toBe("/catalog/p/acme/tool/_root.json");
  });
});

describe("the install card (D-058, D-059, D-171)", () => {
  const card = (options: DomOptions = {}) => detailDom({ releases: RELEASES, tags: TAGS, variants: { default: CHAIN }, ...options });

  test("D-171: restores the stored level once the page is up, and retargets the commands", () => {
    const root = card({ initial: "0" });
    const watched = watchCard(root);
    start(root, { storage: memory("major") });

    expect(watched.value()).toBe("3");
    expect(watched.commands()).toEqual(["ocx add idx/acme/tool:3", "ocx package install idx/acme/tool:3"]);
  });

  test("D-171: no stored pick opens on latest; the bare name is the target", () => {
    const root = card({ initial: "0", selected: "3.1.0" });
    const watched = watchCard(root);
    start(root);

    expect(watched.value()).toBe("latest");
    expect(watched.commands()).toEqual(["ocx add idx/acme/tool", "ocx package install idx/acme/tool"]);
  });

  test("D-171: a person's pick is stored by level; the fallback never stores", () => {
    const store = memory();
    const root = card({ initial: "0" });
    const watched = watchCard(root);
    start(root, { storage: store });
    expect(store.value).toBeUndefined();

    pickPin(root, "3.1");

    expect(store.value).toBe("minor");
    expect(watched.commands()[0]).toBe("ocx add idx/acme/tool:3.1");
  });

  test("D-171: the deepest option is stored as 'pinned'", () => {
    const store = memory();
    const root = card();
    start(root, { storage: store });
    pickPin(root, "3.1.0");
    expect(store.value).toBe("pinned");
  });

  test("D-171: a pick the card has no option for is not stored", () => {
    const store = memory();
    const root = card();
    start(root, { storage: store });
    pickPin(root, "9.9.9");
    expect(store.value).toBeUndefined();
  });

  test("D-171: a storage that throws, or none at all, never breaks the card", () => {
    const throwing: PinStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    for (const storage of [throwing, null]) {
      const root = card();
      const watched = watchCard(root);
      start(root, { storage });
      pickPin(root, "3");
      expect(watched.commands()[0]).toBe("ocx add idx/acme/tool:3");
      handle?.destroy();
    }
  });

  test("D-171: a stored value that is not a level is ignored", () => {
    const root = card();
    const watched = watchCard(root);
    start(root, { storage: memory("sideways") });
    expect(watched.value()).toBe("latest");
  });

  test("D-171: the real localStorage is the default, read at mount", () => {
    vi.stubGlobal("localStorage", memory("minor"));
    const root = card();
    const watched = watchCard(root);
    handle = mount(root);
    expect(watched.value()).toBe("3.1");
  });

  test("D-059: picking a version previews that tag's release", () => {
    const root = card({ initial: "0", tags: [["latest", 0], ["3", 1], ["3.1", 1], ["3.1.0", 0]] });
    start(root);

    pickPin(root, "3");
    expect(visibleSets(root)).toEqual(["1"]);
    pickPin(root, "3.1.0");
    expect(visibleSets(root)).toEqual(["0"]);
  });

  test("D-059: changing the variant swaps the picker's choices and reapplies the stored level", () => {
    const store = memory("minor");
    const slim = [["slim", 0, "rolling"], ["slim-3.1", 2, "minor"], ["slim-3.1.0", 3, "pinned"]] as const;
    const root = detailDom({ releases: RELEASES, tags: TAGS, variants: { default: CHAIN, slim } });
    const watched = watchCard(root);
    start(root, { storage: store });
    expect(watched.value()).toBe("3.1");

    pick(q<HTMLSelectElement>(root, "select[data-install-variant]"), "slim");

    expect(watched.picker.at(-1)?.choices).toEqual([
      { value: "slim", label: "rolling", command: "idx/acme/tool:slim" },
      { value: "slim-3.1", label: "minor", command: "idx/acme/tool:slim-3.1" },
      { value: "slim-3.1.0", label: "pinned", command: "idx/acme/tool:slim-3.1.0" },
    ]);
    expect(watched.value()).toBe("slim-3.1");
    expect(watched.commands()[0]).toBe("ocx add idx/acme/tool:slim-3.1");
    expect(store.value).toBe("minor");
  });

  test("D-059: a pick in the theme's variant Select reaches the native select and changes the variant", () => {
    const slim = [["slim", 0, "rolling"]] as const;
    const root = detailDom({ releases: RELEASES, tags: TAGS, variants: { default: CHAIN, slim } });
    const variant = q<HTMLSelectElement>(root, "select[data-install-variant]");
    variant.insertAdjacentHTML("beforebegin", `<div data-zag-root="select" id="variant-zag"></div>`);
    q(root, "#variant-zag").append(variant);
    const watched = watchCard(root);
    start(root);

    q(root, "#variant-zag").dispatchEvent(new CustomEvent("ocx:select:change", { detail: { value: "slim" }, bubbles: true }));

    expect(variant.value).toBe("slim");
    expect(watched.value()).toBe("slim");
  });

  test("D-059: a Select event aimed at a text node of the card changes no variant", () => {
    const root = card();
    const watched = watchCard(root);
    start(root);
    const before = watched.picker.length;
    const note = document.createTextNode("note");
    q(root, "[data-install]").append(note);

    note.dispatchEvent(new CustomEvent("ocx:select:change", { detail: { value: "x" }, bubbles: true }));

    expect(watched.picker).toHaveLength(before);
  });

  test("D-171: a pick with an empty value retargets nothing and stores nothing", () => {
    const store = memory();
    const root = card();
    const watched = watchCard(root);
    start(root, { storage: store });
    const commandsBefore = [...watched.commands()];

    pickPin(root, "");

    expect(watched.commands()).toEqual(commandsBefore);
    expect(store.value).toBeUndefined();
  });

  test("D-059: a variant with no template leaves the picker alone", () => {
    const root = detailDom({ releases: RELEASES, tags: TAGS, variants: { default: CHAIN, slim: [["slim", 0, "rolling"]] } });
    root.querySelector('template[data-variant="slim"]')!.remove();
    const watched = watchCard(root);
    start(root);
    const before = watched.picker.length;

    pick(q<HTMLSelectElement>(root, "select[data-install-variant]"), "slim");

    expect(watched.picker).toHaveLength(before);
  });

  test("an option without data-level still takes part, as a rolling one", () => {
    const root = card();
    const odd = document.createElement("option");
    odd.value = "odd";
    odd.dataset.rank = "4";
    q<HTMLTemplateElement>(root, "template[data-install-options]").content.append(odd);
    const watched = watchCard(root);
    start(root, { storage: memory("pinned") });
    expect(watched.value()).toBe("odd");
  });

  test("a picker with no options leaves the commands alone", () => {
    const root = card();
    q<HTMLTemplateElement>(root, "template[data-install-options]").content.replaceChildren();
    const watched = watchCard(root);
    start(root);
    expect(watched.picker).toEqual([]);
    expect(watched.commands()).toEqual(["", ""]);
  });

  test("a row without data-template renders an empty command", () => {
    const root = card();
    q(root, "[data-install-row]").removeAttribute("data-template");
    const watched = watchCard(root);
    start(root, { storage: memory("major") });
    expect(watched.commands()[0]).toBe("");
  });

  test("a card without a name still mounts", () => {
    const root = card();
    q(root, "[data-install]").removeAttribute("data-name");
    const watched = watchCard(root);
    start(root, { storage: memory("major") });
    expect(watched.commands()[0]).toBe("ocx add :3");
  });

  test("destroy removes every listener", () => {
    const store = memory();
    const root = card();
    const h = start(root, { storage: store });
    h.destroy();
    pickPin(root, "3");
    expect(store.value).toBeUndefined();
  });
});

describe.each(["/", "/catalog/"])("under base %s", (base) => {
  test("the island resolves nothing against the base: it reveals what the server rendered", () => {
    window.history.replaceState({}, "", `${base}acme/tool/`);
    const root = detailDom({ initial: "0", releases: RELEASES, tags: [["latest", 0], ["3", 1]], variants: { default: CHAIN } });
    start(root);
    pickPin(root, "3");
    expect(visibleSets(root)).toEqual(["1"]);
  });
});


/** Stubs the async clipboard; `null` takes it away (an insecure context). */
function clipboard(write: ((text: string) => Promise<void>) | null) {
  const writeText = write === null ? undefined : vi.fn(write);
  vi.stubGlobal("navigator", { clipboard: writeText && { writeText } });
  return writeText;
}

function toasts() {
  const seen: { title: string; tone?: string; slot?: string }[] = [];
  document.addEventListener("ocx:toast", (event) => seen.push((event as CustomEvent).detail));
  return seen;
}

/** Waits on real I/O ticks, which fake timers leave alone (`vi.waitFor` would advance them). */
async function until(condition: () => boolean): Promise<void> {
  for (let tick = 0; tick < 200 && !condition(); tick++) await new Promise((resolve) => setImmediate(resolve));
  expect(condition()).toBe(true);
}

const pick = (select: HTMLSelectElement, value: string) => {
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
};
/** The copy code is its own chunk, loaded by the first click: warm it so no test waits on the transform. */
beforeAll(() => import("@ocx-sh/theme/copy"));

/** Waits until `count` toasts have been seen, then one more tick for the island to mark the copy done. */
async function settled(seen: readonly unknown[], count: number): Promise<void> {
  await until(() => seen.length === count);
  await new Promise((resolve) => setImmediate(resolve));
}
const copied = (el: Element) => el.hasAttribute("data-copied");
const hostMap = (el: Element) => JSON.parse(el.getAttribute("data-copy")!) as Record<string, string>;
const installHosts = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>("[data-install-copy]")];

describe("clicking to copy (D-052, D-055, D-073, D-074)", () => {
  afterEach(() => vi.useRealTimers());

  test("D-055 a click on a tag copies name:tag, toasts it and marks the tag copied for 1.5 s", async () => {
    const write = clipboard(async () => {});
    const seen = toasts();
    const root = detailDom({ releases: RELEASES, tags: TAGS });
    start(root);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const tag = q(root, '[data-tag="3.1.0"]');
    q(tag, "b").click();
    await settled(seen, 1);

    expect(write).toHaveBeenCalledExactlyOnceWith("idx/acme/tool:3.1.0");
    expect(seen).toEqual([{ title: "Copied — :3.1.0 identifier", duration: 2000, slot: "copy" }]);
    vi.advanceTimersByTime(1499);
    expect(copied(tag)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(copied(tag)).toBe(false);
  });

  test("D-055 a second click inside the copied window copies nothing; after it, a click copies again", async () => {
    const write = clipboard(async () => {});
    const root = detailDom({ releases: RELEASES, tags: TAGS });
    const seen = toasts();
    start(root);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const tag = q(root, '[data-tag="2.0.0"]');

    tag.click();
    tag.click();
    await settled(seen, 1);
    expect(write).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1500);
    tag.click();
    await settled(seen, 2);
    expect(write).toHaveBeenCalledTimes(2);
  });

  test("D-055 a refused write toasts 'Copy failed' and leaves the tag unmarked, ready for another try", async () => {
    clipboard(async () => {
      throw new Error("denied");
    });
    const seen = toasts();
    const root = detailDom({ releases: RELEASES, tags: TAGS });
    start(root);
    const tag = q(root, '[data-tag="latest"]');

    tag.click();
    await settled(seen, 1);

    expect(seen).toEqual([{ title: "Copy failed", tone: "danger", slot: "copy" }]);
    expect(copied(tag)).toBe(false);
  });

  test("D-055 without an async clipboard a click still ends in 'Copy failed', never a throw", async () => {
    clipboard(null);
    const seen = toasts();
    const root = detailDom({ releases: RELEASES, tags: TAGS });
    start(root);

    q(root, '[data-tag="latest"]').click();

    await settled(seen, 1);
    expect(seen[0]?.title).toBe("Copy failed");
  });

  test("D-084 a clipboard whose writeText throws before returning a promise ends in 'Copy failed', the tag left unmarked", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: () => {
          throw new TypeError("clipboard is not available in this context");
        },
      },
    });
    const seen = toasts();
    const root = detailDom({ releases: RELEASES, tags: TAGS });
    start(root);
    const tag = q(root, '[data-tag="latest"]');

    tag.click();
    await settled(seen, 1);

    expect(seen).toEqual([{ title: "Copy failed", tone: "danger", slot: "copy" }]);
    expect(copied(tag)).toBe(false);
  });

  test("D-074 a click on the package name copies it and toasts 'Copied — package name'", async () => {
    const write = clipboard(async () => {});
    const seen = toasts();
    const root = detailDom({ releases: RELEASES, tags: TAGS });
    start(root);

    const badge = q(root, "[data-name-copy]");
    q(badge, "code").click();
    await settled(seen, 1);

    expect(write).toHaveBeenCalledExactlyOnceWith("idx/acme/tool");
    expect(seen).toEqual([{ title: "Copied — package name", duration: 2000, slot: "copy" }]);
  });

  test("D-073 an install command is the theme CommandBar's to copy: a click on it is not copied by the island", async () => {
    const write = clipboard(async () => {});
    const seen = toasts();
    const root = detailDom({ releases: RELEASES, tags: TAGS, variants: { default: CHAIN } });
    start(root);

    q(q(root, '[data-install-copy][data-label="Install package"]'), "[data-command]").click();
    await new Promise((resolve) => setImmediate(resolve));

    expect(write).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
  });

  test("D-073 a click on a support-matrix row copies name:tag of its version, and the row offers the same texts", async () => {
    const write = clipboard(async () => {});
    const seen = toasts();
    const root = detailDom({ releases: RELEASES, tags: TAGS });
    root.insertAdjacentHTML("beforeend", `<section data-support-matrix><table><tbody><tr data-ocx-row><td> 3.1.0 </td><td>linux/amd64</td></tr></tbody></table></section>`);
    start(root);

    const row = q(root, "[data-support-matrix] tr[data-ocx-row]");
    q(row, "td:last-child").click();
    await settled(seen, 1);

    expect(write).toHaveBeenCalledExactlyOnceWith("idx/acme/tool:3.1.0");
    expect(seen[0]?.title).toBe("Copied — :3.1.0 identifier");
  });

  test("D-052 a click on the registry row copies the address without the oci:// scheme", async () => {
    const write = clipboard(async () => {});
    const seen = toasts();
    const root = detailDom({ releases: RELEASES, tags: TAGS });
    start(root);

    const registry = q(root, "[data-registry-copy]");
    registry.click();
    await settled(seen, 1);

    expect(write).toHaveBeenCalledExactlyOnceWith("ghcr.io/acme/tool");
    expect(seen).toEqual([{ title: "Copied — registry address", duration: 2000, slot: "copy" }]);
  });

  test("a click elsewhere, or on a text node, copies nothing; the same page's copy element still does", async () => {
    const write = clipboard(async () => {});
    const seen = toasts();
    const root = detailDom({ releases: RELEASES, tags: TAGS });
    start(root);

    document.body.click();
    q(root, "[data-platforms]").click();
    q(root, "[data-registry-copy]").firstChild!.dispatchEvent(new Event("click", { bubbles: true }));
    await new Promise((resolve) => setImmediate(resolve));
    expect(write).not.toHaveBeenCalled();
    expect(seen).toEqual([]);

    q(root, "[data-registry-copy]").click();
    await settled(seen, 1);
    expect(write).toHaveBeenCalledExactlyOnceWith("ghcr.io/acme/tool");
  });

  test("destroy drops the click handling and the pending copied timers", async () => {
    clipboard(async () => {});
    const root = detailDom({ releases: RELEASES, tags: TAGS });
    const seen = toasts();
    const h = start(root);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const tag = q(root, '[data-tag="latest"]');
    tag.click();
    await settled(seen, 1);

    h.destroy();
    vi.advanceTimersByTime(5000);
    expect(copied(tag)).toBe(true);
    const other = q(root, '[data-tag="2.0.0"]');
    other.click();
    await new Promise((resolve) => setImmediate(resolve));
    expect(copied(other)).toBe(false);
  });
});

describe("the texts the copy menus offer (D-056, D-073)", () => {
  /** What the theme's CopyMenu reads off a host: `{ <item value>: text }`, values being the items of `cardCopyItems`. */
  const flavorKeys = DEFAULT_INSTALL_FLAVORS.map((flavor) => flavor.icon);

  test("D-056 every tag carries its own identifier, tag, link and install commands on the tag itself", () => {
    window.history.replaceState({}, "", "/acme/tool/");
    const root = detailDom({ releases: RELEASES, tags: TAGS });
    start(root);

    const map = hostMap(q(root, '[data-tag="3.1.0"]'));
    expect(Object.keys(map)).toEqual(["identifier", "tag", "link", ...flavorKeys]);
    expect(map.identifier).toBe("idx/acme/tool:3.1.0");
    expect(map.tag).toBe("3.1.0");
    expect(map.link).toBe(`${window.location.origin}/acme/tool/`);
    expect(map.project).toBe("ocx add idx/acme/tool:3.1.0");
    expect(hostMap(q(root, '[data-tag="2.0.0"]')).identifier).toBe("idx/acme/tool:2.0.0");
  });

  test("D-056 the tags are plain hosts: the script gives them no tabindex, wrapper or role of their own", () => {
    const root = detailDom({ releases: RELEASES, tags: TAGS });
    start(root);

    const tag = q(root, '[data-tag="latest"]');
    expect(tag.hasAttribute("tabindex")).toBe(false);
    expect(tag.hasAttribute("role")).toBe(false);
  });

  test("D-073 the package name offers the bare identifier, the link and the install commands, and no tag", () => {
    const root = detailDom({ releases: RELEASES, tags: TAGS });
    start(root);

    const map = hostMap(q(root, "[data-name-copy]"));
    expect(Object.keys(map)).toEqual(["identifier", "link", ...flavorKeys]);
    expect(map.identifier).toBe("idx/acme/tool");
    expect(map.exec).toBe("ocx package exec idx/acme/tool");
  });

  test("D-073 each install command offers the texts of the tag the card shows, and follows a pick", () => {
    const root = detailDom({ releases: RELEASES, tags: TAGS, variants: { default: CHAIN } });
    start(root);
    expect(installHosts(root).map((host) => hostMap(host).identifier)).toEqual(["idx/acme/tool:latest", "idx/acme/tool:latest"]);

    pickPin(root, "3.1");

    expect(installHosts(root).map((host) => hostMap(host).identifier)).toEqual(["idx/acme/tool:3.1", "idx/acme/tool:3.1"]);
    expect(hostMap(installHosts(root)[0]!).global).toBe("ocx --global add idx/acme/tool:3.1");
  });

  test("D-073 a card without selectors offers the tag it opened on", () => {
    const root = detailDom({ releases: RELEASES, tags: TAGS, selected: "3.1.0" });
    start(root);
    expect(installHosts(root).map((host) => hostMap(host).tag)).toEqual(["3.1.0", "3.1.0"]);
  });

  test("D-073 a card that opens on no tag offers the bare package", () => {
    const root = detailDom({ releases: RELEASES, tags: TAGS });
    start(root);
    expect(installHosts(root).map((host) => hostMap(host).identifier)).toEqual(["idx/acme/tool", "idx/acme/tool"]);
    expect(hostMap(installHosts(root)[0]!)).not.toHaveProperty("tag");
  });
});
