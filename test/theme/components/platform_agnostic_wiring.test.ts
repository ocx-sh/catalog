// @vitest-environment happy-dom
//
// A package whose only platform is OCX's platform-agnostic one (wire
// `{"os":"any","architecture":"any"}`, viewmodel string `any/any`) used to fall
// through every surface's unknown-OS path: an EMPTY, invisible glyph labelled
// "any" on the card, a stray fourth `any` column in the table, and a matrix row
// with a blank glyph and a literal `any` architecture badge. `.vue` internals
// are excluded from coverage, so this pins the RENDERED result of each surface
// routing `any` through the special case, plus the two CSS declarations the
// browser needs and happy-dom cannot lay out.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ref } from "vue";

vi.mock("vitepress", () => ({
  useData: () => ({ theme: ref({}), isDark: ref(false) }),
}));

const PackageCard = (await import("../../../src/theme/components/catalog/PackageCard.vue")).default;
const PackageTable = (await import("../../../src/theme/components/catalog/PackageTable.vue")).default;
const PlatformMatrix = (await import("../../../src/theme/components/detail/PlatformMatrix.vue")).default;

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.resetModules();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  document.body.innerHTML = "";
});

function pkg(name: string, platforms: string[]) {
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
    description: "A package",
    keywords: ["cli"],
    latestVersion: "1.0.0",
    tagCount: 1,
    platforms,
    logoUrl: null,
    readmeUrl: null,
  };
}

const ANY_ONLY = pkg("ocx.sh/acme/portable", ["any/any"]);
const MIXED = pkg("ocx.sh/acme/hybrid", ["any/any", "linux/amd64"]);
const LINUX = pkg("ocx.sh/acme/penguin", ["linux/amd64"]);
const DARWIN = pkg("ocx.sh/acme/apple", ["darwin/arm64"]);

function descriptor(os: string, architecture: string) {
  return {
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    digest: `sha256:${"a".repeat(64)}`,
    size: 1,
    platform: { os, architecture },
  };
}

/** Comments blanked so a rule merely DISCUSSED in prose never satisfies an
 * assertion about one that must be declared. */
function declarationsOf(relPath: string, selector: string): string {
  const source = readFileSync(resolve(process.cwd(), relPath), "utf8")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const match = new RegExp(`(^|[},])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "m").exec(source);
  if (match === null) throw new Error(`no rule for selector ${selector} in ${relPath}`);
  return match[2]!;
}

describe("PackageCard — platform-agnostic", () => {
  test("an any-only card draws one drawable globe labelled 'Any platform'", () => {
    const wrapper = mount(PackageCard, { props: { pkg: ANY_ONLY } });

    const glyphs = wrapper.findAll(".card-platforms svg");
    expect(glyphs).toHaveLength(1);
    expect(glyphs[0]!.attributes("aria-label")).toBe("Any platform");
    // The defect drew an svg with NO shapes in it — invisible, labelled "any".
    expect(glyphs[0]!.findAll("path, rect").length).toBeGreaterThan(0);
  });

  test("a mixed card shows the globe ALONE — any subsumes the real OS glyph", () => {
    const wrapper = mount(PackageCard, { props: { pkg: MIXED } });

    const labels = wrapper.findAll(".card-platforms svg").map(svg => svg.attributes("aria-label"));
    expect(labels).toEqual(["Any platform"]);
  });
});

describe("PackageTable — platform-agnostic", () => {
  test("an any-only row is ONE italic 'any platform' text, not a slot per OS and not an empty column", () => {
    const wrapper = mount(PackageTable, {
      props: { packages: [ANY_ONLY], osColumns: ["linux", "darwin"] },
    });

    const cell = wrapper.find(".t-platforms");
    expect(cell.element.children).toHaveLength(1);
    const text = cell.find("span.t-os-any");
    expect(text.text()).toBe("any platform");
    expect(cell.findAll("svg")).toHaveLength(0);
    expect(cell.findAll(".t-os-empty")).toHaveLength(0);
  });

  test("a mixed row is 'any platform' too — any subsumes the real OS slots", () => {
    const wrapper = mount(PackageTable, {
      props: { packages: [MIXED], osColumns: ["linux", "darwin"] },
    });

    const cell = wrapper.find(".t-platforms");
    expect(cell.element.children).toHaveLength(1);
    expect(cell.find(".t-os-any").text()).toBe("any platform");
    expect(cell.findAll("svg")).toHaveLength(0);
  });

  test("standalone columns (no osColumns) never include `any`", () => {
    const wrapper = mount(PackageTable, { props: { packages: [ANY_ONLY, LINUX] } });

    expect(wrapper.find(".t-platforms").attributes("style")).toContain("--os-cols: 1");
  });

  test("an any-only row shares a catalog with real OS rows and the real rows keep their slots", () => {
    const wrapper = mount(PackageTable, {
      props: { packages: [ANY_ONLY, LINUX, DARWIN], osColumns: ["linux", "darwin"] },
    });

    const cells = wrapper.findAll(".t-platforms").map(el => el.element.children.length);
    expect(cells).toEqual([1, 2, 2]);
  });

  test("the text spans every slot, flush left, italic, and the cell has room for it", () => {
    const decls = declarationsOf("src/theme/components/catalog/PackageTable.vue", ".t-os-any");
    expect(decls).toContain("grid-column: 1 / -1");
    expect(decls).toContain("justify-self: start");
    expect(decls).toContain("font-style: italic");
    expect(declarationsOf("src/theme/components/catalog/PackageTable.vue", ".t-platforms")).toContain(
      "min-width: 4.5rem",
    );
  });
});

describe("CatalogPage table — platform-agnostic", () => {
  test("the catalog's OS columns never grow an `any` column", async () => {
    window.localStorage.setItem("ocx-catalog-view", JSON.stringify("table"));
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            generated: "2026-01-01T00:00:00Z",
            packages: [ANY_ONLY, LINUX],
          }),
      }),
    ) as unknown as typeof fetch;
    const CatalogPage = (await import("../../../src/theme/components/catalog/CatalogPage.vue")).default;
    const wrapper = mount(CatalogPage, { attachTo: document.body });
    await vi.waitFor(() => expect(wrapper.find(".table-row").exists()).toBe(true));

    const platformCells = wrapper.findAll(".t-platforms");
    expect(platformCells.map(el => el.attributes("style"))).toEqual([
      expect.stringContaining("--os-cols: 1"),
      expect.stringContaining("--os-cols: 1"),
    ]);
    expect(platformCells[0]!.find(".t-os-any").text()).toBe("any platform");
    expect(platformCells[1]!.findAll("svg").map(svg => svg.attributes("aria-label"))).toEqual(["Linux"]);
  });
});

describe("PlatformMatrix — platform-agnostic", () => {
  test("an any-only package is one italic 'any platform' text with no glyph, no arch cell and no literal `any` arch", () => {
    const wrapper = mount(PlatformMatrix, { props: { platforms: [descriptor("any", "any")] } });

    expect(wrapper.findAll(".platform-row")).toHaveLength(1);
    expect(wrapper.find(".platform-any").text()).toBe("any platform");
    expect(wrapper.findAll(".platform-glyph, .platform-label, svg")).toHaveLength(0);
    expect(wrapper.findAll(".platform-arch-cell")).toHaveLength(0);
    expect(wrapper.findAll(".platform-arch")).toHaveLength(0);
    expect(wrapper.text()).toBe("any platform");
    expect(wrapper.find(".platform-matrix").attributes("style")).toContain("--arch-cols: 0");
    expect(wrapper.find(".platform-matrix").classes()).toContain("platform-matrix-flat");
  });

  test("a mixed package renders ONLY 'any platform' — any subsumes the real rows and arch columns", () => {
    const wrapper = mount(PlatformMatrix, {
      props: { platforms: [descriptor("any", "any"), descriptor("linux", "amd64")] },
    });

    expect(wrapper.findAll(".platform-row")).toHaveLength(1);
    expect(wrapper.text()).toBe("any platform");
    expect(wrapper.findAll(".platform-label, .platform-arch")).toHaveLength(0);
    expect(wrapper.find(".platform-matrix").classes()).toContain("platform-matrix-flat");
  });

  test("the any text spans every matrix column, italic", () => {
    const decls = declarationsOf("src/theme/components/detail/PlatformMatrix.vue", ".platform-any");
    expect(decls).toContain("grid-column: 1 / -1");
    expect(decls).toContain("font-style: italic");
  });

  test("an arch-less matrix names its two tracks instead of repeat(0, …)", () => {
    const flat = declarationsOf("src/theme/components/detail/PlatformMatrix.vue", ".platform-matrix-flat");
    expect(flat).toContain("grid-template-columns: 18px 1fr");
  });
});
