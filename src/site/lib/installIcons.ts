import type { IconName } from "@ocx-sh/theme/icons";
import type { InstallIcon } from "./installFlavors.js";

/** The theme registry icon each install flavor (and its copy-menu entry) shows. */
export const INSTALL_ICON_NAMES = {
  project: "folder",
  global: "globe",
  exec: "play",
  install: "download",
} as const satisfies Record<InstallIcon, IconName>;
