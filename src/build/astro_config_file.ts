/**
 * Writes `<scratch>/astro.config.mjs` — two lines, exactly two interpolated
 * strings, both through `JSON.stringify` (C-040), so no path can break out of
 * its string literal. The module imports `astroConfig` from this package's
 * `dist/site/astro_config.js` and feeds it the `astro` property of the JSON
 * file at `sitePath` (a `SiteInput`) — the child process has no other channel
 * for it, and the config file itself must stay free of interpolated data.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * @param scratch absolute scratch root
 * @param configModuleUrl absolute file URL of this package's `dist/site/astro_config.js`
 * @param sitePath absolute path of `<scratch>/site.json`
 * @returns the written file's path
 */
export const writeAstroConfig = async (scratch: string, configModuleUrl: string, sitePath: string): Promise<string> => {
  const file = join(scratch, "astro.config.mjs");
  await writeFile(
    file,
    `import { readFileSync } from "node:fs"; import { astroConfig } from ${JSON.stringify(configModuleUrl)};\n` +
      `export default astroConfig(JSON.parse(readFileSync(${JSON.stringify(sitePath)}, "utf8")).astro);\n`,
  );
  return file;
};
