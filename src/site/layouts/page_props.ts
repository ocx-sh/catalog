/**
 * The only seam between pages and the page shell (C-032): `Page.astro`'s
 * props. A strict subset of `@ocx-sh/theme/layouts/Shell.astro`'s `Props`
 * (`title`, `description`, `canonical`, `activeSection`), so P-chrome's H.5
 * swap of the fallback layout for `Shell` changes no page file. `brand`,
 * `nav` and `footer` are deliberately absent: `Page` supplies them from
 * `ChromeView`, pages never pass them.
 *
 * Slots: `head` (extra `<head>` content), `default` (the page body, inside
 * `<main id="main">`), `header-search` (the palette trigger in the header).
 */
export interface PageProps {
  title: string;
  description?: string;
  canonical?: string | URL;
  /** `ocx` chrome only: which top-level nav section is current. */
  activeSection?: string;
}
