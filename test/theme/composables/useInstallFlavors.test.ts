import { describe, expect, it } from "vitest";

const { DEFAULT_INSTALL_FLAVORS, installCommand, useInstallFlavors } = await import(
  "../../../src/theme/composables/useInstallFlavors.js"
);

describe("DEFAULT_INSTALL_FLAVORS", () => {
  it("is the four built-in flavors, in install-grid order, each carrying a {name} token", () => {
    expect(DEFAULT_INSTALL_FLAVORS.map((f) => [f.label, f.command, f.icon])).toEqual([
      ["Add to project", "ocx add {name}", "project"],
      ["Add globally", "ocx --global add {name}", "global"],
      ["Run without installing", "ocx package exec {name}", "exec"],
      ["Install package", "ocx package install {name}", "install"],
    ]);
  });
});

describe("installCommand", () => {
  it("substitutes every {name} token", () => {
    expect(installCommand("ocx add {name}", "ocx.sh/kitware/cmake")).toBe("ocx add ocx.sh/kitware/cmake");
    expect(installCommand("x {name} y {name}", "n")).toBe("x n y n");
  });

  it("leaves a template with no token alone", () => {
    expect(installCommand("ocx doctor", "ocx.sh/kitware/cmake")).toBe("ocx doctor");
  });

  it("treats the package name as inert data, not a replacement pattern", () => {
    // `$&`/`$'` are replacement-string directives for String.replace — a
    // package literally named this would splice the match back in if the
    // substitution ever regressed to replace()/replaceAll().
    expect(installCommand("ocx add {name}", "ocx.sh/ns/$&$'")).toBe("ocx add ocx.sh/ns/$&$'");
  });
});

describe("useInstallFlavors", () => {
  it("always resolves to DEFAULT_INSTALL_FLAVORS", () => {
    const flavors = useInstallFlavors();
    expect(flavors.value).toBe(DEFAULT_INSTALL_FLAVORS);
  });
});
