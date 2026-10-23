/**
 * The support-matrix dialog's rows (`data/catalog/support/<route key>.json`): every wire tag with the
 * platforms it ships for and its ephemeral and yank marks, newest first, and the package's deprecation. The dialog fetches its package's file on
 * first open, so the detail page carries no tag rows (D-149, C-017). Written per package that lists a
 * platform at all (the others render no dialog); `catalog.json` is untouched.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { supportPath, type SupportData } from "../site/lib/supportWire.js";
import { compareVersions, parseTag } from "../site/lib/versionTable.js";
import type { DetailView } from "../site/model/detail.js";

/** `latest`, then tags that are no version (aliases), lead; versions follow newest first. */
const lead = (tag: string): number => ({ latest: 0, other: 1, version: 2 })[parseTag(tag).kind];
const newestFirst = ([a]: readonly [string, number], [b]: readonly [string, number]): number => {
  const [pa, pb] = [parseTag(a), parseTag(b)];
  if (pa.kind === "version" && pb.kind === "version") return compareVersions(pb.version, pa.version);
  return lead(a) - lead(b) || a.localeCompare(b);
};

/** The dialog's rows for one package; `null` when no tag lists a platform (no dialog is rendered). */
export function supportData(view: DetailView): SupportData | null {
  if (view.platformSets.every((set) => set.length === 0)) return null;
  const ephemeral = new Set(view.ephemeralTags);
  const yanked = new Map(view.yankedTags);
  const rows = [...view.tagReleases].sort(newestFirst).map(([tag, release]) => ({
    tag,
    platforms: view.platformSets[view.releases[release]?.platformSet ?? -1] ?? [],
    ephemeral: ephemeral.has(tag),
    yanked: yanked.get(tag) ?? null,
  }));
  return { rows, deprecated: view.status === "deprecated" ? { message: view.deprecatedMessage } : null };
}

/** Writes one file per package that has a dialog, under `publicDir`. */
export async function writeSupportMatrices(publicDir: string, details: Readonly<Record<string, DetailView>>): Promise<void> {
  for (const [key, view] of Object.entries(details)) {
    const data = supportData(view);
    if (data === null) continue;
    const path = join(publicDir, supportPath(key));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(data), "utf8");
  }
}
