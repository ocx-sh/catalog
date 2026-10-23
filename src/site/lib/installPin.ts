/**
 * The install card's version pick (D-058, D-059, D-171): which tag of a
 * variant's alias chain the commands name, and the stored preference that
 * reapplies it. The preference is a LEVEL (`major`, `pinned`, ...), never a
 * tag: tags are package-specific, a level carries over to the next package.
 * Restored from 0.5.3's `MetaRail.vue`.
 */
import { parseTag } from "./versionTable.js";

export type PinLevel = "latest" | "rolling" | "major" | "minor" | "patch" | "pinned";

/** `localStorage` key, kept from 0.5.3 so a stored choice survives the upgrade. */
export const PIN_KEY = "ocx-install-pin";

export const LEVEL_RANK: Readonly<Record<PinLevel, number>> = {
  latest: 0,
  rolling: 0,
  major: 1,
  minor: 2,
  patch: 3,
  pinned: 4,
};

export interface PinOption {
  readonly tag: string;
  /** Real depth: preference matching works on this. */
  readonly rank: number;
  /** What the select shows: the deepest option always reads `pinned`. */
  readonly label: PinLevel;
}

export function isPinLevel(value: unknown): value is PinLevel {
  return typeof value === "string" && Object.hasOwn(LEVEL_RANK, value);
}

/** Granularity of one alias-chain tag, from the tag itself. */
export function tagLevel(tag: string): PinLevel {
  const parsed = parseTag(tag);
  if (parsed.kind === "latest") return "latest";
  if (parsed.kind === "other") return "rolling";
  const { minor, patch, prerelease, build } = parsed.version;
  if (minor === null) return "major";
  if (patch === null) return "minor";
  return prerelease === null && build === null ? "patch" : "pinned";
}

/** The select options for an alias chain; the deepest (last of equals) is relabelled `pinned`. */
export function pinOptions(chain: readonly { readonly tag: string }[]): PinOption[] {
  const options = chain.map(({ tag }) => {
    const label = tagLevel(tag);
    return { tag, rank: LEVEL_RANK[label], label };
  });
  const deepest = options.reduce<PinOption | null>((best, option) => (best === null || option.rank >= best.rank ? option : best), null);
  return options.map((option) => (option === deepest ? { ...option, label: "pinned" } : option));
}

/**
 * The option nearest the preferred level; a tie resolves to the deeper one (a
 * `pinned` preference on a chain ending at patch still lands on that tag).
 * `null` for an empty chain.
 */
export function pickPinned(options: readonly PinOption[], preference: PinLevel): PinOption | null {
  const target = LEVEL_RANK[preference];
  return [...options].sort((a, b) => Math.abs(a.rank - target) - Math.abs(b.rank - target) || b.rank - a.rank)[0] ?? null;
}

/** What the commands operate on: the bare name tracks `latest`, anything else is `name:tag`. */
export function installTarget(name: string, tag: string): string;
export function installTarget(name: string, tag: string | null): string | null;
export function installTarget(name: string, tag: string | null): string | null {
  if (tag === null) return null;
  return tag === "latest" ? name : `${name}:${tag}`;
}

export type PinStorage = Pick<Storage, "getItem" | "setItem">;

/** The browser's `localStorage`, `null` where reading the property throws (storage blocked). */
export function browserStorage(): PinStorage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/** The stored level, `latest` for none, an unknown value or storage that throws. */
export function readPin(storage: PinStorage | null): PinLevel {
  try {
    const stored = storage?.getItem(PIN_KEY);
    return isPinLevel(stored) ? stored : "latest";
  } catch {
    return "latest";
  }
}

/** Stores `level`; a throwing or absent storage is a no-op, the pick still applies to this visit. */
export function writePin(storage: PinStorage | null, level: PinLevel): void {
  try {
    storage?.setItem(PIN_KEY, level);
  } catch {
    // The choice lasts this visit only.
  }
}
