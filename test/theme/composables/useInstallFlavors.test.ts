import { describe, expect, it } from "vitest";
import { DEFAULT_INSTALL_FLAVORS } from "../../../src/site/lib/installFlavors.js";

const { useInstallFlavors } = await import("../../../src/theme/composables/useInstallFlavors.js");

describe("useInstallFlavors", () => {
  it("always resolves to DEFAULT_INSTALL_FLAVORS", () => {
    const flavors = useInstallFlavors();
    expect(flavors.value).toBe(DEFAULT_INSTALL_FLAVORS);
  });
});
