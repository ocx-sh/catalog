// @vitest-environment happy-dom
//
// The lazy half of the versions card (D-149, D-091, D-093, D-053, D-054, D-057, D-060, D-071, D-076): the page
// carries a bounded tree and `client/versions.ts` fetches the package root on first need and draws the rest
// from the `<template>`s. The test builds the markup `VersionList.astro` and `MajorGroup.astro` render (the
// contract is the header of `client/versions.ts`) and fetches against a stub.
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createVersions } from "../../../src/site/client/versions.js";
import { SSR_OTHER, SSR_TRACKS } from "../../../src/site/lib/versionTable.js";
import type { FetchLike } from "../../../src/site/lib/wireTypes.js";

const HEX = "a".repeat(64);
const DIGEST = `sha256:${HEX}`;
const OTHER = `sha256:${"b".repeat(64)}`;

interface DomOptions {
  readonly base?: string;
  readonly wireBase?: string;
  readonly status?: string;
  readonly noOther?: boolean;
  readonly noOtherList?: boolean;
  readonly noGroups?: boolean;
  readonly tracks?: boolean;
}

function dom(options: DomOptions = {}): HTMLElement {
  const { base = "/", wireBase = "", status = "active", noOther = false, noOtherList = false, noGroups = false, tracks = false } = options;
  const root = document.createElement("section");
  for (const [key, value] of Object.entries({ base, ns: "acme", pkg: "tool", wireBase, status })) root.dataset[key] = value;
  root.setAttribute("data-versions", "");
  root.innerHTML = `
    <div data-versions-list>
      <div data-variant="">
        <details data-breakdown data-lazy><summary></summary>
          ${noGroups ? "" : `<div data-major-groups><div data-major id="prerendered"></div></div>`}
        </details>
      </div>
      <div data-variant="slim">
        <details data-breakdown data-lazy><summary></summary><div data-major-groups><div data-major id="prerendered-slim"></div></div></details>
      </div>
      ${
        noOther
          ? ""
          : `<div data-variant-other><details data-lazy>${noOtherList ? "" : `<div data-other-list><button data-tag="stale"></button></div>`}</details></div>`
      }
    </div>
    ${
      tracks
        ? `<div data-tracks><div data-track-list><div data-minor id="prerendered-track"></div></div><details data-lazy><div data-track-more></div></details></div>`
        : ""
    }
    <p data-versions-status></p>
    <template data-tpl="chip"><button type="button" class="tag child" data-tag="" data-release="9" title=""></button></template>
    <template data-tpl="track">
      <div class="minor-group" data-minor>
        <span class="kicker" data-kicker></span>
        <div class="chips" data-head><button type="button" class="tag minor" data-tag=""></button></div>
        <details class="patches" data-patches data-lazy>
          <summary class="expand-toggle minor-toggle"><svg class="warn-icon"></svg><span data-count>·1</span></summary>
          <div class="chips" data-patch-list><button type="button" class="tag child" data-tag=""></button></div>
          <ul data-reasons><li data-yanked-reason><svg></svg>x yanked — r · d</li></ul>
        </details>
      </div>
    </template>
    <template data-tpl="major">
      <div class="major-group" data-major>
        <div class="chips" data-head><button type="button" class="tag rolling" data-tag=""></button></div>
        <div class="minor-group" data-minor>
          <div class="chips" data-head><button type="button" class="tag minor" data-tag=""></button></div>
          <details class="patches" data-patches data-lazy>
            <summary class="expand-toggle minor-toggle"><svg class="warn-icon"></svg><span data-count>·1</span></summary>
            <div class="chips" data-patch-list><button type="button" class="tag child yanked" data-tag="" data-yanked=""></button></div>
            <ul data-reasons><li data-yanked-reason><svg></svg>x yanked — r · d</li></ul>
          </details>
        </div>
      </div>
    </template>`;
  document.body.replaceChildren(root);
  return root;
}

const YANK = { reason: "bad build", at: "2026-02-03T04:05:06Z" };

function wireRoot(tags: Record<string, { content: string; yanked?: typeof YANK | null; ephemeral?: unknown; observed?: string }>) {
  return { name: "acme/tool", repository: "ghcr.io/acme/tool", owners: [], status: "active", tags };
}

const TAGS = {
  latest: { content: DIGEST },
  "1": { content: DIGEST },
  "1.0": { content: DIGEST },
  "1.0.0": { content: DIGEST },
  "1.0.1": { content: DIGEST, yanked: YANK },
  "1.1": { content: OTHER },
  "1.1.0": { content: OTHER },
  "slim-1.0": { content: OTHER },
  "slim-1.0.0": { content: OTHER },
  edge: { content: DIGEST },
};

type Reply = { status: number; body?: unknown } | Error | string;

/** A fetch stub answering by URL; an unlisted URL is a 404. */
function stub(replies: Record<string, Reply | Reply[]>) {
  const calls: string[] = [];
  const fetchFn = vi.fn(async (url: string) => {
    calls.push(url);
    const entry = replies[url];
    const reply = Array.isArray(entry) ? (entry.length > 1 ? entry.shift() : entry[0]) : entry;
    if (reply === undefined) return { ok: false, status: 404, json: async () => ({}) };
    if (typeof reply === "string" || reply instanceof Error) throw reply;
    return { ok: reply.status < 400, status: reply.status, json: async () => reply.body };
  }) as unknown as FetchLike & ReturnType<typeof vi.fn>;
  return { fetchFn, calls };
}

const ROOT_URL = "/p/acme/tool/_root.json";
const OK = { status: 200, body: wireRoot(TAGS) };
const text = (el: Element | null) => el?.textContent ?? "";
const tagsIn = (el: ParentNode) => [...el.querySelectorAll("[data-tag]")].map((chip) => (chip as HTMLElement).dataset.tag);

beforeEach(() => {
  document.body.replaceChildren();
});

describe("showAll — tracks of pre-releases and builds", () => {
  test("redraws the prerendered tracks and fills the overflow list, every chip marked pre-release", async () => {
    const root = dom({ tracks: true });
    const many = Object.fromEntries(Array.from({ length: SSR_TRACKS + 1 }, (_, i) => [`mr${i}_2026102${i}`, { content: DIGEST, observed: `2026-10-0${i + 1}T00:00:00Z`, ephemeral: true }]));
    many["mr0_20261029"] = { content: DIGEST, observed: "2026-10-09T00:00:00Z", ephemeral: true };
    const { fetchFn } = stub({ [ROOT_URL]: { status: 200, body: wireRoot(many) } });

    expect(await createVersions(root, { fetch: fetchFn }).showAll(false)).toBe(true);

    const list = root.querySelector("[data-track-list]")!;
    const more = root.querySelector("[data-track-more]")!;
    expect(list.querySelectorAll("[data-minor]")).toHaveLength(SSR_TRACKS);
    expect(more.querySelectorAll("[data-minor]")).toHaveLength(1);
    expect(root.querySelector("#prerendered-track")).toBeNull();
    const first = list.querySelector("[data-minor]")!;
    expect(text(first.querySelector("[data-kicker]"))).toBe("mr0");
    const head = first.querySelector<HTMLElement>("[data-head] [data-tag]")!;
    expect(head.dataset.tag).toBe("mr0_20261029");
    expect(head.className).toBe("tag minor ephemeral prerelease");
    expect(head.hasAttribute("data-prerelease")).toBe(true);
    expect(head.title).toContain("Pre-release: not a stable version");
    expect(tagsIn(first.querySelector("[data-patch-list]")!)).toEqual(["mr0_20261020"]);
    expect(first.querySelector("[data-patch-list] [data-tag]")!.className).toBe("tag child ephemeral prerelease");
  });
});

describe("showAll — the whole tree from the package root on first interaction (D-149, D-053, D-057, D-076)", () => {
  test("D-149: nothing is fetched until the first call", () => {
    const { fetchFn } = stub({ [ROOT_URL]: OK });
    createVersions(dom(), { fetch: fetchFn });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test("D-053: draws the major, minor and patch tree of every variant row from the root", async () => {
    const root = dom();
    const { fetchFn, calls } = stub({ [ROOT_URL]: OK });

    expect(await createVersions(root, { fetch: fetchFn }).showAll(false)).toBe(true);

    expect(calls).toEqual([ROOT_URL]);
    const [plain, slim] = root.querySelectorAll<HTMLElement>("[data-variant]");
    expect(root.querySelector("#prerendered")).toBeNull();
    expect(root.querySelector("#prerendered-slim")).toBeNull();
    expect(tagsIn(plain!.querySelector("[data-major-groups]")!)).toEqual(["1", "1.1", "1.1.0", "1.0", "1.0.1", "1.0.0"]);
    expect(tagsIn(slim!.querySelector("[data-major-groups]")!)).toEqual(["slim-1.0.0", "slim-1.0", "slim-1.0.0"]);
  });

  test("D-053: a late chip has the prerendered tag's markup: kind class, title, no stale release index", async () => {
    const root = dom();
    await createVersions(root, { fetch: stub({ [ROOT_URL]: OK }).fetchFn }).showAll(false);

    const chip = root.querySelector<HTMLElement>('[data-tag="1.0.0"]')!;
    expect(chip.className).toBe("tag child");
    expect(chip.textContent).toBe("1.0.0");
    expect(chip.title).toBe("Click to copy identifier · right-click for more");
    expect(root.querySelector<HTMLElement>('[data-tag="1.1"]')!.className).toBe("tag minor");
    expect(root.querySelector<HTMLElement>('[data-tag="1"]')!.className).toBe("tag rolling");
  });

  test("D-076: the count of a minor line reads its patches, and the line without a yank has no warning", async () => {
    const root = dom();
    await createVersions(root, { fetch: stub({ [ROOT_URL]: OK }).fetchFn }).showAll(false);

    const lines = Object.fromEntries([...root.querySelectorAll<HTMLElement>("[data-minor]")].map((minor) => [minor.querySelector("[data-head] [data-tag]")!.getAttribute("data-tag"), minor]));
    expect(text(lines["1.0"]!.querySelector("[data-count]"))).toBe("+2");
    expect(text(lines["1.1"]!.querySelector("[data-count]"))).toBe("+1");
    expect(lines["1.0"]!.querySelector("summary")!.classList.contains("warn")).toBe(true);
    expect(lines["1.0"]!.querySelector("summary")!.title).toBe("Contains a yanked version");
    expect(lines["1.0"]!.querySelector(".warn-icon")).not.toBeNull();
    expect(lines["1.1"]!.querySelector("summary")!.classList.contains("warn")).toBe(false);
    expect(lines["1.1"]!.querySelector("summary")!.hasAttribute("title")).toBe(false);
    expect(lines["1.1"]!.querySelector(".warn-icon")).toBeNull();
  });

  test("D-054: a withdrawn patch stays in place, struck through, with its reason and date", async () => {
    const root = dom();
    await createVersions(root, { fetch: stub({ [ROOT_URL]: OK }).fetchFn }).showAll(false);

    const chip = root.querySelector<HTMLElement>('[data-tag="1.0.1"]')!;
    expect(chip.className).toBe("tag child yanked");
    expect(chip.hasAttribute("data-yanked")).toBe(true);
    expect(chip.title).toBe("Yanked — bad build · 2026-02-03 — click to copy identifier · right-click for more");
    const reasons = [...root.querySelectorAll("[data-yanked-reason]")];
    expect(reasons.map(text)).toEqual(["1.0.1 yanked — bad build · 2026-02-03"]);
    expect(root.querySelectorAll("[data-reasons]")).toHaveLength(1);
  });

  test("a late chip of an ephemeral tag is marked and says why; only a JSON true counts", async () => {
    const root = dom();
    const tags = {
      ...TAGS,
      "1.1.1": { content: OTHER, ephemeral: true },
      "1.1.2": { content: OTHER, ephemeral: "true" },
      "1.1.3": { content: OTHER, ephemeral: 1 },
    };
    await createVersions(root, { fetch: stub({ [ROOT_URL]: { status: 200, body: wireRoot(tags) } }).fetchFn }).showAll(false);

    const chip = root.querySelector<HTMLElement>('[data-tag="1.1.1"]')!;
    expect(chip.className).toBe("tag child ephemeral");
    expect(chip.hasAttribute("data-ephemeral")).toBe(true);
    expect(chip.title).toBe("Ephemeral: may be pruned from the registry — click to copy identifier · right-click for more");
    for (const durable of ["1.1.2", "1.1.3"]) expect(root.querySelector<HTMLElement>(`[data-tag="${durable}"]`)!.hasAttribute("data-ephemeral")).toBe(false);
  });

  test("D-076: a patch list the visitor had open stays open when the tree is redrawn; the others stay closed", async () => {
    const root = dom();
    root.querySelector("#prerendered")!.innerHTML = `
      <div data-minor><div data-head><button data-tag="1.0"></button></div><details data-patches data-lazy open></details></div>
      <div data-minor><div data-head><button data-tag="1.1"></button></div><details data-patches data-lazy></details></div>`;

    await createVersions(root, { fetch: stub({ [ROOT_URL]: OK }).fetchFn }).showAll(false);

    const open = (tag: string) =>
      [...root.querySelectorAll("[data-minor]")].find((minor) => minor.querySelector<HTMLElement>("[data-head] [data-tag]")?.dataset.tag === tag)!.querySelector<HTMLDetailsElement>("details[data-patches]")!.open;
    expect(open("1.0")).toBe(true);
    expect(open("1.1")).toBe(false);
  });

  test("D-057: a minor line without patch tags has no patches disclosure", async () => {
    const root = dom();
    const bare = wireRoot({ "2.0": { content: DIGEST } });
    await createVersions(root, { fetch: stub({ [ROOT_URL]: { status: 200, body: bare } }).fetchFn }).showAll(false);

    // The major has no tag of its own: its chip reads `2` and targets the newest tag under it.
    const [major] = root.querySelectorAll<HTMLElement>("[data-major] [data-head] [data-tag]");
    expect(major!.textContent).toBe("2");
    expect(tagsIn(root.querySelector("[data-variant='']")!)).toEqual(["2.0", "2.0"]);
    expect(root.querySelector("[data-patches]")).toBeNull();
  });

  test("D-149: the other row gets the tags past the prerendered ones", async () => {
    const root = dom();
    const names = Array.from({ length: SSR_OTHER + 2 }, (_, i) => `edge${String.fromCharCode(97 + i)}`);
    const body = wireRoot(Object.fromEntries(names.map((name) => [name, { content: DIGEST }])));
    await createVersions(root, { fetch: stub({ [ROOT_URL]: { status: 200, body } }).fetchFn }).showAll(false);

    expect(tagsIn(root.querySelector("[data-other-list]")!)).toEqual(names.slice(SSR_OTHER));
  });

  test("D-149: the drawn tree clears the lazy marks, empties the status and announces itself", async () => {
    const root = dom();
    const rendered = vi.fn();
    root.addEventListener("ocx:versions:rendered", rendered);
    const versions = createVersions(root, { fetch: stub({ [ROOT_URL]: OK }).fetchFn });

    await versions.showAll(false);

    expect(root.querySelectorAll("[data-lazy]")).toHaveLength(0);
    expect(text(root.querySelector("[data-versions-status]"))).toBe("");
    expect(rendered).toHaveBeenCalledTimes(1);
    expect([...root.querySelectorAll("details")].some((details) => details.open)).toBe(false);
  });

  test("D-149: opening on Show all opens every breakdown, and not the floating patch panels; a later call is served without a second fetch", async () => {
    const root = dom();
    const { fetchFn } = stub({ [ROOT_URL]: OK });
    const versions = createVersions(root, { fetch: fetchFn });

    await versions.showAll(true);
    expect([...root.querySelectorAll("details[data-breakdown]")].every((details) => details.open)).toBe(true);
    expect([...root.querySelectorAll("details[data-patches]")].some((details) => details.open)).toBe(false);
    await versions.showAll(false);

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  test("D-149: concurrent calls share one request and one drawing", async () => {
    const root = dom();
    const rendered = vi.fn();
    root.addEventListener("ocx:versions:rendered", rendered);
    const { fetchFn } = stub({ [ROOT_URL]: OK });
    const versions = createVersions(root, { fetch: fetchFn });

    expect(await Promise.all([versions.showAll(true), versions.showAll(false)])).toEqual([true, true]);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(rendered).toHaveBeenCalledTimes(1);
  });

  test("D-149: a row the fetched root no longer has keeps its prerendered tags", async () => {
    const root = dom();
    const body = wireRoot({ "1.0": { content: DIGEST } });
    await createVersions(root, { fetch: stub({ [ROOT_URL]: { status: 200, body } }).fetchFn }).showAll(false);

    expect(root.querySelector("#prerendered")).toBeNull();
    expect(root.querySelector("#prerendered-slim")).not.toBeNull();
  });

  test("D-149: a tree that cannot be completed leaves the prerendered page whole, not half drawn", async () => {
    const root = dom();
    // The other row is built last: the failure comes after both variant rows were built.
    root.querySelector('template[data-tpl="chip"]')!.remove();

    expect(await createVersions(root, { fetch: stub({ [ROOT_URL]: OK }).fetchFn }).showAll(true)).toBe(false);

    expect(root.querySelector("#prerendered")).not.toBeNull();
    expect(root.querySelector("#prerendered-slim")).not.toBeNull();
    expect(root.querySelectorAll("[data-lazy]").length).toBeGreaterThan(0);
    expect([...root.querySelectorAll("details")].some((details) => details.open)).toBe(false);
  });

  test("D-149: a page without a breakdown, an other row or its list is drawn without them", async () => {
    for (const options of [{ noGroups: true }, { noOther: true }, { noOtherList: true }]) {
      const root = dom(options);
      expect(await createVersions(root, { fetch: stub({ [ROOT_URL]: OK }).fetchFn }).showAll(false)).toBe(true);
    }
  });

  test("D-149: the package status decides how a withdrawn package is drawn", async () => {
    for (const status of ["active", "deprecated", "yanked", "other"]) {
      const root = dom({ status });
      expect(await createVersions(root, { fetch: stub({ [ROOT_URL]: OK }).fetchFn }).showAll(false)).toBe(true);
    }
  });

  test("D-149: a catalog under /catalog/ fetches below the base, a non-root source below its mount", async () => {
    const { fetchFn, calls } = stub({ "/catalog/index/acme/p/acme/tool/_root.json": OK });
    const root = dom({ base: "/catalog/", wireBase: "index/acme" });

    expect(await createVersions(root, { fetch: fetchFn }).showAll(false)).toBe(true);

    expect(calls).toEqual(["/catalog/index/acme/p/acme/tool/_root.json"]);
  });

  test("D-149: a mount that has no _root.json alias falls back to the root's own .json", async () => {
    const { fetchFn, calls } = stub({ "/p/acme/tool.json": OK });

    expect(await createVersions(dom(), { fetch: fetchFn }).showAll(false)).toBe(true);

    expect(calls).toEqual([ROOT_URL, "/p/acme/tool.json"]);
  });

  test("D-149: without an injected fetch the global one is read at call time", async () => {
    const { fetchFn, calls } = stub({ [ROOT_URL]: OK });
    vi.stubGlobal("fetch", fetchFn);
    try {
      expect(await createVersions(dom()).showAll(false)).toBe(true);
      expect(calls).toEqual([ROOT_URL]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("showAll — loading and error states (D-091, D-093)", () => {
  test("D-091: the status line says the versions are loading while the root is in flight", async () => {
    const root = dom();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fetchFn = vi.fn(async () => {
      await gate;
      return { ok: true, status: 200, json: async () => wireRoot(TAGS) };
    }) as unknown as FetchLike;
    const pending = createVersions(root, { fetch: fetchFn }).showAll(false);

    expect(text(root.querySelector("[data-versions-status]"))).toBe("Loading all versions…");
    release();
    await pending;
    expect(text(root.querySelector("[data-versions-status]"))).toBe("");
  });

  test("D-093: an HTTP error leaves the prerendered tree and says why; the next call tries again", async () => {
    const root = dom();
    const { fetchFn, calls } = stub({ [ROOT_URL]: [{ status: 500 }, OK] });
    const versions = createVersions(root, { fetch: fetchFn });

    expect(await versions.showAll(true)).toBe(false);

    expect(text(root.querySelector("[data-versions-status]"))).toBe("Failed to load: HTTP 500");
    expect(root.querySelector("#prerendered")).not.toBeNull();
    expect(root.querySelectorAll("[data-lazy]").length).toBeGreaterThan(0);

    expect(await versions.showAll(true)).toBe(true);
    expect(calls).toEqual([ROOT_URL, ROOT_URL]);
    expect(text(root.querySelector("[data-versions-status]"))).toBe("");
  });

  test("D-093: a root that is not there reads Package not found", async () => {
    const root = dom();
    expect(await createVersions(root, { fetch: stub({}).fetchFn }).showAll(false)).toBe(false);
    expect(text(root.querySelector("[data-versions-status]"))).toBe("Failed to load: Package not found: acme/tool");
  });

  test("D-093: a network error and a body that is no package root are reported, whatever was thrown", async () => {
    const network = dom();
    await createVersions(network, { fetch: stub({ [ROOT_URL]: new Error("NetworkError") }).fetchFn }).showAll(false);
    expect(text(network.querySelector("[data-versions-status]"))).toBe("Failed to load: NetworkError");

    const thrown = dom();
    await createVersions(thrown, { fetch: stub({ [ROOT_URL]: "boom" }).fetchFn }).showAll(false);
    expect(text(thrown.querySelector("[data-versions-status]"))).toBe("Failed to load: unknown error");

    const malformed = dom();
    await createVersions(malformed, { fetch: stub({ [ROOT_URL]: { status: 200, body: { name: "x" } } }).fetchFn }).showAll(false);
    expect(text(malformed.querySelector("[data-versions-status]"))).toBe("Failed to load: package root has no valid tags");
  });
});

describe("release — the preview of a tag the page did not prerender (D-060, D-071)", () => {
  const IMAGE_URL = `/p/acme/tool/o/sha256/${HEX}.json`;
  const INDEX = {
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.index.v1+json",
    manifests: [{ mediaType: "m", digest: DIGEST, size: 1, platform: { os: "linux", architecture: "amd64" } }],
    annotations: {
      "org.opencontainers.image.licenses": "MIT",
      "org.opencontainers.image.source": "https://github.com/acme/tool",
      "org.opencontainers.image.revision": "9e8a183",
    },
  };

  test("D-060: fetches the tag's image index and reads its platforms, license, source and revision", async () => {
    const { fetchFn, calls } = stub({ [ROOT_URL]: OK, [IMAGE_URL]: { status: 200, body: INDEX } });

    const facts = await createVersions(dom(), { fetch: fetchFn }).release("1.0.0");

    expect(facts).toEqual({ platforms: ["linux/amd64"], license: "MIT", source: "https://github.com/acme/tool", revision: "9e8a183" });
    expect(calls).toEqual([ROOT_URL, IMAGE_URL]);
  });

  test("D-060: the root is fetched once for any number of previews, and a digest once", async () => {
    const { fetchFn, calls } = stub({ [ROOT_URL]: OK, [IMAGE_URL]: { status: 200, body: INDEX } });
    const versions = createVersions(dom(), { fetch: fetchFn });

    await versions.release("1.0.0");
    await versions.release("1.0.1");
    await versions.showAll(false);

    expect(calls).toEqual([ROOT_URL, IMAGE_URL]);
  });

  test("D-071: a source that is not an http(s) URL is dropped from the preview", async () => {
    const index = { ...INDEX, annotations: { "org.opencontainers.image.source": "javascript:alert(1)" } };
    const { fetchFn } = stub({ [ROOT_URL]: OK, [IMAGE_URL]: { status: 200, body: index } });

    expect((await createVersions(dom(), { fetch: fetchFn }).release("1.0.0"))?.source).toBeNull();
  });

  test("D-071: the root's own source wins over the tag's annotation, and a tag without one still has the root's", async () => {
    for (const annotations of [{ "org.opencontainers.image.source": "https://github.com/acme/tag-repo" }, {}]) {
      const body = { ...wireRoot(TAGS), source: "https://github.com/acme/root-repo" };
      const { fetchFn } = stub({ [ROOT_URL]: { status: 200, body }, [IMAGE_URL]: { status: 200, body: { ...INDEX, annotations } } });
      expect((await createVersions(dom(), { fetch: fetchFn }).release("1.0.0"))?.source).toBe("https://github.com/acme/root-repo");
    }
  });

  test("D-071: a root source that is no http(s) URL leaves the tag no source, as for a prerendered tag", async () => {
    const body = { ...wireRoot(TAGS), source: "javascript:alert(1)" };
    const { fetchFn } = stub({ [ROOT_URL]: { status: 200, body }, [IMAGE_URL]: { status: 200, body: INDEX } });
    expect((await createVersions(dom(), { fetch: fetchFn }).release("1.0.0"))?.source).toBeNull();
  });

  test("D-093: a later preview that works clears the failure notice an earlier one left", async () => {
    const root = dom();
    const other = `/p/acme/tool/o/sha256/${"b".repeat(64)}.json`;
    const { fetchFn } = stub({ [ROOT_URL]: OK, [other]: { status: 200, body: INDEX } });
    const versions = createVersions(root, { fetch: fetchFn });

    expect(await versions.release("1.0.0")).toBeNull();
    expect(text(root.querySelector("[data-versions-status]"))).toBe("Failed to load: image index unavailable");
    expect(await versions.release("1.1.0")).not.toBeNull();

    expect(text(root.querySelector("[data-versions-status]"))).toBe("");
  });

  test("D-071: a tag the root does not have has no facts, and neither has a name from Object.prototype", async () => {
    const { fetchFn } = stub({ [ROOT_URL]: OK });
    const versions = createVersions(dom(), { fetch: fetchFn });

    expect(await versions.release("9.9.9")).toBeNull();
    expect(await versions.release("constructor")).toBeNull();
  });

  test("D-093: an image index that cannot be loaded says so and gives no facts", async () => {
    const root = dom();
    const { fetchFn } = stub({ [ROOT_URL]: OK });

    expect(await createVersions(root, { fetch: fetchFn }).release("1.0.0")).toBeNull();

    expect(text(root.querySelector("[data-versions-status]"))).toBe("Failed to load: image index unavailable");
  });

  test("D-093: a root that cannot be loaded says so and gives no facts", async () => {
    const root = dom();
    expect(await createVersions(root, { fetch: stub({ [ROOT_URL]: { status: 503 } }).fetchFn }).release("1.0.0")).toBeNull();
    expect(text(root.querySelector("[data-versions-status]"))).toBe("Failed to load: HTTP 503");
  });
});

describe("the markup contract", () => {
  test("D-149: each datum the island reads is named when it is missing", () => {
    for (const key of ["base", "ns", "pkg", "wireBase", "status"] as const) {
      const root = dom();
      delete root.dataset[key];
      const name = key === "wireBase" ? "wire-base" : key;
      expect(() => createVersions(root)).toThrow(`versions: no ${name} (set data-${name} on the root)`);
    }
  });

  test("D-149: a missing status line or template is named when it is needed", async () => {
    const noStatus = dom();
    noStatus.querySelector("[data-versions-status]")!.remove();
    expect(() => createVersions(noStatus)).toThrow("versions: missing [data-versions-status] in the versions root");

    const noTemplate = dom();
    noTemplate.querySelector('template[data-tpl="major"]')!.remove();
    await expect(createVersions(noTemplate, { fetch: stub({ [ROOT_URL]: OK }).fetchFn }).showAll(false)).resolves.toBe(false);
    expect(text(noTemplate.querySelector("[data-versions-status]"))).toBe(
      'Failed to load: versions: missing template[data-tpl="major"] in the versions root',
    );
  });
});
