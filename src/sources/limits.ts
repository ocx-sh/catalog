// Byte ceilings shared by the mirror (`mirror.ts`, fs) and the README renderer (`site/lib/readmeRender.ts`).
// A leaf module: it imports nothing, so the renderer takes the cap without pulling in filesystem code.

/** Size ceiling for a mirrored CAS CONTENT asset (a `desc.readme`/`desc.logo`
 * blob — a `.md`/`.svg`/`.png` under `p/.../o/sha256/`). One that exceeds it
 * is skipped and warned rather than served: a hostile or careless source can
 * otherwise inflate `dist/` and bandwidth with a multi-megabyte blob behind a
 * 34px logo tile (rev-perf, 2026-08-22). Package roots and OCI image indices
 * (`.json`) are NOT capped here — they are structural, and skipping one would
 * dangle a package rather than degrade gracefully the way a missing logo/
 * readme does. `url` sources already bound each fetched blob at 8 MiB
 * (`walker.ts` `MAX_RESPONSE_BYTES`); this is the equivalent guard for
 * `path`/`git` sources, which read straight off disk with no fetch cap.
 * ponytail: one flat ceiling for both readme and logo; split it only if a
 * real readme ever legitimately needs more than a logo. */
export const MAX_CAS_ASSET_BYTES = 1024 * 1024;
