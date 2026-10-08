/**
 * C-020 / C-031 — `docsView`: sidebar groups by directory, pages ordered by
 * frontmatter `order` then title, hrefs at `<base>docs/<slug>/` (`<base>docs/` for the root index).
 */
import { describe, expect, it } from "vitest";
import { docsView, type DocsSource } from "../../../src/site/model/docs.js";

/** A page whose collection id is its slug; `index` pages are built with `indexPage`. */
const page = (slug: string, title: string, order?: number): DocsSource =>
  order === undefined ? { slug, id: slug, title } : { slug, id: slug, title, order };

/** `index.md` (slug `""`) or `<dir>/index.md` (slug `<dir>`). */
const indexPage = (directory: string, title: string, order?: number): DocsSource => ({
  slug: directory,
  id: directory === "" ? "index" : `${directory}/index`,
  title,
  ...(order === undefined ? {} : { order }),
});

describe("docsView", () => {
  it("is empty for no sources", () => {
    expect(docsView([], "/")).toEqual({ groups: [], pages: [] });
  });

  it("groups by directory: root pages first, then directories by name", () => {
    const view = docsView(
      [
        page("reference/cli", "CLI reference", 1),
        page("guide/install", "Installing", 2),
        page("about", "About"),
        page("guide/start", "Start", 1),
      ],
      "/",
    );
    expect(view.groups.map((group) => group.label)).toEqual(["", "guide", "reference"]);
    expect(view.groups[1]?.pages.map((p) => p.slug)).toEqual(["guide/start", "guide/install"]);
  });

  it("keys nested directories by their full path", () => {
    const view = docsView([page("a/b/deep", "Deep"), page("a/top", "Top")], "/");
    expect(view.groups.map((group) => group.label)).toEqual(["a", "a/b"]);
  });

  it("orders by frontmatter order, then title; a missing order sorts after every ordered page", () => {
    const view = docsView(
      [page("g/z", "Zeta", 1), page("g/none", "Alpha"), page("g/a", "Beta", 1), page("g/first", "Omega", 0)],
      "/",
    );
    expect(view.groups[0]?.pages.map((p) => p.slug)).toEqual(["g/first", "g/a", "g/z", "g/none"]);
  });

  it("orders titles case-insensitively and breaks a full tie by slug", () => {
    const view = docsView([page("g/b", "same", 1), page("g/a", "Same", 1), page("g/c", "apple", 1)], "/");
    expect(view.groups[0]?.pages.map((p) => p.slug)).toEqual(["g/c", "g/a", "g/b"]);
  });

  it("lists pages, with slug and collection id, in sidebar order", () => {
    const view = docsView([page("z", "Z"), page("g/a", "A"), page("a", "A")], "/");
    expect(view.pages.map(({ slug, id }) => [slug, id])).toEqual([
      ["a", "a"],
      ["z", "z"],
      ["g/a", "g/a"],
    ]);
  });

  it("serves the docs-root index at <base>docs/ and puts it in the root group", () => {
    const view = docsView([page("about", "About", 2), indexPage("", "Documentation", 1)], "/catalog/");
    expect(view.groups.map((group) => group.label)).toEqual([""]);
    expect(view.groups[0]?.pages.map((p) => [p.title, p.slug, p.id, p.href])).toEqual([
      ["Documentation", "", "index", "/catalog/docs/"],
      ["About", "about", "about", "/catalog/docs/about/"],
    ]);
  });

  it("serves a section index at <base>docs/<dir>/ and puts it in that section's group", () => {
    const view = docsView([page("guide/install", "Install", 2), indexPage("guide", "Guide overview", 1)], "/");
    expect(view.groups.map((group) => group.label)).toEqual(["guide"]);
    expect(view.groups[0]?.pages.map((p) => [p.title, p.slug, p.id, p.href])).toEqual([
      ["Guide overview", "guide", "guide/index", "/docs/guide/"],
      ["Install", "guide/install", "guide/install", "/docs/guide/install/"],
    ]);
    expect(view.pages.map((p) => p.slug)).toEqual(["guide", "guide/install"]);
  });

  it("groups a nested section index by its directory", () => {
    const view = docsView([indexPage("a/b", "B"), page("a/top", "Top")], "/");
    expect(view.groups.map((group) => [group.label, group.pages.map((p) => p.href)])).toEqual([
      ["a", ["/docs/a/top/"]],
      ["a/b", ["/docs/a/b/"]],
    ]);
  });

  it("joins every href onto base at <base>docs/<slug>/", () => {
    expect(docsView([page("guide/start", "Start")], "/").groups[0]?.pages[0]?.href).toBe("/docs/guide/start/");
    expect(docsView([page("guide/start", "Start")], "/catalog/").groups[0]?.pages[0]?.href).toBe(
      "/catalog/docs/guide/start/",
    );
  });

  it("is deterministic across input order and does not mutate its input", () => {
    const sources = [page("b/x", "X", 2), page("a/y", "Y", 1), page("a/z", "Z")];
    const before = JSON.stringify(sources);
    const forward = JSON.stringify(docsView(sources, "/"));
    expect(JSON.stringify(sources)).toBe(before);
    expect(JSON.stringify(docsView([...sources].reverse(), "/"))).toBe(forward);
  });
});
