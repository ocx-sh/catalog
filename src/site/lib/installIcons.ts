import type { IconName } from "@ocx-sh/theme/icons";
import type { InstallIcon } from "./installFlavors.js";
import type { PinLevel } from "./installPin.js";

/** The theme registry icon each install flavor (and its copy-menu entry) shows. */
export const INSTALL_ICON_NAMES = {
  project: "folder",
  global: "globe",
  exec: "play",
  install: "download",
} as const satisfies Record<InstallIcon, IconName>;

/** The registry icon of each pin level in the install card's picker: loosest to strictest. */
export const PIN_ICON_NAMES = {
  latest: "sparkles",
  rolling: "refresh",
  major: "circle-dashed",
  minor: "circle-dot-dashed",
  patch: "circle-dot",
  pinned: "lock",
} as const satisfies Record<PinLevel, IconName>;
