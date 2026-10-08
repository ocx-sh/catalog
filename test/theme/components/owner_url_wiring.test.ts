// @vitest-environment happy-dom
//
// Reachability pin for `themeConfig.ownerUrl` (config `ownerUrl`). MetaRail
// used to hard-code `https://github.com/<login>`; `.vue` internals are
// coverage-excluded, so only the rendered anchor of the real component proves
// the configured template reaches the owners row. The substitution/safety
// rules themselves are unit-tested in `test/site/lib/ownerUrl.test.ts`.
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ref } from "vue";

const themeState = ref<Record<string, unknown>>({});
const frontmatterState = ref<Record<string, unknown>>({});
vi.mock("vitepress", () => ({
  useData: () => ({ theme: themeState, frontmatter: frontmatterState, isDark: ref(false) }),
}));

const MetaRail = (await import("../../../src/theme/components/detail/MetaRail.vue")).default;

function rootWithOwners(owners: Record<string, unknown>[]) {
  return {
    name: "ocx.sh/kitware/cmake",
    repository: "oci://ghcr.io/ocx-contrib/cmake",
    owners,
    status: "active" as const,
    deprecated_message: null,
    created: "2026-01-01T00:00:00Z",
    desc: null,
    tags: {},
  };
}

function ownerLinks(owners: Record<string, unknown>[]) {
  const wrapper = mount(MetaRail, {
    props: {
      root: rootWithOwners(owners),
      qualifiedName: "ocx.sh/kitware/cmake",
      primaryTag: "latest",
      latestVersionLabel: "3.31.7",
      activeImageIndex: null,
      tagCount: 1,
      table: { rows: [], unknownTags: [] },
    },
  });
  return wrapper.findAll(".metadata-value a").filter(a => a.text().startsWith("@"));
}

beforeEach(() => {
  themeState.value = {};
  frontmatterState.value = {};
});

describe("owner profile links — themeConfig.ownerUrl", () => {
  test("no ownerUrl -> the GitHub default, exactly as before the key existed", () => {
    const [link] = ownerLinks([{ login: "ocx-sh" }]);

    expect(link!.attributes("href")).toBe("https://github.com/ocx-sh");
    expect(link!.text()).toContain("@ocx-sh");
  });

  test("a GitLab template routes every owner to that forge", () => {
    themeState.value = { ownerUrl: "https://gitlab.com/{login}" };

    const links = ownerLinks([{ login: "alice" }, { login: "bob" }]);

    expect(links.map(a => a.attributes("href"))).toEqual(["https://gitlab.com/alice", "https://gitlab.com/bob"]);
  });

  test("a legacy pre-0.5.0 `github` owner key still resolves through the template", () => {
    themeState.value = { ownerUrl: "https://git.internal/people/{login}/profile" };

    const [link] = ownerLinks([{ github: "carol" }]);

    expect(link!.attributes("href")).toBe("https://git.internal/people/carol/profile");
  });

  // The login is wire data: it must not be able to add a path segment or
  // query to the template, nor be read as a `replace()` special pattern.
  test("a hostile login is encoded into the template, never spliced raw", () => {
    themeState.value = { ownerUrl: "https://gitlab.com/{login}" };

    const [link] = ownerLinks([{ login: "a/../b?x=$&" }]);

    expect(link!.attributes("href")).toBe("https://gitlab.com/a%2F..%2Fb%3Fx%3D%24%26");
  });
});

// `sources[].ownerUrl` reaches the page as `frontmatter.ownerUrl`
// (`build/pages.ts`), so each index of an aggregating catalog can link its
// owners to its own forge.
describe("owner profile links — per-source frontmatter.ownerUrl", () => {
  test("the page's source template wins over the top-level themeConfig.ownerUrl", () => {
    themeState.value = { ownerUrl: "https://github.com/{login}" };
    frontmatterState.value = { ownerUrl: "https://gitlab.corp.example/{login}" };

    const [link] = ownerLinks([{ login: "alice" }]);

    expect(link!.attributes("href")).toBe("https://gitlab.corp.example/alice");
  });

  test("a source template applies even with no top-level ownerUrl", () => {
    frontmatterState.value = { ownerUrl: "https://gitlab.com/{login}" };

    const [link] = ownerLinks([{ login: "bob" }]);

    expect(link!.attributes("href")).toBe("https://gitlab.com/bob");
  });

  test("a non-string frontmatter value is ignored, falling back to themeConfig", () => {
    themeState.value = { ownerUrl: "https://gitlab.com/{login}" };
    frontmatterState.value = { ownerUrl: 42 };

    const [link] = ownerLinks([{ login: "carol" }]);

    expect(link!.attributes("href")).toBe("https://gitlab.com/carol");
  });
});
