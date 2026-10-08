import { installCommand, type InstallFlavor, type InstallIcon } from './installFlavors.js'

export interface CopyAction {
  label: string
  command: string
  icon: 'identifier' | 'tag' | 'link' | InstallIcon
}

/**
 * SINGLE source of truth for EVERY copy context menu — detail-page tag
 * badges (`TagBadge.vue`, `VersionTree.vue` alias-chain segments), the
 * detail install grid (`MetaRail.vue`), the catalog card (`PackageCard.vue`)
 * and the catalog table (`PackageTable.vue`). Do NOT hand-roll an action
 * list in a consumer: that is exactly how the catalog menu silently missed a
 * later-added action.
 *
 * The menu is the three copy actions plus ONE item per install flavor
 * (`useInstallFlavors`), so `DEFAULT_INSTALL_FLAVORS` reaches the
 * right-click menu and the install grid from the same list. It used to carry
 * its own hardcoded five-command block, which is why an `ocx package inspect`
 * item existed here and nowhere else; folding both onto one list is what
 * makes that shared flavor list cover every CLI string the theme renders.
 *
 * `tag` may be `null` — a catalog card may know no tag, in which case the
 * identifier is the bare qualified name and the tag-only action is omitted.
 * `flavors` is required, not defaulted: a call site that forgets it should
 * not silently fall back to the built-in CLI name.
 */
export function buildTagCopyActions(
  qualifiedName: string,
  tag: string | null | undefined,
  flavors: readonly InstallFlavor[],
  routePath?: string,
): CopyAction[] {
  const identifier = tag ? `${qualifiedName}:${tag}` : qualifiedName
  const list: CopyAction[] = [
    { label: 'Copy identifier', command: identifier, icon: 'identifier' },
  ]
  if (tag) list.push({ label: 'Copy tag', command: tag, icon: 'tag' })
  // Detail-page URL. This used to derive the route by stripping
  // `qualifiedName`'s first `/`-segment, which held only while EVERY route
  // was the bare `<ns>/<pkg>`. With multi-index routing the brand segment
  // survives in a non-root index's route (`/acme/platform/deploy-kit`), so
  // the route is no longer a function of the name alone and is passed in by
  // whoever owns it: the catalog card and table row hand over the same
  // string they use as `href`. Omitted on the detail page's own menus
  // (MetaRail/VersionTree/TagBadge), where the page being viewed IS the
  // package, so its own pathname is the canonical link with nothing to
  // derive. SSR guard: this runs in consumers' computeds during the SSG
  // build, where there is no origin to resolve against.
  if (typeof window !== 'undefined') {
    const path = routePath ?? window.location.pathname
    list.push({ label: 'Copy link', command: new URL(path, window.location.origin).href, icon: 'link' })
  }
  for (const flavor of flavors) {
    list.push({ label: flavor.label, command: installCommand(flavor.command, identifier), icon: flavor.icon })
  }
  return list
}
