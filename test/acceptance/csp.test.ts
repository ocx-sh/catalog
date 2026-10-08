/**
 * C-043, S-021: every built HTML page carries a CSP `<meta>` whose policy is
 * `script-src 'self'` + SHA-256 hashes, `object-src 'none'`, `base-uri 'none'`
 * and `style-src 'self' 'unsafe-inline'`, and every inline `<script>` on the
 * page has its hash in the policy. Astro hashes only the scripts it bundles;
 * the Shell's `is:inline` head scripts get theirs from `@ocx-sh/theme/csp`
 * (`src/site/csp_hashes.ts`), so a page script added without a hash goes red
 * here. Needs `root` and `catalog`.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { listTree, site } from "./helpers.js";

type Policy = ReadonlyMap<string, readonly string[]>;

const CSP_META = 'meta[http-equiv="content-security-policy" i]';

function policyOf(doc: Document): Policy {
  const content = doc.querySelectorAll(CSP_META)[0]?.getAttribute("content");
  if (content === undefined) throw new Error("no CSP <meta>");
  return new Map(
    content
      .split(";")
      .map((directive) => directive.trim().split(/\s+/))
      .filter(([name]) => name !== "")
      .map(([name, ...sources]): [string, string[]] => [name!, sources]),
  );
}

const sha256 = (text: string): string => `'sha256-${createHash("sha256").update(text).digest("base64")}'`;

/** The inline `<script>` bodies of a page whose hash is not a `script-src` source. */
function unhashedInlineScripts(doc: Document): string[] {
  const sources = policyOf(doc).get("script-src") ?? [];
  return [...doc.querySelectorAll("script:not([src])")]
    .map((script) => script.textContent ?? "")
    .filter((text) => !sources.includes(sha256(text)));
}

const htmlPages = async (name: "root" | "catalog"): Promise<string[]> =>
  (await listTree(site(name))).filter((path) => path.endsWith(".html") && !path.startsWith("index/") && !path.startsWith("p/"));

describe.each(["root", "catalog"] as const)("C-043 CSP of the %s site", (name) => {
  it("every HTML page carries exactly one CSP meta", async () => {
    const pages = await htmlPages(name);

    expect(pages.length).toBeGreaterThan(2);
    for (const page of pages) {
      const doc = new JSDOM(await readFile(join(site(name), page), "utf8")).window.document;
      expect(doc.querySelectorAll(CSP_META).length, page).toBe(1);
    }
  });

  it("the policy: script-src 'self' + hashes, object-src 'none', base-uri 'none', style-src 'self' 'unsafe-inline'", async () => {
    for (const page of await htmlPages(name)) {
      const policy = policyOf(new JSDOM(await readFile(join(site(name), page), "utf8")).window.document);
      const [self, ...hashes] = policy.get("script-src") ?? [];

      expect(self, page).toBe("'self'");
      expect(hashes.length, page).toBeGreaterThan(0);
      for (const hash of hashes) expect(hash, page).toMatch(/^'sha256-[A-Za-z0-9+/]{43}='$/);
      expect(policy.get("object-src"), page).toEqual(["'none'"]);
      expect(policy.get("base-uri"), page).toEqual(["'none'"]);
      expect(policy.get("style-src"), page).toEqual(["'self'", "'unsafe-inline'"]);
    }
  });

  it("every inline <script> has its hash in the policy", async () => {
    let inlineScripts = 0;
    for (const page of await htmlPages(name)) {
      const doc = new JSDOM(await readFile(join(site(name), page), "utf8")).window.document;
      inlineScripts += doc.querySelectorAll("script:not([src])").length;
      expect(unhashedInlineScripts(doc), page).toEqual([]);
    }
    // The Shell's theme and platform scripts: the check is looking at something.
    expect(inlineScripts).toBeGreaterThanOrEqual(2 * (await htmlPages(name)).length);
  });

  it("every external <script> is same-origin, so script-src 'self' covers it", async () => {
    for (const page of await htmlPages(name)) {
      const doc = new JSDOM(await readFile(join(site(name), page), "utf8")).window.document;
      for (const script of doc.querySelectorAll("script[src]")) {
        expect(script.getAttribute("src"), page).toMatch(/^\/(?!\/)/);
      }
    }
  });
});

describe("the inline-script check is able to fail", () => {
  const page = (script: string): Document =>
    new JSDOM(
      `<html><head><meta http-equiv="content-security-policy" content="script-src 'self' ${sha256("known()")};"><script>${script}</script></head></html>`,
    ).window.document;

  it("passes a script whose hash is in the policy", () => {
    expect(unhashedInlineScripts(page("known()"))).toEqual([]);
  });

  it("reports a script whose hash is not", () => {
    expect(unhashedInlineScripts(page("alert(1)"))).toEqual(["alert(1)"]);
  });
});
