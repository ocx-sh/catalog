import { afterEach, describe, expect, test, vi } from "vitest";
import { cardCopyData, cardCopyItems } from "../../../src/site/lib/cardCopy.js";
import { buildTagCopyActions } from "../../../src/site/lib/copyActions.js";
import { DEFAULT_INSTALL_FLAVORS } from "../../../src/site/lib/installFlavors.js";

afterEach(() => vi.unstubAllGlobals());

describe("D-002 the card copy menu reads the same list as the version list and the install card", () => {
  test("D-002 the entries are the actions of buildTagCopyActions: same labels, same order, keyed by the action's icon", () => {
    // The link is the one entry that needs a browser.
    vi.stubGlobal("window", { location: { origin: "http://x" } });
    const actions = buildTagCopyActions("a/x/y", "1", DEFAULT_INSTALL_FLAVORS, "/y/");
    const items = cardCopyItems(DEFAULT_INSTALL_FLAVORS);
    expect(items.map((item) => item.label)).toEqual(actions.map((action) => action.label));
    expect(items.map((item) => item.value)).toEqual(actions.map((action) => action.icon));
    expect(items.map((item) => item.value)).toEqual(["identifier", "tag", "link", "project", "global", "exec", "install"]);
  });

  test("D-002 on the server there is no origin: the texts come without a link, and without a tag when there is none", () => {
    // This suite runs in node: `window` is undefined, as in the Astro build.
    expect(typeof window).toBe("undefined");
    expect(Object.keys(cardCopyData("a/x/y", "1", DEFAULT_INSTALL_FLAVORS))).toEqual(["identifier", "tag", "project", "global", "exec", "install"]);
    expect(Object.keys(cardCopyData("a/x/y", null, DEFAULT_INSTALL_FLAVORS))).toEqual(["identifier", "project", "global", "exec", "install"]);
  });
});
