import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import { describe, expect, test, vi } from "vitest";
import {
  createReadmeSanitizer,
  isAllowedStyle,
  SANITIZE_CONFIG,
  type ReadmeWindow,
} from "../../../src/site/lib/readmeSanitizer.js";
import { createReadmeMarkdown } from "../../../src/site/lib/readmeMarkdown.js";

// Real jsdom windows, never a global: what the build injects.
const newWindow = (): ReadmeWindow => new JSDOM("").window as unknown as ReadmeWindow;
const sanitizer = createReadmeSanitizer(newWindow);
const sanitize = (html: string): string => sanitizer.sanitize(html);

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

  for (const [name, input] of Object.entries(corpus)) {
    test(name, () => {
      const out = sanitize(input);
      expect(out).not.toMatch(/<script|<svg|<math|<style|<iframe|<form|<video|<noscript|<mglyph/i);
      expect(out).not.toMatch(/<input|<button|<textarea|<select|<map|<area/i);
      expect(out).not.toMatch(/\son[a-z]+\s*=/i);
      expect(out).not.toMatch(/javascript:|java\s*script:|data:|srcset|poster|action=|style=|download|usemap/i);
      // Whatever survives re-parses to itself: nothing mutated into markup.
      expect(sanitize(out)).toBe(out);
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

  test("protocol-relative, root-relative, relative, data: and mailto: images are dropped", () => {
    for (const src of ["//evil.example/p.png", "/p.png", "./p.png", "p.png", "data:image/png;base64,AAAA", "mailto:a@b.c"]) {
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
  test("isAllowedStyle accepts text-align and the shiki custom properties only", () => {
    expect(isAllowedStyle("text-align:left")).toBe(true);
    expect(isAllowedStyle("text-align: center")).toBe(true);
    expect(isAllowedStyle("--shiki-light:#24292e;--shiki-dark:#e1e4e8")).toBe(true);
    expect(isAllowedStyle("")).toBe(false);
    expect(isAllowedStyle("text-align:left;position:fixed")).toBe(false);
    expect(isAllowedStyle("width:expression(alert(1))")).toBe(false);
    expect(isAllowedStyle("background:url(javascript:alert(1))")).toBe(false);
  });

  test("keeps real markdown-it table alignment and shiki spans, strips everything else", () => {
    const table = createReadmeMarkdown().render("| L | C | R |\n|:--|:-:|--:|\n| a | b | c |\n");
    expect(table).toContain('style="text-align:left"');
    expect(sanitize(table)).toBe(table);
    const shiki = '<pre><code><span style="--shiki-light:#24292e;--shiki-dark:#e1e4e8">c</span></code></pre>';
    expect(sanitize(shiki)).toBe(shiki);
    expect(sanitize('<div style="width:expression(alert(1))">a</div>')).toBe("<div>a</div>");
  });

  test("drops form controls: a task-list checkbox is no longer an allowed element", () => {
    expect(sanitize('<ul><li><input type="checkbox" checked disabled> done</li></ul>')).toBe("<ul><li> done</li></ul>");
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
  test("only whole hljs / language- tokens survive", () => {
    expect(sanitize('<code class="hljs language-js hljs-keyword other">x</code>')).toBe(
      '<code class="hljs language-js hljs-keyword">x</code>',
    );
    expect(sanitize('<code class="language-c++ language-c#">x</code>')).toBe('<code class="language-c++ language-c#">x</code>');
  });

  test("a fence info string cannot smuggle markup through the language- prefix", () => {
    const rendered = createReadmeMarkdown().render('```"><img src=x onerror=alert(1)>\ncode\n```\n');
    const out = sanitize(rendered);
    expect(out).not.toMatch(/class=/);
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
