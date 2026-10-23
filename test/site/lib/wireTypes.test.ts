import { describe, expect, test } from "vitest";
import { ownerLogin } from "../../../src/site/lib/wireTypes.js";

describe("ownerLogin", () => {
  // ocx-indexbot 0.5.0 renamed `owners[].github` to `login` because the old
  // name claimed a forge the index may not be hosted on (see that project's
  // adr_forge_neutral_owners.md). Both spellings reach this renderer: a root
  // published before 0.5.0 carries only the legacy one, and one written since
  // carries both, derived and therefore always equal.
  test("prefers the canonical login", () => {
    expect(ownerLogin({ login: "alice", id: 1, github: "alice", github_id: 1 })).toBe("alice");
  });

  test("falls back to the pre-0.5.0 spelling", () => {
    expect(ownerLogin({ github: "alice", github_id: 1 })).toBe("alice");
  });

  test("is undefined when the root names neither", () => {
    expect(ownerLogin({})).toBeUndefined();
  });
});
