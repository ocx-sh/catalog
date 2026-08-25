// @vitest-environment happy-dom
//
// Owner finding: every package link in the ⌘K palette 404'd on a multi-index
// catalog. `SearchModal.vue` built `/<ns>/<pkg>` by hand while
// `build/sources_pipeline.ts` writes a non-root index's pages under their
// index name — the exact rule `utils/packageRoute.ts` exists to hold, and
// which `PackageCard`/`PackageTable` already went through.
//
// The palette had never been mounted by any test: `@localSearchIndex` is a
// VitePress-plugin virtual module, so Vite could not transform the SFC at
// all (see the alias in `vitest.config.ts`). That is why a route rule
// re-derived at the call site survived here and nowhere else.
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ref } from "vue";

const routerGo = vi.fn();
vi.mock("vitepress", () => ({
  useData: () => ({ localeIndex: ref("root"), theme: ref({}), isDark: ref(false) }),
  useRoute: () => ({ path: "/" }),
  useRouter: () => ({ go: routerGo }),
}));

function pkg(name: string) {
  const [, namespace, ...rest] = name.split("/");
  return {
    namespace: namespace!,
    package: rest.join("/"),
    name,
    status: "active" as const,
    deprecatedMessage: null,
    supersededBy: null,
    created: "2026-01-01T00:00:00Z",
    updated: null,
    title: rest.join("/"),
    description: "A widget",
    keywords: ["cli"],
    latestVersion: "1.0.0",
    tagCount: 1,
    platforms: ["linux/amd64"],
    logoUrl: null,
    readmeUrl: null,
  };
}

/** Same package id published by two indexes — the case that makes a bare
 * route ambiguous as well as wrong. */
const AGGREGATED = {
  generated: "2026-01-01T00:00:00Z",
  indexes: [
    { name: "ocx.sh", root: true, count: 1 },
    { name: "corp.example", root: false, count: 1 },
  ],
  packages: [pkg("ocx.sh/tools/widget"), pkg("corp.example/tools/widget")],
};

const SINGLE_SOURCE = {
  generated: "2026-01-01T00:00:00Z",
  packages: [pkg("ocx.sh/tools/widget")],
};

const originalFetch = globalThis.fetch;

beforeEach(() => {
  // Both useCatalog and useCommandPalette hold module-level state; a fresh
  // module graph per test keeps the catalog fixture and the open flag from
  // leaking between them.
  vi.resetModules();
  routerGo.mockClear();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  document.body.innerHTML = "";
});

/** Mounts the real palette against `payload` and opens it — the modal
 * portals into `<body>`, so every assertion reads the document, not the
 * wrapper. */
async function openPalette(payload: unknown, query: string) {
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload) }),
  ) as unknown as typeof fetch;

  const { useCommandPalette } = await import("../../../src/theme/composables/useCommandPalette");
  const SearchModal = (await import("../../../src/theme/components/search/SearchModal.vue")).default;
  const wrapper = mount(SearchModal, { attachTo: document.body });

  useCommandPalette().open();
  await vi.waitFor(() => expect(document.querySelector(".palette-input")).not.toBeNull());

  const input = document.querySelector<HTMLInputElement>(".palette-input")!;
  input.value = query;
  input.dispatchEvent(new Event("input"));
  await vi.waitFor(() => expect(document.querySelectorAll(".palette-result").length).toBeGreaterThan(0));
  return wrapper;
}

function resultHrefs(): string[] {
  return [...document.querySelectorAll<HTMLAnchorElement>(".palette-result")].map(a => a.getAttribute("href")!);
}

describe("command palette — package links follow the shared route rule", () => {
  test("a non-root index's package links under its index name, not a bare path", async () => {
    await openPalette(AGGREGATED, "widget");

    expect(resultHrefs()).toEqual(
      expect.arrayContaining(["/tools/widget", "/corp.example/tools/widget"]),
    );
    // The bug: both collapsed onto the same bare path, so the corp.example
    // entry linked at a page that does not exist.
    expect(resultHrefs()).not.toEqual(["/tools/widget", "/tools/widget"]);
  });

  test("clicking navigates to that same qualified path", async () => {
    await openPalette(AGGREGATED, "widget");

    const corp = [...document.querySelectorAll<HTMLAnchorElement>(".palette-result")].find(
      a => a.getAttribute("href") === "/corp.example/tools/widget",
    );
    expect(corp).toBeDefined();
    corp!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(routerGo).toHaveBeenCalledWith("/corp.example/tools/widget");
  });

  test("a single-source catalog keeps the bare path it has always had", async () => {
    await openPalette(SINGLE_SOURCE, "widget");

    expect(resultHrefs()).toEqual(["/tools/widget"]);
  });
});
