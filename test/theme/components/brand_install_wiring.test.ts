// @vitest-environment happy-dom
//
// Wiring pin for the C-002 `brand` config surface, plus the theme's fixed
// install-command surface. Same reason `readme_pane_wiring.test.ts` exists,
// and the same failure mode: `themeConfig.brand` was fully generated, fully
// covered, and read by NO component — `SiteHeader` hardcoded the wordmark and
// `Logo` hardcoded the mark. Branch coverage cannot see that (every line ran;
// none of it was reachable from config), so this file asserts the RENDERED
// result for a configured theme and for an unconfigured one, plus a
// source-level pin against the literals coming back.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mount } from "@vue/test-utils";
import { describe, expect, test, vi, beforeEach } from "vitest";
import { ref } from "vue";

const themeState = ref<Record<string, unknown>>({});
vi.mock("vitepress", () => ({ useData: () => ({ theme: themeState }) }));

const Logo = (await import("../../../src/theme/components/layout/Logo.vue")).default;
const InstallRow = (await import("../../../src/theme/components/catalog/InstallRow.vue")).default;
const MetaRail = (await import("../../../src/theme/components/detail/MetaRail.vue")).default;
const { buildTagCopyActions } = await import("../../../src/theme/components/shared/CopyContextMenu.vue");
const { DEFAULT_INSTALL_FLAVORS } = await import("../../../src/theme/composables/useInstallFlavors.js");

/** A rebranded deployment: its own wordmark + logo (the CLI name itself is
 * fixed theme content, not configurable — see `useInstallFlavors.ts`). */
const ACME_THEME = {
  brand: { title: "Acme Packages", wordmark: "packages.acme.example", logo: "/acme-logo.svg" },
}

/** A non-default set of install flavors, for `buildTagCopyActions`'s own
 * generic behavior — unrelated to config since `install[]` was removed. */
const CUSTOM_FLAVORS = [
  { label: "Vendor it", command: "acme vendor {name}", icon: "project" as const },
  { label: "Add globally", command: "acme --global add {name}", icon: "global" as const },
];

const ROOT = {
  name: "ocx.sh/kitware/cmake",
  repository: "oci://ghcr.io/ocx-contrib/cmake",
  owners: [{ github: "ocx-sh" }],
  status: "active" as const,
  deprecated_message: null,
  created: "2026-01-01T00:00:00Z",
  desc: null,
  tags: {},
};

/** MetaRail with no variants/alias chain — the install grid still renders
 * (its rows only need a resolvable tag), and no reka-ui Select is mounted. */
function mountMetaRail() {
  return mount(MetaRail, {
    props: {
      root: ROOT,
      qualifiedName: "ocx.sh/kitware/cmake",
      primaryTag: "latest",
      latestVersionLabel: "3.31.7",
      activeImageIndex: null,
      tagCount: 1,
      table: { rows: [], unknownTags: [] },
    },
  });
}

/** The command text of each rendered install row, in order. `[^>]*` before
 * `class` tolerates the scoped-CSS `data-v-xxxxxxxx` attribute Vue's SFC
 * compiler emits ahead of it. */
function installCommands(html: string): string[] {
  return [...html.matchAll(/<span[^>]*class="install-cmd"[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]);
}

beforeEach(() => {
  themeState.value = {};
});

describe("brand wiring — Logo", () => {
  test("a configured brand.logo renders as the header mark", () => {
    themeState.value = ACME_THEME;
    const html = mount(Logo).html();
    expect(html).toContain('src="/acme-logo.svg"');
    expect(html).not.toContain("<svg");
  });

  test("no brand.logo -> the theme's built-in inline mark, unchanged", () => {
    const html = mount(Logo).html();
    expect(html).toContain("<svg");
    expect(html).toContain('viewBox="0 0 270.93 270.93"');
    expect(html).not.toContain("<img");
  });
});

describe("install wiring — catalog card install box (InstallRow)", () => {
  test("shows the FIRST flavor's command, the built-in `ocx add` shorthand", () => {
    expect(mount(InstallRow, { props: { name: "kitware/cmake" } }).html()).toContain(
      "ocx add ocx.sh/kitware/cmake",
    );
  });
});

describe("install wiring — detail install grid (MetaRail)", () => {
  test("renders the built-in four rows, in order", () => {
    expect(installCommands(mountMetaRail().html())).toEqual([
      "ocx add ocx.sh/kitware/cmake",
      "ocx --global add ocx.sh/kitware/cmake",
      "ocx package exec ocx.sh/kitware/cmake",
      "ocx package install ocx.sh/kitware/cmake",
    ]);
  });
});

describe("install wiring — copy context menu", () => {
  test("carries one command item per flavor, after the copy actions", () => {
    const actions = buildTagCopyActions("ocx.sh/kitware/cmake", "3.31.7", CUSTOM_FLAVORS);
    expect(actions.map((a) => a.label)).toEqual([
      "Copy identifier",
      "Copy tag",
      "Copy link",
      "Vendor it",
      "Add globally",
    ]);
    expect(actions.at(-1)?.command).toBe("acme --global add ocx.sh/kitware/cmake:3.31.7");
  });

  test("built-in flavors reproduce the default command set", () => {
    const actions = buildTagCopyActions("ocx.sh/kitware/cmake", null, DEFAULT_INSTALL_FLAVORS);
    expect(actions.filter((a) => !a.label.startsWith("Copy ")).map((a) => a.command)).toEqual([
      "ocx add ocx.sh/kitware/cmake",
      "ocx --global add ocx.sh/kitware/cmake",
      "ocx package exec ocx.sh/kitware/cmake",
      "ocx package install ocx.sh/kitware/cmake",
    ]);
  });
});

/*
 * Source-level pin: the literals that made all of the above dead code in the
 * first place must not come back. A component may name the CLI in a comment;
 * only executable template/script text is checked, which is why each read
 * strips comments before matching.
 */
function sourceWithoutComments(relPath: string): string {
  return readFileSync(resolve(process.cwd(), relPath), "utf8")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("no hardcoded brand or CLI name in the theme's own source", () => {
  test("SiteHeader renders the wordmark from config, never a baked host name", () => {
    const source = sourceWithoutComments("src/theme/components/layout/SiteHeader.vue");
    expect(source).toContain("{{ wordmark }}");
    expect(source).not.toContain("index.ocx.sh");
  });

  test("every install-command surface builds its commands from a flavor, never a literal", () => {
    for (const relPath of [
      "src/theme/components/detail/MetaRail.vue",
      "src/theme/components/catalog/InstallRow.vue",
      "src/theme/components/shared/CopyContextMenu.vue",
    ]) {
      const source = sourceWithoutComments(relPath);
      expect(source, relPath).toContain("installCommand(");
      // `ocx add`, `ocx package …`, `ocx --global …` — the hardcoded shapes.
      expect(source, relPath).not.toMatch(/['"`]ocx\s(add|--global|package)\b/);
    }
  });

  test("the built-in CLI name lives in exactly one module", () => {
    const source = sourceWithoutComments("src/theme/composables/useInstallFlavors.ts");
    expect(source).toMatch(/['"`]ocx add \{name\}['"`]/);
  });
});
