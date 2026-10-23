// What the README card's provenance menu offers to copy (D-085): the README's content digest, its URL and a
// command that fetches it. The README is a content-addressed wire file, so its path carries the digest.
import { joinBase } from "../../viewmodel/url.js";

export interface ReadmeProvenance {
  /** `sha256:<hex>`, as the wire root's `desc.readme` writes it. */
  readonly digest: string;
  /** `base`-joined path of the README's wire file; the browser makes it absolute against its own origin. */
  readonly href: string;
}

/** The anchored shape `lib/cas.ts` builds: `/p/<ns>/<pkg>/o/sha256/<hex>.md`, below an optional `index/<label>`. */
const README_PATH = /^(?:\/index\/[^/]+)?\/p\/(?:[^/]+\/)+o\/sha256\/([a-z0-9]{64})\.md$/;

/** `readmeUrl` is the catalog-root-relative path of the model; `null` for no README or a path that is not a CAS file. */
export function readmeProvenance(readmeUrl: string | null, base: string): ReadmeProvenance | null {
  if (readmeUrl === null) return null;
  const digest = README_PATH.exec(readmeUrl)?.[1];
  return digest === undefined ? null : { digest: `sha256:${digest}`, href: joinBase(base, readmeUrl) };
}

/** The shell command that downloads the README at `url`. */
export const fetchCommand = (url: string): string => `curl -sL ${url}`;
