import { computed, type ComputedRef } from 'vue'
import { DEFAULT_INSTALL_FLAVORS, type InstallFlavor } from '../../site/lib/installFlavors'

/** The flavors for the current site — always `DEFAULT_INSTALL_FLAVORS`.
 * `ComputedRef`, not a plain constant, so every call site's existing
 * `.value` read keeps working unchanged. */
export function useInstallFlavors(): ComputedRef<readonly InstallFlavor[]> {
  return computed(() => DEFAULT_INSTALL_FLAVORS)
}
