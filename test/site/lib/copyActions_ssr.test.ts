// @vitest-environment node
import { describe, expect, test } from "vitest";
import { buildTagCopyActions } from "../../../src/site/lib/copyActions.js";

// SSG renders consumers' computeds with no `window`: there is no origin to
// resolve a link against, so the action is left out rather than faked.
describe("buildTagCopyActions without a window (SSR)", () => {
  test("omits Copy link and keeps every other action", () => {
    expect(typeof window).toBe("undefined");
    const actions = buildTagCopyActions("ocx.sh/kitware/cmake", "3.31.7", [
      { label: "Add", command: "ocx add {name}", icon: "project" },
    ]);
    expect(actions.map((a) => a.label)).toEqual(["Copy identifier", "Copy tag", "Add"]);
  });
});
