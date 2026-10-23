/**
 * The only seam between pages and the page shell (C-032): `Page.astro`'s
 * props. A subset of `@ocx-sh/theme/layouts/Shell.astro`'s `Props`
 * (`title`, `description`, `canonical`, `activeSection`), so P-chrome's H.5
 * swap of the fallback layout for `Shell` changes no page file, plus
 * `packageName`, which only feeds the head's fallback description. `brand`,
 * `nav` and `footer` are deliberately absent: `Page` supplies them from
 * `ChromeView`, pages never pass them.
 *
 * Slots: `head` (extra `<head>` content), `default` (the page body, inside
 * `<main id="main">`), `header-search` (the palette trigger in the header).
 */
export interface PageProps {
  title: string;
  description?: string;
  /** `null`: the page declares no canonical (the 404 page, a non-route served for every URL). */
  canonical?: string | URL | null;
  /** A package detail page's name; the head's fallback description names it. */
  packageName?: string;
  /** `ocx` chrome only: which top-level nav section is current. */
  activeSection?: string;
  /** The content column (D-005, D-110): `prose` by default, `wide` for a card grid, `full` edge to edge. */
  width?: "prose" | "wide" | "full";
  /** The id the skip link jumps to (D-114); the Shell's default is `main`. */
  skipTarget?: string;
}
