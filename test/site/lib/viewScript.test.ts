// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { parseCatalogUrlState } from "../../../src/site/lib/catalogState.js";
import { VIEW_SCRIPT } from "../../../src/site/lib/viewScript.js";

const run = () => new Function(VIEW_SCRIPT)();
const root = () => document.documentElement.dataset;
const at = (search: string) => history.replaceState(null, "", `/${search}`);

beforeEach(() => {
  delete root().catalogView;
  delete root().catalogWait;
  localStorage.clear();
  at("");
});
afterEach(() => vi.unstubAllGlobals());

describe("D-170 the head script hides the server cards before paint when the table view is wanted", () => {
  test("D-170 a remembered table view marks the root; no memory and no URL leaves it alone", () => {
    run();
    expect(root().catalogView).toBeUndefined();
    localStorage.setItem("ocx-catalog-view", "table");
    run();
    expect(root().catalogView).toBe("table");
  });

  test("D-170 the URL wins over the memory in both directions", () => {
    localStorage.setItem("ocx-catalog-view", "table");
    at("?view=cards");
    run();
    expect(root().catalogView).toBeUndefined();
    localStorage.clear();
    at("?view=table");
    run();
    expect(root().catalogView).toBe("table");
  });

  test("D-170 storage that throws, or a value that is not a view, leaves the cards and raises nothing", () => {
    localStorage.setItem("ocx-catalog-view", "gallery");
    expect(run).not.toThrow();
    expect(root().catalogView).toBeUndefined();
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    expect(run).not.toThrow();
    expect(root().catalogView).toBeUndefined();
  });
});

describe("C-017 the head script keeps the keyword rail undrawn while a cold URL's results are on their way", () => {
  test.each(["?q=modern", "?index=", "?index=b", "?keyword=cli", "?platform=linux", "?status=deprecated", "?status=yanked", "?status=x&status=yanked", "?status=yanked&status=x", "?sort=name&q=x", "?sort=updated", "?sort=created", "?invert=1"])(
    "C-017 %s marks the root as waiting for results",
    (search) => {
      at(search);
      run();
      expect(root().catalogWait).toBe("");
    },
  );

  test.each(["", "?q=", "?keyword=", "?platform=", "?status=other", "?status=x&status=y", "?sort=name", "?sort=bogus", "?invert=0", "?view=cards", "?utm_source=x"])(
    "C-017 %s does not: the island would never boot to clear it",
    (search) => {
      at(search);
      run();
      expect(root().catalogWait).toBeUndefined();
    },
  );

  test("C-017 blocked storage still marks a narrowing URL, and nothing else", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    at("?q=a");
    run();
    expect(root().catalogWait).toBe("");
    expect(root().catalogView).toBeUndefined();
  });

  test("C-017 every URL the script waits on is one the island boots on: the island's own parse agrees", () => {
    for (const search of ["?q=modern", "?index=", "?keyword=cli", "?platform=linux", "?status=deprecated", "?status=yanked", "?status=x&status=yanked"]) {
      const state = parseCatalogUrlState(search);
      const boots =
        state.q !== "" || state.index !== null || state.keywords.length > 0 || state.platforms.length > 0 || state.deprecated || state.yanked;
      expect(boots, search).toBe(true);
    }
  });
});

describe("the same text ships in the page", () => {
  test("D-170 CatalogGrid.astro carries exactly VIEW_SCRIPT, the text whose hash the CSP allows", () => {
    const source = readFileSync(resolve(process.cwd(), "src/site/components/CatalogGrid.astro"), "utf8");
    const inline = [...source.matchAll(/<script is:inline>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
    expect(inline).toEqual([VIEW_SCRIPT]);
  });
});
