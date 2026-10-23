/**
 * The README provenance menu's two links (D-085). The page is static and knows no origin, so the menu ships the
 * README's `base`-joined path as the text of "Copy URL" and "Copy fetch command"; this makes them absolute against
 * the page that is open, the way the retired Vue pane did with `window.location.origin`.
 *
 * Markup contract (`components/ReadmePane.astro`): a mount root `[data-readme-provenance]` carrying `data-path`, the
 * README path, around the theme's `CopyMenu`, whose items are `[data-part="item"][data-value="digest|url|curl"]`
 * with their text in `data-copy-text`. Only attributes are written. `detail.ts` calls it when it starts.
 */
import { fetchCommand } from "../lib/readmeProvenance.js";

export function absolutizeProvenance(root: HTMLElement, pageUrl: string): void {
  const url = new URL(String(root.dataset.path), pageUrl).href;
  root.querySelector('[data-part="item"][data-value="url"]')?.setAttribute("data-copy-text", url);
  root.querySelector('[data-part="item"][data-value="curl"]')?.setAttribute("data-copy-text", fetchCommand(url));
}
