// Wire / view-model shapes the site renders, plus the one accessor (`ownerLogin`)
// that reads across the owner spelling change. No dependency, so any consumer
// (model, islands, tests) can import it.

// Shape of `/data/catalog/catalog.json` per the plan's frozen "Site fetch
// layer" contract — NOT the wire contract (that's `/config.json` +
// `/p/**`, see `packageRootFetch.ts`/`imageIndexFetch.ts`). Render-pipeline-owned,
// camelCase, free to evolve between deploys.

export interface CatalogPackage {
  namespace: string
  package: string
  name: string
  status: 'active' | 'deprecated' | 'yanked'
  deprecatedMessage: string | null
  supersededBy: string | null
  /** Root's `created` date — the "newest" sort key. */
  created: string
  /** Last tag activity (max `observed`/`yanked.at`), null when tagless —
   * the "recently updated" sort key. */
  updated: string | null
  title: string
  description: string
  keywords: string[]
  latestVersion: string | null
  /** Variant names the package ships, derived by `core/render.py` from the
   * root's own `tags` (`version_order.variant_names`). Absent when the
   * package ships only the default variant — which is also why
   * `latestVersion` can be non-null while this is undefined: that field
   * deliberately ignores variant-prefixed tags. */
  variants?: string[]
  tagCount: number
  /** `os/arch` strings, e.g. `linux/amd64` — union across all non-yanked tags. */
  platforms: string[]
  logoUrl: string | null
  readmeUrl: string | null
}

/** One configured index, as the catalog's scope control sees it. Present
 * only when the deployment aggregates MORE than one — a single-source
 * catalog carries no envelope at all, which is what makes "render no scope
 * control" a fact about the data rather than a count the theme has to keep
 * in sync. */
export interface CatalogIndexInfo {
  /** The index's own name — the first `/`-segment of every package name it
   * publishes, and what the scope tab shows. */
  name: string
  /** The root index: mirrored at the site root, and the only one whose
   * packages keep bare routes. No entry has it when no source is `root`.
   * Placement only — see `default` for which index the view opens on. */
  root: boolean
  /** The default index: preselected on arrival and badged "default" in the
   * tab row. Already resolved by the build (`default: true` on a source, else
   * the `root` one), so at most one entry has it and no fallback rule lives
   * here. No entry has it when a config names neither, and the catalog then
   * opens on "all". */
  default: boolean
  /** Left out of the "all" tab (grid, table, filters, keyword rail, the tab's
   * count). The index keeps its own tab and its routes; the command palette
   * still spans it. Absent in a catalog.json this renderer did not write. */
  excludeFromAll?: boolean
  /** Packages this index contributes to the merged catalog. */
  count: number
}

export interface CatalogData {
  generated: string | null
  indexes?: CatalogIndexInfo[]
  packages: CatalogPackage[]
}

// TS interfaces mirror the wire JSON field names 1:1 (snake_case) —
// schema/root.schema.json is the source of truth, no camelCase translation
// layer in between.

export interface Owner {
  /** The owner's forge USERNAME — never a display name. Canonical since
   *  ocx-indexbot 0.5.0. Optional because an index published before that
   *  carries only the legacy pair below. */
  login?: string
  /** The owner's numeric forge user id, and the index's own ownership key. */
  id?: number
  /** Pre-0.5.0 spelling of `login`. A root written by 0.5.0 or later carries
   *  it too, derived from `login`, so the two never disagree. */
  github?: string
  /** Pre-0.5.0 spelling of `id`. */
  github_id?: number
}

/** The owner's forge username, whichever spelling the root carries. */
export function ownerLogin(owner: Owner): string | undefined {
  return owner.login ?? owner.github
}

export interface Upstream {
  org: string
  repository_url?: string
  disclaimer?: string | null
}

export interface Desc {
  digest: string
  title: string
  description: string
  keywords: string[]
  readme?: string
  logo?: string
}

export interface Yanked {
  reason: string
  at: string
}

export interface TagEntry {
  content: string
  observed: string
  yanked?: Yanked
}

export interface PackageRoot {
  name: string
  repository: string
  owners: Owner[]
  status: 'active' | 'deprecated' | 'yanked'
  deprecated_message: string | null
  superseded_by?: string | null
  created: string
  upstream?: Upstream
  /** Repository whose CI produced the builds (bot-derived from the latest
   * version's `org.opencontainers.image.source` annotation) — NOT
   * `upstream.repository_url`, which attributes the vendor a namespace
   * mirrors. Schema-restricted to `https://`; still run through `safeHref`
   * before it reaches an `:href`. */
  source?: string | null
  desc: Desc | null
  tags: Record<string, TagEntry>
}

// Shape mirrors the OCI image-index spec (v1.1.1) 1:1 — the `platform`
// object's dotted keys — `os.version`, `os.features` — are OCI image-spec
// property names verbatim, not a nested `os` object.

export interface Platform {
  architecture: string
  os: string
  'os.version'?: string
  'os.features'?: string[]
  variant?: string
  features?: string[]
}

export interface ManifestDescriptor {
  mediaType: string
  digest: string
  size: number
  platform?: Platform
}

export interface ImageIndex {
  schemaVersion: number
  mediaType: string
  manifests: ManifestDescriptor[]
  /** OCI annotations map (C-600) — `readImageIndexAnnotations`
   * (`src/viewmodel/catalog.ts`) reads `org.opencontainers.image.
   * {licenses,source,revision}` off this field. */
  annotations?: Record<string, unknown>
}

/** The slice of `fetch` the site's fetch cores use: one URL in, a response
 * with a status and a JSON body out. Cores take it as a parameter so tests
 * (and any non-browser host) can supply their own. */
export type FetchLike = (url: string) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>
