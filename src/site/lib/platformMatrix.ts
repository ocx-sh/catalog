/**
 * The detail page's Platforms card as data (D-061, D-072): one row per OS, one
 * column per architecture shared by every row, so an OS missing an arch leaves
 * an empty cell instead of letting its neighbours pack left. A platform-agnostic
 * tag (`any/any`) collapses to one "any platform" row that hides the specific
 * builds beside it. Restored from 0.5.3's `PlatformMatrix.vue`.
 */
import { isPlatformAgnostic, osOf, osRank } from "./platformAgnostic.js";

export interface PlatformRow {
  readonly os: string;
  readonly label: string;
  readonly arches: readonly string[];
}

export interface PlatformMatrixModel {
  /** One build for every host: the card says so and shows no rows or columns. */
  readonly agnostic: boolean;
  /** Architecture columns shared by every row: `amd64`, `arm64`, then the rest alphabetically. */
  readonly columns: readonly string[];
  readonly rows: readonly PlatformRow[];
}

const OS_LABELS: Readonly<Record<string, string>> = { linux: "Linux", darwin: "macOS", windows: "Windows" };
const ARCH_PRIORITY = ["amd64", "arm64"];

function archRank(arch: string): number {
  const index = ARCH_PRIORITY.indexOf(arch);
  return index === -1 ? ARCH_PRIORITY.length : index;
}

/** `platforms` are `os/arch` strings, already limited to real platforms. */
export function platformMatrix(platforms: readonly string[]): PlatformMatrixModel {
  if (isPlatformAgnostic(platforms)) return { agnostic: true, columns: [], rows: [] };
  const byOs = new Map<string, Set<string>>();
  for (const platform of platforms) {
    const os = osOf(platform);
    const arches = byOs.get(os) ?? new Set<string>();
    // A bare `os` carries no architecture: the row shows with empty cells.
    if (platform.length > os.length + 1) arches.add(platform.slice(os.length + 1));
    byOs.set(os, arches);
  }
  const columns = [...new Set([...byOs.values()].flatMap((arches) => [...arches]))].sort(
    (a, b) => archRank(a) - archRank(b) || a.localeCompare(b),
  );
  const rows = [...byOs]
    .map(([os, arches]) => ({ os, label: OS_LABELS[os] ?? os, arches: [...arches] }))
    .sort((a, b) => osRank(a.os) - osRank(b.os) || a.os.localeCompare(b.os));
  return { agnostic: false, columns, rows };
}
