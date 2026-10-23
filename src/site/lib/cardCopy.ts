// What a catalog card or table row offers to copy (D-001, D-002): the entries of the one `CopyMenu` that wraps
// the lists, and the texts each card carries as `data-copy`. The texts are `buildTagCopyActions`' (identifier,
// tag, link, one command per install flavor), so the menu, the version list and the install card read one list.
import type { IconName } from "@ocx-sh/theme/icons";
import { buildTagCopyActions } from "./copyActions.js";
import type { InstallFlavor } from "./installFlavors.js";
import { INSTALL_ICON_NAMES } from "./installIcons.js";

export interface CardCopyItem {
  /** Keys the host's `data-copy` map. */
  readonly value: string;
  readonly label: string;
  readonly icon: IconName;
}

/** The menu entries, in `buildTagCopyActions`' order. */
export const cardCopyItems = (flavors: readonly InstallFlavor[]): CardCopyItem[] => [
  { value: "identifier", label: "Copy identifier", icon: "copy" },
  { value: "tag", label: "Copy tag", icon: "pin" },
  { value: "link", label: "Copy link", icon: "external" },
  ...flavors.map(({ icon, label }) => ({ value: icon, label, icon: INSTALL_ICON_NAMES[icon] })),
];

/**
 * The texts one package offers, by entry. `href` is the card's own detail link (`packageHref`): the browser
 * adds the `link` entry from it; on the server there is no origin, so the entry is left out until the page runs.
 */
export function cardCopyData(
  qualifiedName: string,
  tag: string | null,
  flavors: readonly InstallFlavor[],
  href?: string,
): Record<string, string> {
  return Object.fromEntries(buildTagCopyActions(qualifiedName, tag, flavors, href).map((action) => [action.icon, action.command]));
}
