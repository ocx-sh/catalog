/**
 * Install-command flavors: the SINGLE source of truth for every CLI command
 * string this site renders — the detail page's install card
 * (`InstallCard.astro`), the catalog card's install line
 * (`PackageCard.astro`), and the command half of every right-click copy menu
 * (`copyActions.ts`'s `buildTagCopyActions`). Every consumer of this site
 * renders an OCX package index, so the CLI is `ocx` for all of them —
 * `DEFAULT_INSTALL_FLAVORS` below is fixed, not configurable.
 */
export type InstallIcon = 'project' | 'global' | 'exec' | 'install'

export interface InstallFlavor {
  label: string
  /** Command template carrying the literal `{name}` token — substitute with
   * `installCommand()`, never by hand. */
  command: string
  icon: InstallIcon
}

/** The one flavor set this theme renders. Four rows, in the order the
 * install grid shows them. */
export const DEFAULT_INSTALL_FLAVORS: readonly InstallFlavor[] = [
  { label: 'Add to project', command: 'ocx add {name}', icon: 'project' },
  { label: 'Add globally', command: 'ocx --global add {name}', icon: 'global' },
  { label: 'Run without installing', command: 'ocx package exec {name}', icon: 'exec' },
  { label: 'Install package', command: 'ocx package install {name}', icon: 'install' },
]

/**
 * Substitutes a flavor's `{name}` token with the package identifier the
 * command should operate on.
 *
 * `split`/`join`, not `replace`/`replaceAll`: a replacement STRING is
 * `$`-significant (`$&`, `$1`, `$'`), and `qualifiedName` is wire data — a
 * package literally named `…/$&` would otherwise splice the match back in.
 * Same reasoning as `config_gen.ts`'s `PKG_DESCRIPTION` substitution.
 */
export function installCommand(command: string, qualifiedName: string): string {
  return command.split('{name}').join(qualifiedName)
}
