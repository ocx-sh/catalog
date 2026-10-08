import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReadmeRenderer } from "../../src/site/lib/readmeRender.js";
import type { SiteModel } from "../../src/site/model/index.js";

// `renderReadmes` builds its renderer internally; wrap the real factory so the
// test can observe `close` on the instance the build actually used.
const renderers: ReadmeRenderer[] = [];
vi.mock("../../src/site/lib/readmeRender.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/site/lib/readmeRender.js")>();
  return {
    ...actual,
    createReadmeRenderer: (...args: Parameters<typeof actual.createReadmeRenderer>) => {
      const renderer = actual.createReadmeRenderer(...args);
      vi.spyOn(renderer, "close");
      renderers.push(renderer);
      return renderer;
    },
  };
});

const { renderReadmes } = await import("../../src/build/readmes.js");

const cleanup: string[] = [];
afterEach(async () => {
  renderers.length = 0;
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "readmes-close-"));
  cleanup.push(dir);
  return dir;
}

describe("renderReadmes closes its renderer", () => {
  it("after a normal run", async () => {
    const model = { routes: ["a/b"], readme: { "a/b": null }, details: {} } as unknown as SiteModel;
    await renderReadmes(await scratch(), await scratch(), model);
    expect(renderers).toHaveLength(1);
    expect(renderers[0]?.close).toHaveBeenCalledTimes(1);
  });

  it("also when the loop throws", async () => {
    const model = {
      routes: ["a/b"],
      readme: {},
      get details(): never {
        throw new Error("model fault");
      },
    } as unknown as SiteModel;
    await expect(renderReadmes(await scratch(), await scratch(), model)).rejects.toThrow("model fault");
    expect(renderers[0]?.close).toHaveBeenCalledTimes(1);
  });
});
