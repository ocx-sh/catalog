import { readImageIndexAnnotations } from "../../viewmodel/catalog.js";
import { visiblePlatforms } from "./platforms.js";

/** The facts of one image index: what a tag shows in the Platforms card and the metadata rows. */
export interface ReleaseFacts {
  readonly platforms: readonly string[];
  readonly license: string | null;
  /** Untrusted text. */
  readonly source: string | null;
  readonly revision: string | null;
}

export const NO_FACTS: ReleaseFacts = { platforms: [], license: null, source: null, revision: null };

/**
 * The facts of one already-parsed image index, read the same way at build time (the prerendered tags) and in
 * the browser (a tag the page did not prerender). Anything unusual costs that tag its facts, never the page:
 * a hover preview is decoration (D-062).
 */
export function imageIndexFacts(index: unknown, digest: string): ReleaseFacts {
  // `null`, a number or a list is no image index.
  if (typeof index !== "object" || index === null || Array.isArray(index)) return NO_FACTS;
  const { manifests, annotations: wireAnnotations } = index as Record<string, unknown>;
  const platforms = visiblePlatforms(manifests)
    .filter(({ platform }) => typeof platform.os === "string" && typeof platform.architecture === "string")
    .map(({ platform }) => `${platform.os}/${platform.architecture}`);
  let annotations: ReturnType<typeof readImageIndexAnnotations>;
  try {
    annotations = readImageIndexAnnotations({ annotations: wireAnnotations }, digest);
  } catch {
    annotations = {};
  }
  return {
    platforms: [...new Set(platforms)].sort(),
    license: annotations.license ?? null,
    source: annotations.sourceRepository ?? null,
    revision: annotations.revision ?? null,
  };
}
