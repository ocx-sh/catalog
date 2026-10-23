import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { ConfigError } from "../config/errors.js";
import type { LoadedConfig } from "../config/types.js";

/**
 * Guards against a build/dev output directory that would clobber the scratch
 * root it renders from. Throws if `outDir` equals `scratchRoot`, is an
 * ancestor of it (which would delete or shadow the source tree on write), or
 * is a descendant of it (the scratch root is a self-sweeping `mkdtemp` —
 * output written inside it would be deleted at cleanup) — both resolved to
 * absolute, normalized paths before comparison. Comparison is path-segment
 * based, never a string prefix (`/tmp/scratch` vs `/tmp/scratch2` is fine).
 *
 * @param scratchRoot - absolute path to the source/scratch tree being rendered
 * @param outDir - absolute or relative path to the intended output directory
 * @throws {ConfigError} `OUT_DIR_OVERLAPS_INPUT` if `outDir` is unsafe relative to `scratchRoot`
 */
export function assertOutDirSafe(scratchRoot: string, outDir: string): void {
  const resolvedRoot = resolve(scratchRoot);
  const resolvedOut = resolve(outDir);
  const rel = relative(resolvedRoot, resolvedOut);
  const segments = rel === "" ? [] : rel.split(sep);
  const isSame = segments.length === 0;
  const isAncestor = segments.length > 0 && segments.every((segment) => segment === "..");
  const isDescendant = segments.length > 0 && !segments.includes("..");
  if (isSame || isAncestor || isDescendant) {
    throw new ConfigError(
      "OUT_DIR_OVERLAPS_INPUT",
      `unsafe output directory: "${outDir}" (resolved "${resolvedOut}") is ` +
        `not safe relative to scratch root "${scratchRoot}" (resolved "${resolvedRoot}")`,
    );
  }
}

/**
 * `realpath` that tolerates a path that does not exist yet: resolves the
 * deepest existing ancestor and re-appends the missing tail. This is what
 * makes a not-yet-created `--out` comparable, and a symlinked one honest.
 */
export async function resolveReal(path: string): Promise<string> {
  const absolute = resolve(path);
  try {
    return await realpath(absolute);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") throw err;
    return join(await resolveReal(dirname(absolute)), basename(absolute));
  }
}

/** True when `inner` is `outer` or lies beneath it (path segments, not a string prefix). */
const isWithin = (outer: string, inner: string): boolean => {
  const rel = relative(outer, inner);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
};

/**
 * C-036: refuses an output directory that would overwrite or hide an input.
 * `outDir` (already real, see `resolveReal`) must not equal or contain the
 * config directory, a `path` source root, `docs`, `css`, `publicDir` or the
 * `brand.logo` file, and must not lie inside `docs` or `publicDir`. Every
 * input is realpath'd too, so a symlinked input cannot hide an overlap.
 *
 * @throws {ConfigError} `OUT_DIR_OVERLAPS_INPUT`, naming both paths
 */
export async function assertOutDirOutsideInputs(outDir: string, loaded: LoadedConfig): Promise<void> {
  const { config, configDir } = loaded;
  const at = (rel: string | undefined): string | undefined => (rel === undefined ? undefined : join(configDir, rel));
  const named: [string, string | undefined][] = [
    ["the config directory", configDir],
    ...loaded.sources.map((source, i): [string, string | undefined] => [`sources[${i}]`, at(source.entry.path)]),
    ["docs", at(config.docs)],
    ["css", at(config.css)],
    ["publicDir", at(config.publicDir)],
    ["brand.logo", at(config.brand?.logo)],
  ];
  const containers = new Set(["docs", "publicDir"]);
  for (const [name, input] of named) {
    if (input === undefined) continue;
    const real = await resolveReal(input);
    const overlaps = isWithin(outDir, real) || (containers.has(name) && isWithin(real, outDir));
    if (overlaps) {
      throw new ConfigError(
        "OUT_DIR_OVERLAPS_INPUT",
        `output directory "${outDir}" overlaps ${name} ("${real}"): it would overwrite or hide the input`,
      );
    }
  }
}
