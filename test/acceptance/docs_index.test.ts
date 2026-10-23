/**
 * D-174 through a shipped entrypoint (`ocx-catalog build`): a site with a docs mount ships
 * `data/catalog/docs-index.json` and flags it on the palette wrapper (`data-docs`); a site without
 * one ships neither, so the palette never asks for a file that does not exist.
 *
 * Needs the `root` (docs), `rootbase` (docs under `/catalog/`) and `catalog` (no docs) sites:
 * `ACCEPT_CONFIG=root,rootbase,catalog`.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { listTree, readHtml, site } from "./helpers.js";

it("D-174 a docs mount ships the docs index and flags it on the palette wrapper", async () => {
  const index = JSON.parse(await readFile(join(site("root"), "data/catalog/docs-index.json"), "utf8")) as {
    id: string;
    href: string;
    title: string;
    headings: string[];
    text: string;
  }[];
  expect(index.length).toBeGreaterThan(0);
  for (const entry of index) {
    expect(entry.title).toBeTruthy();
    expect(typeof entry.text).toBe("string");
  }
  expect(index.map((entry) => entry.href)).toContain("/docs/guide/getting-started/");

  const doc = await readHtml(site("root"), "/");
  expect(doc.querySelector<HTMLElement>(".ocx-palette")?.hasAttribute("data-docs")).toBe(true);
});

it("D-174 a site without a docs mount ships no docs index and no data-docs flag", async () => {
  expect(await listTree(site("catalog"))).not.toContain("data/catalog/docs-index.json");

  const doc = await readHtml(site("catalog"), "/");
  expect(doc.querySelector<HTMLElement>(".ocx-palette")?.hasAttribute("data-docs")).toBe(false);
});

it("D-174 the index links are final: joined onto the site base at build time", async () => {
  const index = JSON.parse(await readFile(join(site("rootbase"), "data/catalog/docs-index.json"), "utf8")) as { href: string }[];

  expect(index.length).toBeGreaterThan(0);
  expect(index.every((entry) => entry.href.startsWith("/catalog/docs/"))).toBe(true);
});
