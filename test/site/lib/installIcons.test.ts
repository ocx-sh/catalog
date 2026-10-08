import { ICONS } from "@ocx-sh/theme/icons";
import { describe, expect, it } from "vitest";
import { DEFAULT_INSTALL_FLAVORS } from "../../../src/site/lib/installFlavors.js";
import { INSTALL_ICON_NAMES } from "../../../src/site/lib/installIcons.js";

describe("INSTALL_ICON_NAMES", () => {
  it("maps the icon of every install flavor to an icon the theme registry ships", () => {
    for (const { icon } of DEFAULT_INSTALL_FLAVORS) {
      expect(Object.keys(ICONS), icon).toContain(INSTALL_ICON_NAMES[icon]);
    }
  });
});
