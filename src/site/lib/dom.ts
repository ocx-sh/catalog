// Generic DOM helper leaf — importable from both `catalog/**` and
// `search/**` (a plain `utils/` module, not scoped under either) without
// tripping the frozen "catalog doesn't import from search, and vice versa"
// WP-C/WP-E decision (see `useCommandPalette.ts`'s own docblock).

/**
 * True when `target` is a form control or `contenteditable` element — used
 * to skip a global single-key shortcut ("/", etc.) while the user is
 * already typing somewhere.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
}

/**
 * True when `link` carries an absolute URI scheme (or protocol-relative
 * `//`) — the same heuristic VitePress's own DefaultTheme nav uses, and
 * what `SiteHeader.vue`'s `nav[]` rendering already applied before this was
 * extracted here. `SiteFooter.vue` is the second caller: it renders
 * `footer.links[]`, its own config key rather than the header's `nav[]`
 * (it did mirror `nav[]` under C-602, until issue #5 split the two), and
 * both lists admit the same absolute-URL entries.
 */
export function isExternalLink(link: string): boolean {
  return /^([a-z][a-z\d+.-]*:|\/\/)/i.test(link)
}
