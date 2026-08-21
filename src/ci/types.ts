import type { CiConfig } from "../config/types.js";

/** Single source of truth for the forge union — mirrors `CiConfig["forge"]`
 * rather than redeclaring the literal union. */
export type Forge = CiConfig["forge"];
