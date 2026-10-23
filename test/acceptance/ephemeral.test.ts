/**
 * Ephemeral tags on the built detail page: a wire `ephemeral: true` marks the
 * tag's chip and its support-matrix row; `"true"` and `false` (strict-true
 * reading, ocx `wire.rs`) stay durable. One real CLI build over the committed
 * `test/fixtures/ephemeral-index`, scripts off.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REPO_ROOT, readHtml, runBuild } from "./helpers.js";

let out = "";
let document: Document;
let builds: Document;

beforeAll(async () => {
  out = await mkdtemp(join(tmpdir(), "ocx-ephemeral-"));
  const result = await runBuild(join(REPO_ROOT, "test/fixtures/ephemeral-index/catalog.config.json"), out);
  expect(result.code, result.stderr).toBe(0);
  document = await readHtml(out, "/acme/nightly/");
  builds = await readHtml(out, "/acme/builds/");
}, 120_000);
afterAll(() => rm(out, { recursive: true, force: true }));

// Any chip of the tag: a track's newest build is its head chip, the older ones are patch chips.
const chip = (tag: string): Element | null => document.querySelector(`[data-versions-list] [data-tag="${tag}"]`);

describe("ephemeral tags on the detail page", () => {
  it("marks only tags whose wire value is JSON true, with the reason as the tooltip", () => {
    for (const tag of ["1.3.0-snapshot_20261020", "1.3.0-snapshot_20261019", "1.3.0-snapshot_20261018"]) {
      expect(chip(tag)?.hasAttribute("data-ephemeral"), tag).toBe(true);
      expect(chip(tag)?.getAttribute("title")).toContain("may be pruned from the registry");
    }
    for (const tag of ["1.3.0-snapshot_20261017", "1.3.0-snapshot_20261016"]) {
      expect(chip(tag)?.hasAttribute("data-ephemeral"), tag).toBe(false);
    }
  });

  it("flags the same tags in the support matrix's rows; the dialog has no Note column", async () => {
    expect(document.querySelector("[data-support-matrix] thead th[data-matrix-note]")).toBeNull();
    expect(document.querySelector('[data-support-matrix] template[data-matrix-flags]')?.innerHTML).toContain('data-flag="deprecated"');
    const { rows } = JSON.parse(await readFile(join(out, "data/catalog/support/acme/nightly.json"), "utf8")) as { rows: { tag: string; ephemeral: boolean }[] };
    const flagged = (tag: string): boolean | string => rows.find((row) => row.tag === tag)?.ephemeral ?? "missing";
    expect(flagged("1.3.0-snapshot_20261020")).toBe(true);
    expect(flagged("1.3.0-snapshot_20261017")).toBe(false);
    expect(flagged("1.2.0")).toBe(false);
  });
});

describe("latest on the detail page (acme/builds)", () => {
  it("shows the durable version the latest tag resolves to, never the ephemeral 2.2.1", () => {
    expect(builds.querySelector("[data-latest]")?.textContent?.trim()).toBe("latest 2.2.0");
    expect(builds.querySelector('[data-row="latest"] [data-field="latest"]')?.textContent?.trim()).toBe("2.2.0");
  });
});

describe("tracks of pre-releases and builds on the detail page (acme/builds)", () => {
  const track = (key: string): Element | undefined =>
    [...builds.querySelectorAll("[data-tracks] [data-minor]")].find((line) => line.querySelector("[data-kicker]")?.textContent === key);
  const head = (key: string): Element | null => track(key)?.querySelector("[data-head] [data-tag]") ?? null;

  it("draws one line per track, most recently active first, apart from the stable tree", () => {
    const keys = [...builds.querySelectorAll("[data-tracks] [data-kicker]")].map((el) => el.textContent);
    expect(keys).toEqual(["mr13", "canary", "mr11", "mr12", "3.0.0-rc", "snapshot", "3.0.0-beta"]);
    expect(builds.querySelector("[data-tracks] .variant-label")?.textContent).toContain("pre-releases");
    expect(builds.querySelector('[data-major-groups] [data-tag^="mr"], [data-major-groups] [data-tag^="3.0.0"]')).toBeNull();
  });

  it("headlines each track's newest build and folds the older ones into the patch panel", () => {
    // The newest mr11 build is yanked, so the head falls back to the newest build still installable.
    expect(head("mr11")?.getAttribute("data-tag")).toBe("mr11_20261021T090000Z");
    expect(track("mr11")?.querySelector("[data-count]")?.textContent).toBe("+2");
    expect([...track("mr11")!.querySelectorAll("[data-patch-list] [data-tag]")].map((el) => el.getAttribute("data-tag"))).toEqual([
      "mr11_20261021T153000Z",
      "mr11_20261020T101500Z",
    ]);
    expect(head("3.0.0-rc")?.getAttribute("data-tag")).toBe("3.0.0-rc.2");
  });

  it("marks every build pre-release, and ephemeral only where the wire says so", () => {
    for (const key of ["mr11", "canary", "3.0.0-rc"]) expect(head(key)?.hasAttribute("data-prerelease"), key).toBe(true);
    expect(head("mr11")?.hasAttribute("data-ephemeral")).toBe(true);
    expect(head("3.0.0-rc")?.hasAttribute("data-ephemeral")).toBe(true);
    expect(track("3.0.0-rc")?.querySelector("[data-patch-list] [data-tag=\"3.0.0-rc.1\"]")?.hasAttribute("data-ephemeral")).toBe(false);
    expect(head("mr11")?.getAttribute("title")).toContain("Pre-release: not a stable version");
  });

  it("keeps the install card's pin choices on stable tags", () => {
    const template = builds.querySelector<HTMLTemplateElement>("template[data-install-options]")!;
    const options = [...template.content.querySelectorAll("option")].map((option) => option.getAttribute("value"));
    // The levels of the version latest resolves to; the ephemeral 2.2.1 beside it is not offered as a pin.
    expect(options).toEqual(["latest", "2", "2.2", "2.2.0"]);
  });
});
