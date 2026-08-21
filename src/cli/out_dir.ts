import { relative, resolve, sep } from "node:path";

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
 * @throws {Error} if `outDir` is unsafe relative to `scratchRoot`
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
    throw new Error(
      `unsafe output directory: "${outDir}" (resolved "${resolvedOut}") is ` +
        `not safe relative to scratch root "${scratchRoot}" (resolved "${resolvedRoot}")`,
    );
  }
}
