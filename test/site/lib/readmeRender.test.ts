import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createReadmeRenderer } from "../../../src/site/lib/readmeRender.js";
import type { ReadmeSanitizer } from "../../../src/site/lib/readmeSanitizer.js";
import { MAX_CAS_ASSET_BYTES } from "../../../src/sources/mirror.js";

const INDEX_B = fileURLToPath(new URL("../../fixtures/site/index-b", import.meta.url));
const HOSTILE_README = "/p/hostile/readme/o/sha256/73bf7621173355e68eb275a065cd44c95fcb7307e479bbba03fa43b2a2963443.md";
const SRC_SITE = fileURLToPath(new URL("../../../src/site", import.meta.url));

const tmp: string[] = [];
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "readme-render-"));
  tmp.push(dir);
  return dir;
}
async function publicWith(files: Record<string, string>): Promise<string> {
  const dir = await scratch();
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(dir, path, ".."), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  return dir;
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tmp.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

// A sanitizer double: identity unless told otherwise. Cast is the point — the
// real branded type is exercised by the jsdom-backed tests.
const identity = (html: string): ReadmeSanitizer["sanitize"] extends (h: string) => infer R ? R : never => html as never;

describe("ok", () => {
  test("the hostile fixture README renders inert with the default jsdom sanitizer", async () => {
    const warn = vi.fn();
    const renderer = createReadmeRenderer({ publicDir: INDEX_B, warn });
    const result = await renderer.render("index-b/hostile/readme", HOSTILE_README);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.html).not.toMatch(/<script|<svg|<math|<style|<iframe|<img[^>]*onerror/i);
    expect(result.html).not.toMatch(/<[a-z][^>]*\son[a-z]+\s*=/i);
    expect(result.html).not.toMatch(/href="(?:javascript|data|\/|\.)/i);
    // S-020: a README link `//x`, `/x` or `./x` becomes its text.
    expect(result.html).toContain("<p>protocol-relative</p>");
    expect(result.html).toContain("<p>root-relative</p>");
    expect(result.html).toContain("<p>dot-relative</p>");
    expect(result.html).toContain('<a href="https://example.com/ok" rel="noopener noreferrer nofollow ugc">fine link</a>');
    expect(warn).not.toHaveBeenCalled();
  });

  test("highlight.js classes survive; an unlabelled fence is plain escaped text", async () => {
    const publicDir = await publicWith({
      "p/a/b/o/sha256/x.md": "```js\nconst x = 1;\n```\n\n```\n<b>plain</b>\n```\n",
    });
    const result = await createReadmeRenderer({ publicDir }).render("a/b", "/p/a/b/o/sha256/x.md");
    expect(result).toMatchObject({ kind: "ok" });
    const html = (result as { html: string }).html;
    expect(html).toContain('<span class="hljs-keyword">const</span>');
    expect(html).toContain('<pre><code>&lt;b&gt;plain&lt;/b&gt;');
  });

  test("a README exactly at the mirror cap renders", async () => {
    const publicDir = await publicWith({ "p/a/b/o/sha256/x.md": "x".repeat(MAX_CAS_ASSET_BYTES) });
    const result = await createReadmeRenderer({ publicDir }).render("a/b", "/p/a/b/o/sha256/x.md");
    expect(result.kind).toBe("ok");
  });

  test("the sanitizer is created once and reused across READMEs", async () => {
    const publicDir = await publicWith({ "p/a/b/o/sha256/x.md": "hi" });
    const sanitize = vi.fn(identity);
    const renderer = createReadmeRenderer({ publicDir, sanitizer: { sanitize } });
    await renderer.render("a/b", "/p/a/b/o/sha256/x.md");
    await renderer.render("a/b", "/p/a/b/o/sha256/x.md");
    // render + tripwire, twice
    expect(sanitize).toHaveBeenCalledTimes(4);
  });
});

describe("close", () => {
  test("closes the sanitizer it was given", async () => {
    const publicDir = await publicWith({ "p/a/b/o/sha256/x.md": "hi" });
    const close = vi.fn();
    const renderer = createReadmeRenderer({ publicDir, sanitizer: { sanitize: vi.fn(identity), close } });
    await renderer.render("a/b", "/p/a/b/o/sha256/x.md");
    renderer.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("is a no-op when no README ever created the default sanitizer", async () => {
    const renderer = createReadmeRenderer({ publicDir: await scratch() });
    expect(() => renderer.close()).not.toThrow();
  });

  test("closes the default jsdom sanitizer after a render", async () => {
    const publicDir = await publicWith({ "p/a/b/o/sha256/x.md": "hi" });
    const renderer = createReadmeRenderer({ publicDir });
    await renderer.render("a/b", "/p/a/b/o/sha256/x.md");
    expect(() => renderer.close()).not.toThrow();
  });
});

describe("unavailable", () => {
  test("a package with no README is unavailable without a warning", async () => {
    const warn = vi.fn();
    const result = await createReadmeRenderer({ publicDir: await scratch(), warn }).render("a/b", null);
    expect(result).toEqual({ kind: "unavailable" });
    expect(warn).not.toHaveBeenCalled();
  });

  test("a missing file warns once, naming the package", async () => {
    const warn = vi.fn();
    const result = await createReadmeRenderer({ publicDir: await scratch(), warn }).render(
      "index-b/gone",
      "/p/gone/o/sha256/x.md",
    );
    expect(result).toEqual({ kind: "unavailable" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('"index-b/gone"');
    expect(warn.mock.calls[0][0]).toContain("ENOENT");
  });

  test("an oversize README is refused before the sanitizer ever runs", async () => {
    const publicDir = await publicWith({ "p/a/b/o/sha256/x.md": "x".repeat(MAX_CAS_ASSET_BYTES + 1) });
    const warn = vi.fn();
    const sanitize = vi.fn(identity);
    const result = await createReadmeRenderer({ publicDir, warn, sanitizer: { sanitize } }).render(
      "a/b",
      "/p/a/b/o/sha256/x.md",
    );
    expect(result).toEqual({ kind: "unavailable" });
    expect(sanitize).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('"a/b"');
    expect(warn.mock.calls[0][0]).toContain(`exceeds the ${MAX_CAS_ASSET_BYTES}-byte cap`);
  });

  test("a sanitizer that throws falls back, also for a non-Error throw", async () => {
    const publicDir = await publicWith({ "p/a/b/o/sha256/x.md": "hi" });
    for (const thrown of [new Error("boom"), "plain string"]) {
      const warn = vi.fn();
      const sanitizer = {
        sanitize: () => {
          throw thrown;
        },
      };
      const result = await createReadmeRenderer({ publicDir, warn, sanitizer }).render("a/b", "/p/a/b/o/sha256/x.md");
      expect(result).toEqual({ kind: "unavailable" });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain(thrown instanceof Error ? "boom" : "plain string");
    }
  });

  test("the idempotency tripwire: output that changes when sanitized again falls back", async () => {
    const publicDir = await publicWith({ "p/a/b/o/sha256/x.md": "hi" });
    const warn = vi.fn();
    let calls = 0;
    const sanitizer = { sanitize: () => `<p>${calls++}</p>` as never };
    const result = await createReadmeRenderer({ publicDir, warn, sanitizer }).render("a/b", "/p/a/b/o/sha256/x.md");
    expect(result).toEqual({ kind: "unavailable" });
    expect(warn.mock.calls[0][0]).toContain("not idempotent");
  });

  test("a path outside the public directory is refused, lexically and via a symlink", async () => {
    const parent = await scratch();
    const publicDir = join(parent, "public");
    await mkdir(publicDir);
    await writeFile(join(parent, "outside.md"), "secret");
    await symlink(join(parent, "outside.md"), join(publicDir, "link.md"));
    for (const url of ["/../outside.md", "/link.md"]) {
      const warn = vi.fn();
      const result = await createReadmeRenderer({ publicDir, warn }).render("a/b", url);
      expect(result).toEqual({ kind: "unavailable" });
      expect(warn.mock.calls[0][0]).toContain("escapes the mirrored public directory");
    }
  });

  test("the package name is quoted in the warning so a hostile name cannot forge log lines", async () => {
    const warn = vi.fn();
    await createReadmeRenderer({ publicDir: await scratch(), warn }).render("evil\nocx-catalog: forged", "/p/x.md");
    expect(warn.mock.calls[0][0]).not.toContain("\n");
  });

  test("by default the warning goes to stderr as one ocx-catalog line", async () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await createReadmeRenderer({ publicDir: await scratch() }).render("a/b", "/p/x.md");
    expect(write).toHaveBeenCalledTimes(1);
    expect(String(write.mock.calls[0][0])).toMatch(/^ocx-catalog: README for "a\/b" unavailable: .*\n$/);
  });
});

// C-014: the README sink. `set:html` is Astro-template syntax, so scanning the
// template files is exhaustive; `ReadmePane.astro` (T.4) is its one home.
async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await files(path)));
    else out.push(path);
  }
  return out;
}

/** Violations of the sink contract under `root` (a copy of `src/site`'s shape). */
async function sinkViolations(root: string): Promise<string[]> {
  const violations: string[] = [];
  for (const file of await files(root)) {
    const rel = file.slice(root.length + 1);
    const text = await readFile(file, "utf8");
    if (/\.(?:astro|vue)$/.test(file)) {
      const uses = text.match(/set:html|v-html/g) ?? [];
      if (rel === join("components", "ReadmePane.astro")) {
        if (uses.length > 1) violations.push(`${rel}: ${uses.length} uses, expected at most one`);
        if (uses.length === 1 && !/set:html=\{[^}]+\}/.test(text)) violations.push(`${rel}: set:html is not on an expression`);
        if (uses.length === 1 && !text.includes("SanitizedHtml")) violations.push(`${rel}: set:html without a SanitizedHtml`);
      } else if (uses.length > 0) {
        violations.push(`${rel}: ${uses[0]}`);
      }
    }
    if (/\.ts$/.test(file) && /brandSanitized\(/.test(text) && !/^lib\/(?:sanitizedHtml|readmeSanitizer)\.ts$/.test(rel)) {
      violations.push(`${rel}: brandSanitized() minted outside the sanitizer`);
    }
  }
  return violations;
}

describe("the set:html sink contract", () => {
  test("src/site has no violation (zero or one set:html, in ReadmePane.astro only)", async () => {
    expect(await sinkViolations(SRC_SITE)).toEqual([]);
  });

  test("planted violations are caught, a conforming ReadmePane is not", async () => {
    const root = await scratch();
    await mkdir(join(root, "components"));
    await mkdir(join(root, "lib"));
    const pane = join(root, "components", "ReadmePane.astro");

    await writeFile(pane, "---\nimport type { SanitizedHtml } from '../lib/sanitizedHtml.js';\n---\n<div set:html={html} />");
    expect(await sinkViolations(root)).toEqual([]);

    await writeFile(join(root, "components", "Evil.astro"), "<div set:html={x} />");
    await writeFile(join(root, "components", "Old.vue"), '<div v-html="x" />');
    await writeFile(join(root, "lib", "mint.ts"), "export const x = brandSanitized(y);");
    expect(await sinkViolations(root)).toEqual([
      expect.stringContaining("Evil.astro"),
      expect.stringContaining("Old.vue"),
      expect.stringContaining("mint.ts"),
    ]);
    await rm(join(root, "components", "Evil.astro"));
    await rm(join(root, "components", "Old.vue"));
    await rm(join(root, "lib", "mint.ts"));

    await writeFile(pane, "---\n---\n<div set:html={html} /><div set:html={html} />");
    expect(await sinkViolations(root)).toEqual([expect.stringContaining("2 uses")]);
    await writeFile(pane, "---\nimport type { SanitizedHtml } from 'x';\n---\n<div set:html=\"<b>raw</b>\" />");
    expect(await sinkViolations(root)).toEqual([expect.stringContaining("not on an expression")]);
    await writeFile(pane, "<div set:html={html} />");
    expect(await sinkViolations(root)).toEqual([expect.stringContaining("without a SanitizedHtml")]);
  });
});
