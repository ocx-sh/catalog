import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import { describe, expect, test, vi } from "vitest";
import {
  createReadmeSanitizer,
  isAllowedStyle,
  type ReadmeLinkContext,
  SANITIZE_CONFIG,
  type ReadmeWindow,
} from "../../../src/site/lib/readmeSanitizer.js";
import { createReadmeMarkdown } from "../../../src/site/lib/readmeMarkdown.js";

// Real jsdom windows, never a global: what the build injects.
const newWindow = (): ReadmeWindow => new JSDOM("").window as unknown as ReadmeWindow;
const sanitizer = createReadmeSanitizer(newWindow);
const sanitize = (html: string, links?: ReadmeLinkContext): string => sanitizer.sanitize(html, links);

// Where a README lives: under `/catalog/`, and in a non-root index mounted at `/`.
// Everything is "mirrored" here (the permissive worst case for the inertness
// corpus); the tests that care about the mirror pass `onlyMirrored(...)`.
const CATALOG: ReadmeLinkContext = { base: "/catalog/", readmeUrl: "/p/acme/tool/o/sha256/abc.md", mirrored: () => true };
const INDEXED: ReadmeLinkContext = {
  base: "/",
  readmeUrl: "/index/lbl/p/acme/tool/o/sha256/abc.md",
  mirrored: () => true,
};
const onlyMirrored = (...paths: string[]): ReadmeLinkContext => ({ ...CATALOG, mirrored: (path) => paths.includes(path) });

const HOSTILE_README = readFileSync(
  fileURLToPath(
    new URL(
      "../../fixtures/site/index-b/p/hostile/readme/o/sha256/73bf7621173355e68eb275a065cd44c95fcb7307e479bbba03fa43b2a2963443.md",
      import.meta.url,
    ),
  ),
  "utf8",
);

describe("dompurify version", () => {
  test("is >= 3.4.0 (the mXSS fixes the namespace-confusion corpus relies on)", () => {
    const { version } = createDOMPurify(newWindow());
    const [major, minor] = version.split(".").map(Number);
    expect(major > 3 || (major === 3 && minor >= 4)).toBe(true);
  });
});

describe("SANITIZE_CONFIG", () => {
  test("html profile, no data-* attributes, named properties prefixed, <style> forbidden", () => {
    expect(SANITIZE_CONFIG.USE_PROFILES).toEqual({ html: true });
    expect(SANITIZE_CONFIG.ALLOW_DATA_ATTR).toBe(false);
    expect(SANITIZE_CONFIG.SANITIZE_NAMED_PROPS).toBe(true);
    expect(SANITIZE_CONFIG.FORBID_TAGS).toContain("style");
  });

  test("data-* attributes are stripped, ids are prefixed (DOM clobbering)", () => {
    const out = sanitize('<div data-x="1" id="location">x</div>');
    expect(out).not.toContain("data-x");
    expect(out).toContain('id="user-content-location"');
  });
});

describe("hostile corpus is inert", () => {
  const corpus: Record<string, string> = {
    "<script>": "<p>a</p><script>alert(1)</script><p>b</p>",
    "on* handlers": '<img src="https://x.test/a.png" onerror="alert(1)"><div onclick="alert(1)">c</div>',
    "javascript: href": '<a href="javascript:alert(1)">c</a>',
    "tab-split javascript:": '<a href="java&#9;script:alert(1)">c</a>',
    "entity javascript:": '<a href="&#x6a;avascript:alert(1)">c</a>',
    "data: href": '<a href="data:text/html,<script>alert(1)</script>">c</a>',
    "data: image": '<img src="data:image/svg+xml,<svg onload=alert(1)>">',
    "svg onload": '<svg onload="alert(1)"><g><foreignObject><p>x</p></foreignObject></g></svg>',
    "math mxss": "<math><mtext><table><mglyph><style><!--</style><img title=\"--&gt;&lt;img src=1 onerror=alert(1)&gt;\">",
    "svg/math/style nesting":
      '<svg><g onload=alert(1)><foreignObject><math><mi><style><a title="</style><img src onerror=alert(1)>"></mi></math></foreignObject></g></svg>',
    "noscript": '<noscript><p title="</noscript><img src onerror=alert(1)>"></noscript>',
    "style tag": "<p>a</p><style>p{background:url(https://evil.test/x)}</style>",
    "style attr": '<div style="position:fixed;inset:0">x</div>',
    iframe: '<iframe src="https://evil.test"></iframe>',
    "form action": '<form action="https://evil.test"><input name="p"></form>',
    "video poster": '<video src="https://evil.test/v.mp4" poster="https://evil.test/p.png"></video>',
    "img srcset": '<img src="https://x.test/a.png" srcset="https://evil.test/p.png 2x">',
    "input type=image": '<input type="image" src="https://evil.test/p.png" formaction="https://evil.test/x">',
    "button formaction": '<button formaction="https://evil.test/x">go</button>',
    textarea: "<textarea>x</textarea>",
    select: "<select><option>x</option></select>",
    "a download": '<a href="https://example.com/x" download="evil.exe">c</a>',
    "img usemap": '<img src="https://x.test/a.png" usemap="#m"><map name="m"><area href="https://evil.test/x" shape="rect" coords="0,0,9,9"></map>',
  };

  // Without a link context only absolute targets survive; with one, relative
  // targets resolve too. The same corpus must be inert both ways.
  const contexts: Array<[string, ReadmeLinkContext | undefined]> = [
    ["no link context", undefined],
    ["/catalog/ link context", CATALOG],
  ];
  for (const [name, input] of Object.entries(corpus)) for (const [mode, links] of contexts) {
    test(`${name} (${mode})`, () => {
      const out = sanitize(input, links);
      expect(out).not.toMatch(/<script|<svg|<math|<style|<iframe|<form|<video|<noscript|<mglyph/i);
      expect(out).not.toMatch(/<input|<button|<textarea|<select|<map|<area/i);
      expect(out).not.toMatch(/\son[a-z]+\s*=/i);
      expect(out).not.toMatch(/javascript:|java\s*script:|data:|srcset|poster|action=|style=|download|usemap/i);
      // Whatever survives re-parses to itself: nothing mutated into markup.
      expect(sanitize(out, links)).toBe(out);
    });
  }

  test("the hostile fixture README, rendered through the real pipeline", () => {
    const out = sanitize(createReadmeMarkdown().render(HOSTILE_README));
    expect(out).not.toMatch(/<script|<svg|<math|<style|<iframe/i);
    expect(out).not.toMatch(/<[a-z][^>]*\son[a-z]+\s*=/i);
    expect(out).not.toMatch(/href="(?:javascript|data|\/|\.)/i);
    expect(out).toContain("alert('script')"); // raw HTML survives only as escaped text
    expect(out).toContain('<a href="https://example.com/ok"');
    expect(sanitize(out)).toBe(out);
  });
});

describe("link policy", () => {
  test("absolute http(s), mailto and #fragment targets survive with the hardened rel", () => {
    for (const href of ["https://example.com/x", "http://example.com/x", "mailto:a@example.com", "#section"]) {
      expect(sanitize(`<a href="${href}">t</a>`)).toBe(
        `<a href="${href}" rel="noopener noreferrer nofollow ugc">t</a>`,
      );
    }
  });

  test("protocol-relative, root-relative and relative links become their text", () => {
    expect(sanitize('<p><a href="//evil.example/x">one</a> <a href="/x">two</a> <a href="./x">three</a></p>')).toBe(
      "<p>one two three</p>",
    );
    expect(sanitize('<a href="x/y">four</a>')).toBe("four");
  });

  test("an unwrapped link keeps its children sanitized (nested markup is still visited)", () => {
    const out = sanitize('<a href="/x"><img src="https://x.test/a.png" onerror="alert(1)"><b onclick="x()">t</b></a>');
    expect(out).not.toMatch(/onerror|onclick/);
    expect(out).toContain("<b>t</b>");
    expect(out).toContain("<img");
  });

  test("an anchor with no href at all is unwrapped too", () => {
    expect(sanitize('<a name="x">t</a>')).toBe("t");
  });
});

describe("image policy", () => {
  test("an absolute https image survives with referrerpolicy, loading and decoding", () => {
    expect(sanitize('<img src="https://example.com/a.png" alt="a">')).toBe(
      '<img src="https://example.com/a.png" alt="a" loading="lazy" decoding="async" referrerpolicy="no-referrer">',
    );
  });

  test("overrides author-supplied referrerpolicy/loading/decoding", () => {
    const out = sanitize('<img src="https://example.com/a.png" referrerpolicy="unsafe-url" loading="eager">');
    expect(out).toContain('referrerpolicy="no-referrer"');
    expect(out).toContain('loading="lazy"');
    expect(out).not.toContain("unsafe-url");
  });

  test("without a link context, protocol-relative, root-relative, relative and mailto: images are dropped", () => {
    for (const src of ["//evil.example/p.png", "/p.png", "./p.png", "p.png", "mailto:a@b.c"]) {
      expect(sanitize(`<p>x<img src="${src}">y</p>`)).toBe("<p>xy</p>");
    }
  });

  test("an image with no src is dropped", () => {
    expect(sanitize('<p>x<img alt="a">y</p>')).toBe("<p>xy</p>");
  });
});

describe("class policy", () => {
  test("keeps highlight.js and language- classes", () => {
    const html = '<pre><code class="language-js"><span class="hljs-keyword">const</span></code></pre>';
    expect(sanitize(html)).toBe(html);
  });

  test("drops other class tokens, keeps the allowed ones, drops an attribute left empty", () => {
    expect(sanitize('<span class="hljs-string evil sr-only">x</span>')).toBe('<span class="hljs-string">x</span>');
    expect(sanitize('<span class="evil">x</span>')).toBe("<span>x</span>");
  });
});

describe("style allowlist (ported)", () => {
  test("isAllowedStyle accepts text-align only", () => {
    expect(isAllowedStyle("text-align:left")).toBe(true);
    expect(isAllowedStyle("text-align: center")).toBe(true);
    expect(isAllowedStyle("--shiki-light:#24292e;--shiki-dark:#e1e4e8")).toBe(false);
    expect(isAllowedStyle("")).toBe(false);
    expect(isAllowedStyle("text-align:left;position:fixed")).toBe(false);
    expect(isAllowedStyle("width:expression(alert(1))")).toBe(false);
    expect(isAllowedStyle("background:url(javascript:alert(1))")).toBe(false);
  });

  test("keeps real markdown-it table alignment, strips every other style (shiki custom properties included)", () => {
    const table = createReadmeMarkdown().render("| L | C | R |\n|:--|:-:|--:|\n| a | b | c |\n");
    expect(table).toContain('style="text-align:left"');
    expect(sanitize(table)).toBe(table);
    const shiki = '<pre><code><span style="--shiki-light:#24292e;--shiki-dark:#e1e4e8">c</span></code></pre>';
    expect(sanitize(shiki)).toBe("<pre><code><span>c</span></code></pre>");
    expect(sanitize('<div style="width:expression(alert(1))">a</div>')).toBe("<div>a</div>");
  });

});

describe("D-088 GFM task-list checkboxes", () => {
  test("D-088 a task-list item keeps a disabled checkbox, checked state included", () => {
    expect(sanitize('<ul><li><input type="checkbox" checked disabled> done</li><li><input type="checkbox"> todo</li></ul>')).toBe(
      '<ul><li><input type="checkbox" checked="" disabled=""> done</li><li><input type="checkbox" disabled=""> todo</li></ul>',
    );
  });

  test("D-088 a checkbox is reduced to type/checked/disabled and is never enabled", () => {
    const out = sanitize(
      '<input type="CHECKBOX" name="x" value="v" src="https://evil.test/p.png" onclick="alert(1)" formaction="https://evil.test/x">',
    );
    expect(out).toBe('<input type="checkbox" disabled="">');
    expect(sanitize(out)).toBe(out);
  });

  test("D-088 every other input is removed", () => {
    for (const input of [
      '<input type="image" src="https://evil.test/p.png">',
      '<input type="text" value="x">',
      '<input type="submit" formaction="https://evil.test/x">',
      "<input>",
    ]) {
      expect(sanitize(`<p>a${input}b</p>`)).toBe("<p>ab</p>");
    }
  });
});

describe("highlight.js output survives", () => {
  test("a fenced js block keeps its hljs token classes and is idempotent", () => {
    const rendered = createReadmeMarkdown().render("```js\nconst x = 1;\n```\n");
    expect(rendered).toContain('class="hljs-keyword"');
    expect(sanitize(rendered)).toBe(rendered);
  });
});

describe("class policy", () => {
  test("D-178 hljs classes survive on code and span only, on no other element", () => {
    expect(sanitize('<div class="hljs-keyword"><p class="language-js">x</p><a href="https://x.test/" class="hljs-string">y</a></div>')).toBe(
      '<div><p>x</p><a href="https://x.test/" rel="noopener noreferrer nofollow ugc">y</a></div>',
    );
  });

  test("only whole hljs / language- tokens survive", () => {
    expect(sanitize('<code class="hljs language-js hljs-keyword other">x</code>')).toBe(
      '<code class="hljs language-js hljs-keyword">x</code>',
    );
    expect(sanitize('<code class="language-c++ language-c#">x</code>')).toBe('<code class="language-c++ language-c#">x</code>');
  });

  test("a fence info string cannot smuggle markup through the language- prefix", () => {
    const rendered = createReadmeMarkdown().render('```"><img src=x onerror=alert(1)>\ncode\n```\n');
    const out = sanitize(rendered);
    // The info string is not a language, so the fence is auto-detected: hljs token classes only.
    expect(out).not.toMatch(/language-/);
    expect(out).not.toMatch(/<img/i);
    expect(sanitize('<code class="language-&quot;><img">x</code>')).toBe("<code>x</code>");
    expect(sanitize('<code class="language-">x</code>')).toBe("<code>x</code>");
  });
});

describe("recycling", () => {
  test("the window and purifier are replaced every recycleAfter documents, hooks intact, old window closed", () => {
    const windows: ReadmeWindow[] = [];
    const closeSpies: ReturnType<typeof vi.spyOn>[] = [];
    const factory = (): ReadmeWindow => {
      const window = newWindow();
      windows.push(window);
      closeSpies.push(vi.spyOn(window, "close"));
      return window;
    };
    const recycling = createReadmeSanitizer(factory, { recycleAfter: 3 });
    const hostile = '<a href="/x">t</a><img src="/y"><script>alert(1)</script>';
    const outputs: string[] = [];
    for (let i = 0; i < 7; i++) outputs.push(recycling.sanitize(hostile));
    // docs 1-3 on window 0, 4-6 on window 1, 7 on window 2
    expect(windows).toHaveLength(3);
    expect(closeSpies[0]).toHaveBeenCalledTimes(1);
    expect(closeSpies[1]).toHaveBeenCalledTimes(1);
    expect(closeSpies[2]).not.toHaveBeenCalled();
    // Every document, before and after each recycle, got the same policy.
    expect(new Set(outputs)).toEqual(new Set(["t"]));
  });

  test("close() closes the current window and no other", () => {
    const closeSpies: ReturnType<typeof vi.spyOn>[] = [];
    const closing = createReadmeSanitizer(() => {
      const window = newWindow();
      closeSpies.push(vi.spyOn(window, "close"));
      return window;
    });
    closing.close();
    expect(closeSpies).toHaveLength(1);
    expect(closeSpies[0]).toHaveBeenCalledTimes(1);
  });

  test("the default recycle interval is 500 documents", () => {
    const factory = vi.fn(newWindow);
    const defaulted = createReadmeSanitizer(factory);
    for (let i = 0; i < 500; i++) defaulted.sanitize("<p>x</p>");
    expect(factory).toHaveBeenCalledTimes(1);
    defaulted.sanitize("<p>x</p>");
    expect(factory).toHaveBeenCalledTimes(2);
  });
});

describe("D-179 relative, root-relative, protocol-relative and data: targets", () => {
  const rel = 'rel="noopener noreferrer nofollow ugc"';
  const link = (href: string, links: ReadmeLinkContext | undefined = CATALOG): string =>
    sanitize(`<a href="${href}">t</a>`, links);

  test("D-179 a relative link resolves against the package's wire directory, base-joined", () => {
    expect(link("docs/guide.md")).toBe(`<a href="/catalog/p/acme/tool/docs/guide.md" ${rel}>t</a>`);
    expect(link("./x")).toBe(`<a href="/catalog/p/acme/tool/x" ${rel}>t</a>`);
    expect(link("../other/x")).toBe(`<a href="/catalog/p/acme/other/x" ${rel}>t</a>`);
    expect(link("?q=1#frag")).toBe(`<a href="/catalog/p/acme/tool/?q=1#frag" ${rel}>t</a>`);
  });

  test("D-179 a root-relative link is read against the package, never the host root", () => {
    expect(link("/x")).toBe(`<a href="/catalog/p/acme/tool/x" ${rel}>t</a>`);
    expect(link("/docs/a.md#s")).toBe(`<a href="/catalog/p/acme/tool/docs/a.md#s" ${rel}>t</a>`);
    // `/http://…` stays a path under the package, not a new origin.
    expect(link("/http://evil.example/x")).toBe(`<a href="/catalog/p/acme/tool/http://evil.example/x" ${rel}>t</a>`);
  });

  test("a relative link to a script-capable document type dies; an image of that type survives", () => {
    for (const name of ["a.svg", "a.SVGZ", "a.html", "a.htm", "a.xhtml", "a.xml", "a.mht", "a.svg?x=1#f"]) {
      expect(link(name), name).toBe("t");
    }
    expect(sanitize('<img src="a.svg">', CATALOG)).toContain('src="/catalog/p/acme/tool/a.svg"');
    expect(link("guide.md")).toBe(`<a href="/catalog/p/acme/tool/guide.md" ${rel}>t</a>`);
  });

  test("a data: image over 256 KiB is dropped, one under survives", () => {
    const uri = (n: number): string => `data:image/png;base64,${"A".repeat(n)}`;
    expect(sanitize(`<img src="${uri(100)}">`)).toContain("<img");
    expect(sanitize(`<img src="${uri(256 * 1024 + 1)}">`)).not.toContain("src");
  });

  test("D-179 an index mounted under index/<label> lands under its own sandboxed p/ prefix", () => {
    expect(link("x.png", INDEXED)).toBe(`<a href="/index/lbl/p/acme/tool/x.png" ${rel}>t</a>`);
    expect(link("/x", INDEXED)).toBe(`<a href="/index/lbl/p/acme/tool/x" ${rel}>t</a>`);
    expect(link("../../../x", INDEXED)).toBe("t"); // /index/lbl/x: outside p/
  });

  test("D-179 a path that would leave the sandboxed p/ prefix becomes its text", () => {
    for (const href of [
      "../../../x",
      "../../../../etc/passwd",
      "%2e%2e/%2e%2e/%2e%2e/x",
      "..%2f..%2f..%2fx", // an encoded slash is data, not a separator: stays inside, see below
      "/../../../x",
      "\\..\\..\\..\\x",
    ]) {
      const out = link(href);
      if (href.startsWith("..%2f")) expect(out).toContain('href="/catalog/p/acme/tool/..%2f..%2f..%2fx"');
      else expect(out, href).toBe("t");
    }
  });

  test("D-179 a protocol-relative link is an https link to that host", () => {
    expect(link("//evil.example/x?a=1")).toBe(`<a href="https://evil.example/x?a=1" ${rel}>t</a>`);
    // A backslash is a slash to the URL parser, so `/\host` is protocol-relative too.
    expect(link("/\\evil.example/x")).toBe(`<a href="https://evil.example/x" ${rel}>t</a>`);
  });

  test("D-179 an unparseable target becomes its text", () => {
    expect(link("//")).toBe("t");
    expect(link("ftp://[")).toBe("t");
  });

  test("D-179 the scheme allow-list holds: javascript:, vbscript:, data: and friends die with a context", () => {
    for (const href of [
      "javascript:alert(1)",
      "  JaVaScRiPt:alert(1)",
      "\u0001javascript:alert(1)",
      "java&#9;script:alert(1)",
      "&#x6a;avascript:alert(1)",
      "vbscript:msgbox(1)",
      "data:text/html,<script>alert(1)</script>",
      "data:image/png;base64,AAAA", // a data: URI is an image source, never a link target
      "file:///etc/passwd",
      "blob:https://x.test/1",
      "",
    ]) {
      expect(link(href), href).toBe("t");
    }
  });

  test("D-179 absolute http(s), mailto and #fragment links are untouched by a context", () => {
    for (const href of ["https://example.com/x", "http://example.com/x", "mailto:a@example.com", "#section"]) {
      expect(link(href)).toBe(`<a href="${href}" ${rel}>t</a>`);
    }
  });

  test("D-179 a relative target survives only when the mirror wrote that file; otherwise a link is its text", () => {
    const mirrored = onlyMirrored("p/acme/tool/o/sha256/logo.png", "p/acme/other.json");
    expect(link("o/sha256/logo.png", mirrored)).toBe(`<a href="/catalog/p/acme/tool/o/sha256/logo.png" ${rel}>t</a>`);
    expect(link("/o/sha256/logo.png", mirrored)).toBe(`<a href="/catalog/p/acme/tool/o/sha256/logo.png" ${rel}>t</a>`);
    expect(link("../other.json", mirrored)).toBe(`<a href="/catalog/p/acme/other.json" ${rel}>t</a>`);
    expect(link("LICENSE", mirrored)).toBe("t");
    expect(link("docs/guide.md", mirrored)).toBe("t");
    expect(link("../../../x", mirrored)).toBe("t");
  });

  test("D-179 an unmirrored relative image is dropped, a mirrored one survives", () => {
    const mirrored = onlyMirrored("p/acme/tool/o/sha256/logo.svg");
    expect(sanitize('<p>x<img src="logo.png">y</p>', mirrored)).toBe("<p>xy</p>");
    expect(sanitize('<img src="o/sha256/logo.svg">', mirrored)).toContain('src="/catalog/p/acme/tool/o/sha256/logo.svg"');
  });

  test("D-179 the mirror is asked for the encoded, base-stripped path, and only for paths inside the sandbox", () => {
    const asked: string[] = [];
    const spy: ReadmeLinkContext = { ...CATALOG, mirrored: (path) => (asked.push(path), true) };
    sanitize('<a href="a b.png">1</a><a href="../../../x">2</a><a href="https://example.com/">3</a>', spy);
    expect(asked).toEqual(["p/acme/tool/a%20b.png"]);
  });

  test("D-179 a README whose location is not a CAS path keeps only absolute targets", () => {
    const odd: ReadmeLinkContext = { base: "/", readmeUrl: "/p/x.md", mirrored: () => true };
    expect(link("docs/x", odd)).toBe("t");
    expect(link("https://example.com/x", odd)).toBe(`<a href="https://example.com/x" ${rel}>t</a>`);
  });

  test("D-179 relative, root-relative and protocol-relative images survive resolved, with the no-referrer policy", () => {
    const attrs = 'loading="lazy" decoding="async" referrerpolicy="no-referrer"';
    expect(sanitize('<img src="logo.png" alt="a">', CATALOG)).toBe(
      `<img src="/catalog/p/acme/tool/logo.png" alt="a" ${attrs}>`,
    );
    expect(sanitize('<img src="/img/a.png">', INDEXED)).toBe(`<img src="/index/lbl/p/acme/tool/img/a.png" ${attrs}>`);
    expect(sanitize('<img src="//cdn.example/a.png">', CATALOG)).toBe(`<img src="https://cdn.example/a.png" ${attrs}>`);
    expect(sanitize('<p>x<img src="../../../x.png">y</p>', CATALOG)).toBe("<p>xy</p>");
    expect(sanitize('<p>x<img src="javascript:alert(1)">y</p>', CATALOG)).toBe("<p>xy</p>");
    expect(sanitize('<p>x<img src="mailto:a@b.c">y</p>', CATALOG)).toBe("<p>xy</p>");
  });

  test("D-179 a base64 raster or svg data: image survives, with or without a context", () => {
    for (const src of [
      "data:image/png;base64,iVBORw0KGgo=",
      "data:image/jpeg;base64,/9j/4AAQ",
      "data:image/gif;base64,R0lGODlh",
      "data:image/webp;base64,UklGRg==",
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    ]) {
      for (const links of [undefined, CATALOG]) {
        expect(sanitize(`<img src="${src}">`, links), src).toContain(`src="${src}"`);
      }
    }
  });

  test("D-179 any other data: image dies: non-image MIME, non-base64 body, payload after the base64", () => {
    for (const src of [
      "data:text/html;base64,PHNjcmlwdD4=",
      "data:image/svg+xml,<svg onload=alert(1)>",
      "data:image/png,AAAA",
      "data:image/png;base64,AAAA\" onerror=\"alert(1)",
      "data:image/x-icon;base64,AAAA",
    ]) {
      expect(sanitize(`<p>x<img src='${src}'>y</p>`, CATALOG), src).toBe("<p>xy</p>");
    }
  });

  test("D-179 sanitizing twice with the same context is a fixed point", () => {
    const corpus = [
      '<a href="docs/guide.md">a</a><a href="/x">b</a><a href="//h.example/p">c</a><a href="../o/x#y">d</a>',
      '<img src="a b.png"><img src="/p/acme/tool/z.png"><img src="//c.example/i.png">',
      '<a href="x y?q=a b#f g">e</a>',
    ];
    for (const links of [CATALOG, INDEXED]) {
      for (const input of corpus) {
        const once = sanitize(input, links);
        expect(sanitize(once, links), input).toBe(once);
      }
    }
  });

  test("D-179 the hostile fixture README stays inert with a context, and its relative links now resolve", () => {
    const out = sanitize(createReadmeMarkdown().render(HOSTILE_README), CATALOG);
    expect(out).not.toMatch(/<script|<svg|<math|<style|<iframe/i);
    expect(out).not.toMatch(/<[a-z][^>]*\son[a-z]+\s*=/i);
    expect(out).not.toMatch(/(?:href|src)="\s*(?:javascript|vbscript|data):/i);
    expect(out).toContain('<a href="https://evil.example/x"');
    expect(out).toContain('<a href="/catalog/p/acme/tool/x"');
    expect(out).toContain('<a href="https://example.com/ok"');
    expect(sanitize(out, CATALOG)).toBe(out);
  });
});
