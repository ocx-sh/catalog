// Static Diátaxis-shaped sidebar nav — deliberately NOT VitePress's
// path-keyed `themeConfig.sidebar` machinery (this is a blank theme, no
// DefaultTheme — see theme/index.mts). DocsSidebar.vue and DocsMobileNav.vue
// are the only consumers.
//
// Group labels/order/entries verified against two sources: design mock 1f
// ("Docs skin") sidebar, and the actual file tree under `src/docs/**` —
// REFERENCE / HOW-TO / OPS / EXPLANATION, matching both exactly. (Note:
// the work order that spawned this file described the four Diátaxis groups
// as "tutorials / how-to / reference / explanation" — this repo's docs tree
// has no `tutorials/` directory; it has `ops/` instead, which is also what
// the mock itself renders as the fourth group. Following the mock + the
// real tree over the work order's paraphrase.)
//
// Each group's own `index.md` landing page is reachable via the group
// header's `link` (rendered by DocsSidebar as the group label's href), not
// listed again as a leaf entry — matches the mock, which never lists an
// "index"-style item under any group.

export interface DocsNavItem {
  text: string
  link: string
}

export interface DocsNavGroup {
  label: string
  link: string
  items: DocsNavItem[]
}

export const DOCS_NAV: DocsNavGroup[] = [
  {
    label: 'REFERENCE',
    link: '/docs/reference/',
    items: [
      { text: 'Wire Format', link: '/docs/reference/wire-format' },
      { text: 'Entry Schema', link: '/docs/reference/entry-schema' },
      { text: 'Namespace Policy', link: '/docs/reference/namespace-policy' },
      { text: 'Governance Contracts', link: '/docs/reference/governance-contracts' },
      { text: 'Changelog', link: '/docs/reference/changelog' },
    ],
  },
  {
    label: 'HOW-TO',
    link: '/docs/how-to/',
    items: [
      { text: 'Claim a Namespace', link: '/docs/how-to/claim-a-namespace' },
      { text: 'Announce a Package', link: '/docs/how-to/announce-a-package' },
      { text: 'Yank a Version', link: '/docs/how-to/yank-a-version' },
    ],
  },
  {
    label: 'OPS',
    link: '/docs/ops/',
    items: [
      { text: 'M-1 Flip', link: '/docs/ops/m1-flip' },
      { text: 'Run a Reconcile Dry Run', link: '/docs/ops/run-reconcile-dry-run' },
    ],
  },
  {
    label: 'EXPLANATION',
    link: '/docs/explanation/',
    items: [
      { text: 'Architecture', link: '/docs/explanation/architecture' },
    ],
  },
  // Post-mock addition (owner-requested): the privacy notice lives in the
  // docs chrome and gets its own group — deliberately labeled LEGAL, not
  // "Impressum": the page is a GDPR privacy notice, and the site
  // intentionally carries no Impressum (see src/docs/privacy.md).
  {
    label: 'LEGAL',
    link: '/docs/privacy',
    items: [
      { text: 'Privacy', link: '/docs/privacy' },
    ],
  },
]
