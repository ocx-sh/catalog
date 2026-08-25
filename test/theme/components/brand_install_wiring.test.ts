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
// `isDark` is C-601 test additions' own requirement: mounting PackageCard
// pulls in LogoTile -> MonogramTile, which reads `useData().isDark` (the
// theme-aware monogram palette) — the pre-existing mock only ever needed
// `theme` (Logo/InstallRow/MetaRail render no MonogramTile).
vi.mock("vitepress", () => ({ useData: () => ({ theme: themeState, isDark: ref(false) }) }));

const Logo = (await import("../../../src/theme/components/layout/Logo.vue")).default;
const InstallRow = (await import("../../../src/theme/components/catalog/InstallRow.vue")).default;
const MetaRail = (await import("../../../src/theme/components/detail/MetaRail.vue")).default;
const PackageCard = (await import("../../../src/theme/components/catalog/PackageCard.vue")).default;
const IdentityBlock = (await import("../../../src/theme/components/detail/IdentityBlock.vue")).default;
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

/** C-601 fixtures: a corporate-mirror deployment whose wire `root.name`
 * carries ITS OWN brand token (`acme.example`, not `ocx.sh`) — proves the
 * install/copy-link surface renders whatever prefix the wire actually
 * supplies, never a hardcoded `ocx.sh/` re-synthesis (S-01). */
const ACME_ROOT = {
  ...ROOT,
  name: "acme.example/widgets/tool",
};

const ACME_PKG = {
  namespace: "widgets",
  package: "tool",
  name: "acme.example/widgets/tool",
  status: "active" as const,
  deprecatedMessage: null,
  supersededBy: null,
  created: "2026-01-01T00:00:00Z",
  updated: null,
  title: "Tool",
  description: "An acme tool",
  keywords: [],
  latestVersion: "2.0.0",
  tagCount: 3,
  platforms: [],
  logoUrl: null,
  readmeUrl: null,
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

  // C-606: the built-in mark used to be inlined raw <svg> DOM here (56% of
  // every page's HTML bytes); it's now a Vite `?url` asset import — an
  // `<img>` pointing at a real, once-emitted file, same as a configured
  // brand.logo, distinguished only by WHICH file it points to.
  test("no brand.logo -> the theme's built-in mark, emitted once as a real asset (not inlined per-page)", () => {
    const html = mount(Logo).html();
    expect(html).not.toContain("<svg");
    expect(html).toMatch(/<img[^>]*src="[^"]*ocx-logo\.svg[^"]*"/);
  });
});

describe("install wiring — catalog card install box (InstallRow)", () => {
  test("shows the FIRST flavor's command, the built-in `ocx add` shorthand", () => {
    expect(mount(InstallRow, { props: { qualifiedName: "ocx.sh/kitware/cmake" } }).html()).toContain(
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

// C-601: a corporate-mirror deployment's own index carries its own brand
// token in `root.name` (e.g. `acme.example/<ns>/<pkg>`, not `ocx.sh/...`).
// Every surface below used to strip a hardcoded `ocx.sh/` and re-synthesize
// it, which rendered a WRONG, uninstallable command
// (`ocx add ocx.sh/acme.example/widgets/tool`) on such a deployment — these
// assert the RENDERED result carries the fixture's OWN prefix instead.
describe("C-601 mirror-agnostic install / copy-link", () => {
  test("PackageCard's install row renders a non-ocx.sh package's own prefix, never ocx.sh/", () => {
    const html = mount(PackageCard, { props: { pkg: ACME_PKG } }).html();
    expect(installCommands(html)).toEqual(["ocx add acme.example/widgets/tool"]);
    expect(html).not.toContain("ocx.sh/");
  });

  test("IdentityBlock's name badge renders a non-ocx.sh root's own prefix, never ocx.sh/", () => {
    const html = mount(IdentityBlock, {
      props: { root: ACME_ROOT, bareName: "widgets/tool", latestVersionLabel: null },
    }).html();
    expect(html).toContain("acme.example/widgets/tool");
    expect(html).not.toContain("ocx.sh/");
  });

  // Copy-link used to DERIVE the route by stripping the qualified name's
  // first segment. That held only while every package sat at a bare
  // `<ns>/<pkg>` route; a non-root index's package is served at
  // `/<index>/<ns>/<pkg>`, so the route is no longer a function of the name
  // and the owner of the link passes it in.
  test("buildTagCopyActions' Copy-link uses the route it is given, brand token and all", () => {
    for (const [qualifiedName, routePath] of [
      ["ocx.sh/kitware/cmake", "/kitware/cmake"],
      ["acme.example/widgets/tool", "/acme.example/widgets/tool"],
    ]) {
      const actions = buildTagCopyActions(qualifiedName, null, [], routePath);
      const copyLink = actions.find((a) => a.label === "Copy link");
      expect(copyLink?.command).toBe(`${window.location.origin}${routePath}`);
    }
  });

  // The detail page's own menus (MetaRail/VersionTree/TagBadge) pass no
  // route: the page being viewed IS the package, so its own URL is the link
  // and there is nothing to derive.
  test("buildTagCopyActions' Copy-link falls back to the current page's own URL", () => {
    const actions = buildTagCopyActions("acme.example/widgets/tool", null, []);
    const copyLink = actions.find((a) => a.label === "Copy link");
    expect(copyLink?.command).toBe(`${window.location.origin}${window.location.pathname}`);
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

  // C-601: the literal `ocx.sh/` brand-prefix synthesis that made every
  // install/copy-link surface above ONLY correct for the reference
  // `ocx.sh`-prefixed deployment must never come back in any of the five
  // components that build a qualified name / install command / copy link.
  test("no component synthesizes a hardcoded ocx.sh/ prefix", () => {
    for (const relPath of [
      "src/theme/components/catalog/PackageCard.vue",
      "src/theme/components/catalog/PackageTable.vue",
      "src/theme/components/catalog/InstallRow.vue",
      "src/theme/components/detail/IdentityBlock.vue",
      "src/theme/components/shared/CopyContextMenu.vue",
    ]) {
      expect(sourceWithoutComments(relPath), relPath).not.toContain("ocx.sh/");
    }
  });
});
