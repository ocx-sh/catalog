// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import { buildTagCopyActions } from "../../../src/site/lib/copyActions.js";
import { DEFAULT_INSTALL_FLAVORS } from "../../../src/site/lib/installFlavors.js";

/** A non-default set of install flavors, for `buildTagCopyActions`'s own
 * generic behavior — unrelated to config since `install[]` was removed. */
const CUSTOM_FLAVORS = [
  { label: "Vendor it", command: "acme vendor {name}", icon: "project" as const },
  { label: "Add globally", command: "acme --global add {name}", icon: "global" as const },
];

describe("buildTagCopyActions", () => {
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

  test("a tag-less call copies the bare name and omits the tag action", () => {
    const actions = buildTagCopyActions("ocx.sh/kitware/cmake", null, []);
    expect(actions.map((a) => [a.label, a.command, a.icon])).toEqual([
      ["Copy identifier", "ocx.sh/kitware/cmake", "identifier"],
      ["Copy link", `${window.location.origin}${window.location.pathname}`, "link"],
    ]);
  });

  test("a tagged call copies name:tag and the tag on its own", () => {
    const actions = buildTagCopyActions("ocx.sh/kitware/cmake", "3.31.7", []);
    expect(actions.find((a) => a.icon === "identifier")?.command).toBe("ocx.sh/kitware/cmake:3.31.7");
    expect(actions.find((a) => a.icon === "tag")?.command).toBe("3.31.7");
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

  // Copy-link used to DERIVE the route by stripping the qualified name's
  // first segment. That held only while every package sat at a bare
  // `<ns>/<pkg>` route; a non-root index's package is served at
  // `/<index>/<ns>/<pkg>`, so the route is no longer a function of the name
  // and the owner of the link passes it in.
  test("Copy-link uses the route it is given, brand token and all", () => {
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
  test("Copy-link falls back to the current page's own URL", () => {
    const actions = buildTagCopyActions("acme.example/widgets/tool", null, []);
    const copyLink = actions.find((a) => a.label === "Copy link");
    expect(copyLink?.command).toBe(`${window.location.origin}${window.location.pathname}`);
  });
});
