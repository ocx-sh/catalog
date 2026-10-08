/**
 * C-018 under `src/site/**`: `DEFAULT_INSTALL_FLAVORS` is the only place an
 * `ocx …` install command is spelled. Every other module (the detail page's
 * install card, the copy menu, the landing cards) takes its commands from it,
 * so a drifted second list is a failure here, not a review catch.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const LITERAL = /\bocx\s+(?:--global\s+)?(?:add|install|exec|package|run|pull)\b/;
const HOME = "src/site/lib/installFlavors.ts";

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );

function literalViolations(files: ReadonlyMap<string, string>): string[] {
  return [...files].filter(([path, text]) => path !== HOME && LITERAL.test(text)).map(([path]) => path);
}

describe("C-018 the install command literals live in installFlavors.ts only", () => {
  it("flags a component that spells a command (planted violation)", () => {
    const planted = new Map([
      [HOME, "{ command: 'ocx add {name}' }"],
      ["src/site/components/InstallCard.astro", "<code>ocx package install {name}</code>"],
      ["src/site/components/Other.astro", "<code>ocx --global add x</code>"],
      ["src/site/lib/clean.ts", "export const x = installCommand(flavor.command, name);"],
    ]);
    expect(literalViolations(planted)).toEqual([
      "src/site/components/InstallCard.astro",
      "src/site/components/Other.astro",
    ]);
  });

  it("finds no command literal outside installFlavors.ts in src/site", () => {
    const files = new Map(walk(join(ROOT, "src/site")).map((path) => [relative(ROOT, path), readFileSync(path, "utf8")]));
    expect(files.has(HOME)).toBe(true);
    expect(literalViolations(files)).toEqual([]);
  });
});
