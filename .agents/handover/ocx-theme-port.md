# Handover: port the catalog onto `@ocx-sh/theme`

From the `ocx-sh/website` session (owner request, 2026-10-07). You own this repo's port. The
website session owns `@ocx-sh/theme` and implements what you ask it for.

## Goal

`@ocx-sh/catalog` stops being a VitePress + Vue theme and renders with the shared ocx.sh library
`@ocx-sh/theme` (Astro + Zag components, tokens, the shared header and nav). The result looks and
behaves like the rest of `ocx.sh` and is served at `/catalog/` (claim `ocx-sh/index`, which runs
the `ocx-catalog` binary). This repo's own docs (MkDocs) move to Starlight at `/apps/catalog/`
(claim `ocx-sh/catalog`).

Host split ([ADR 0001 D1.6](https://github.com/ocx-sh/website/blob/main/.agents/adr/adr_0001_ocx-site-architecture.md)):
`index.ocx.sh` stays the index host. Its sparse JSON index (`/config.json`, `/p/<ns>/<pkg>.json`)
keeps serving because shipped ocx binaries read it there. Only the HTML catalog moves to
`ocx.sh/catalog/`; later, `index.ocx.sh` redirects its HTML paths there and never its JSON paths.
So the renderer must:

- emit everything under a configurable base (`/catalog/`), with no root-absolute `/assets/` URLs;
- leave the JSON files alone.

Unchanged: the catalog only reads an index and never writes or invents index data. The index URL
shapes and field semantics stay frozen (`.claude/rules/product-context.md`).

## Read first

The library lives in the local checkout `/home/mherwig/dev/ocx-website`:

- `HANDOVER.md` (decisions; the catalog rows and phase 5 "Catalog Astro port").
- `AGENTS.md` › Working here (tokens only, Zag loading rules, budgets, assets never flicker).
- `skills/ocx-theme-setup`, `-components`, `-theming`, `-icons`, `-quality`, `-deploy`. These are the
  consumer manual, and you follow them.
- Live component demos: `cd /home/mherwig/dev/ocx-website && ocx exec -- task dev`, then
  http://localhost:4321/docs/components/.
- Components that fit a catalog: `ui/List` (async list), `DataTable`, `Pagination`,
  `SearchField`, `CommandBar`, `Combobox`, `Select`, `TagGroup`, `Tabs`, `PlatformIcons`,
  `DependencyExplorer`, `CopyButton`, `Terminal`, `Breadcrumbs`, `Skeleton`, `Tooltip`.

## Wiring: local checkout, no release

Install the theme from the local checkout rather than npm:

```sh
npm install /home/mherwig/dev/ocx-website/packages/theme   # writes file:../ocx-website/packages/theme
```

The dependency resolves through a symlink to the live working tree, so any change the website
session makes shows up on your next build. It stays local only: never commit a `file:` dependency
to `main`, and never publish with one. The npm switch comes with theme `v0.2.0` and a bump PR,
after the owner's hardening pass.

## Requesting library features

Do not edit `/home/mherwig/dev/ocx-website`. When the catalog needs something the theme lacks (a
component, a prop, a token, a slot, a bug fix), message the website session:

1. Find it with `ListAgents`; it is the session named `ocx-website-*` (currently `ocx-website-83`).
2. `SendMessage` one request per need:
   - **Need:** what is missing, as a library capability, not a catalog patch.
   - **Why:** the catalog surface that needs it (file:line).
   - **Proposed API:** the props, slots or tokens you would call.
   - **Workaround:** what you do meanwhile, if anything.
3. The website session replies with the commit on `feat/phase3-pilots`
   ([PR #11](https://github.com/ocx-sh/website/pull/11)) and the skill section that documents it.
   Your build picks it up through the link.

Prefer composing existing components over asking for catalog-specific ones. The library only takes
general capabilities.

## Suggested order

1. **Agent config:**
   - Run `grim init` here and add `ghcr.io/ocx-sh/lore/docs-essentials:latest` as a bundle, the
     same shape as `/home/mherwig/dev/ocx-website/grimoire.toml`.
   - Commit `grimoire.toml`, `grimoire.lock` and the installed files.
   - Follow docs-essentials for every doc you touch.
2. **Plan in this repo** (your own planning flow): the target architecture and how the
   `ocx-catalog` CLI contract, config and multi-index support survive. Decide between plain Astro
   with theme components and Starlight; the package grid and detail pages likely want plain Astro
   pages using the theme's chrome. Ask the website session early about chrome reuse outside
   Starlight.
3. **Docs site** (`docs/` MkDocs → Starlight at `/apps/catalog/`) first, as a small proving step.
   Follow the same steps as the rules_ocx and ocx-sdk-python pilots in
   `.agents/plans/plan_phase3-pilots.md`.
4. **Renderer port:** grid, detail pages, search and the docs mount. Keep the vitest 100% coverage
   gate and `task verify` green throughout; check rendered output against the current catalog
   using `task dev:catalog`.
5. **Consumer check:** render the real `ocx-sh/index` (`../index`, read only) and compare it with
   the live `/catalog/`.

## Quality bar

- Lighthouse 100 in all four categories.
- Nothing loads before interaction.
- No layout shift, and the page looks the same with images blocked.
- Tokens only; no raw colours or sizes.

Heavy gates (Lighthouse, e2e) run one at a time, because the host runs out of memory. The owner
schedules hardening.

## Never

- Push, tag, publish to npm, or merge.
- Edit `/home/mherwig/dev/ocx-website` or `../index`.
- Commit a `file:` theme dependency to `main`.
- Copy theme CSS or components into this repo instead of requesting them.
