// @vitest-environment jsdom
//
// The one deliberate exception to this package's happy-dom default (see
// `sanitize.ts`'s header docblock) — DOMPurify silently drops content under
// happy-dom (verified empirically: it drops the sanitized root element and
// strips `<input>` outright), so this file opts into jsdom instead.
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js/lib/common'
import { describe, expect, test, vi } from 'vitest'
import { SANITIZE_CONFIG, sanitizeReadmeHtml } from '../../../src/theme/utils/sanitize.js'

// Mirrors `ReadmePane.vue`'s actual markdown-it + highlight.js wiring
// exactly (see that file's `load()`) — the two real-pipeline preservation
// cases below render through this instead of a hand-built fixture.
const md = new MarkdownIt({
  html: false,
  highlight: (code: string, lang: string) => {
    try {
      if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value
      return hljs.highlightAuto(code).value
    } catch {
      return ''
    }
  },
})

describe('SANITIZE_CONFIG', () => {
  test('uses the html profile and declares the GFM checkbox allowlist', () => {
    expect(SANITIZE_CONFIG.USE_PROFILES).toEqual({ html: true })
    expect(SANITIZE_CONFIG.ADD_TAGS).toContain('input')
    expect(SANITIZE_CONFIG.ADD_ATTR).toEqual(expect.arrayContaining(['type', 'checked', 'disabled']))
    expect(SANITIZE_CONFIG.FORBID_TAGS).toContain('style')
  })
})

describe('sanitizeReadmeHtml — XSS corpus', () => {
  test('strips <script> tags, keeps surrounding text', () => {
    const out = sanitizeReadmeHtml('<p>hello</p><script>alert(document.cookie)</script><p>world</p>')
    expect(out).not.toMatch(/<script/i)
    expect(out).not.toContain('alert(')
    expect(out).toContain('hello')
    expect(out).toContain('world')
  })

  test('strips on* event handlers, keeps the element and its content', () => {
    const out = sanitizeReadmeHtml('<img src="/x.png" onerror="alert(1)"><div onclick="alert(1)">click me</div>')
    expect(out).not.toMatch(/onerror/i)
    expect(out).not.toMatch(/onclick/i)
    expect(out).toContain('src="/x.png"')
    expect(out).toContain('click me')
  })

  test('strips javascript: hrefs, keeps the link text', () => {
    const out = sanitizeReadmeHtml('<a href="javascript:alert(1)">click</a>')
    expect(out).not.toMatch(/javascript:/i)
    expect(out).toContain('click')
  })

  test('strips javascript: with case/whitespace obfuscation', () => {
    const out = sanitizeReadmeHtml('<a href="&#x6a;avascript:alert(1)">x</a><a href="  JaVaScRiPt:alert(1)">y</a>')
    expect(out).not.toMatch(/javascript:/i)
  })

  test('drops <iframe>, <object>, <embed> entirely, keeps surrounding text', () => {
    const out = sanitizeReadmeHtml(
      '<p>before</p><iframe src="https://evil.test"></iframe>' +
        '<object data="https://evil.test/x.swf"></object>' +
        '<embed src="https://evil.test/x.swf">' +
        '<p>after</p>',
    )
    expect(out).not.toMatch(/<iframe/i)
    expect(out).not.toMatch(/<object/i)
    expect(out).not.toMatch(/<embed/i)
    expect(out).toContain('before')
    expect(out).toContain('after')
  })

  test('drops SVG-borne script (<svg onload>) entirely', () => {
    const out = sanitizeReadmeHtml('<p>before</p><svg onload="alert(1)"><circle/></svg><p>after</p>')
    expect(out).not.toMatch(/<svg/i)
    expect(out).not.toMatch(/onload/i)
    expect(out).toContain('before')
    expect(out).toContain('after')
  })

  test('drops <math> namespace-confusion payloads entirely', () => {
    const out = sanitizeReadmeHtml('<p>before</p><math><mtext><script>alert(1)</script></mtext></math><p>after</p>')
    expect(out).not.toMatch(/<math/i)
    expect(out).not.toMatch(/<script/i)
    expect(out).toContain('before')
    expect(out).toContain('after')
  })

  test('strips data: URIs from href (non-image data URIs are not a legitimate link target)', () => {
    const out = sanitizeReadmeHtml('<a href="data:text/html,<script>alert(1)</script>">click</a>')
    expect(out).not.toMatch(/data:text\/html/i)
    expect(out).not.toMatch(/<script/i)
    expect(out).toContain('click')
  })

  test('DOM-clobbering: strips id/name attributes with dangerous global-property values', () => {
    const out = sanitizeReadmeHtml('<div id="location">x</div><img name="location" src="/x.png">')
    expect(out).not.toContain('id="location"')
    expect(out).not.toContain('name="location"')
    // A benign id on an unrelated element survives — proves this is
    // value-targeted DOM-clobbering protection, not a blanket id/name strip.
    expect(sanitizeReadmeHtml('<div id="section-1">x</div>')).toContain('id="section-1"')
  })

  test('style-based exfil: strips CSS expression()/url() constructs from style', () => {
    const out = sanitizeReadmeHtml(
      '<div style="width:expression(alert(1))">a</div>' +
        '<div style="background:url(javascript:alert(1))">b</div>',
    )
    expect(out).not.toMatch(/expression\(/i)
    expect(out).not.toMatch(/style="[^"]*url\(/i)
    expect(out).toContain('a')
    expect(out).toContain('b')
  })

  test('drops <meta>/<base> tag injection entirely', () => {
    const out = sanitizeReadmeHtml(
      '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">' +
        '<base href="https://evil.test/">' +
        '<a href="/x">rel</a><p>after</p>',
    )
    expect(out).not.toMatch(/<meta/i)
    expect(out).not.toMatch(/<base/i)
    // the base tag must not have survived to redirect this relative href
    expect(out).toContain('href="/x"')
    expect(out).toContain('after')
  })

  // Regression pin: DOMPurify's default profile allows the `<style>` TAG
  // (verified in its own source — surprising, since `<style>` is a genuine
  // CSS-exfil vector via `background:url()`/attribute selectors, and
  // markdown-it's output never legitimately needs one). `FORBID_TAGS`
  // closes that gap explicitly — this test trips if a future config change
  // (e.g. someone adding `'style'` back via `ADD_TAGS`, or dropping
  // `FORBID_TAGS`) reopens it, instead of shipping CSS injection silently.
  // Two positions on purpose: an earlier probe found DOMPurify's own default
  // (without `FORBID_TAGS`) strips a *leading* `<style>` under jsdom but
  // keeps one with a preceding sibling — a parse5 parsing quirk, not a real
  // security property — so this asserts removal in both shapes.
  test('regression pin: <style> tag blocks are always stripped, any sibling position', () => {
    const leading = sanitizeReadmeHtml('<style>body{background:url(https://evil.test/exfil)}</style><p>after</p>')
    const withSibling = sanitizeReadmeHtml(
      '<p>before</p><style>body{background:url(https://evil.test/exfil)}</style><p>after</p>',
    )
    expect(leading).not.toMatch(/<style/i)
    expect(leading).toContain('after')
    expect(withSibling).not.toMatch(/<style/i)
    expect(withSibling).toContain('before')
    expect(withSibling).toContain('after')
  })
})

describe('sanitizeReadmeHtml — preservation corpus', () => {
  test('keeps GFM tables intact', () => {
    const html = '<table><thead><tr><th>Flag</th><th>Meaning</th></tr></thead>' +
      '<tbody><tr><td>-v</td><td>verbose</td></tr></tbody></table>'
    expect(sanitizeReadmeHtml(html)).toBe(html)
  })

  test('keeps GFM task-list checkboxes (disabled, checked state preserved)', () => {
    const out = sanitizeReadmeHtml('<ul><li><input type="checkbox" checked disabled> done</li>' +
      '<li><input type="checkbox" disabled> todo</li></ul>')
    expect(out).toContain('type="checkbox"')
    expect(out).toContain('checked')
    expect(out).toContain('disabled')
    expect(out).toContain('done')
    expect(out).toContain('todo')
  })

  test('keeps Shiki-style dual-theme span styling exactly as the research allows', () => {
    const html = '<pre><code><span style="--shiki-light:#24292e;--shiki-dark:#e1e4e8">const x</span></code></pre>'
    expect(sanitizeReadmeHtml(html)).toBe(html)
  })

  test('keeps legit relative and https links', () => {
    const html = '<a href="/relative/path">rel</a><a href="https://example.test/x">abs</a>'
    expect(sanitizeReadmeHtml(html)).toBe(html)
  })

  test('keeps images with relative src', () => {
    const html = '<img src="/relative/logo.png">'
    expect(sanitizeReadmeHtml(html)).toBe(html)
  })

  test('keeps real markdown-it GFM table column alignment (text-align)', () => {
    const rendered = md.render('| L | C | R |\n|:--|:-:|--:|\n| a | b | c |\n')
    // sanity-check the fixture is exercising what it claims to before
    // trusting the sanitize assertion below.
    expect(rendered).toContain('style="text-align:left"')
    expect(rendered).toContain('style="text-align:center"')
    expect(rendered).toContain('style="text-align:right"')
    expect(sanitizeReadmeHtml(rendered)).toBe(rendered)
  })

  test('keeps real highlight.js class spans from a fenced code block', () => {
    const rendered = md.render('```js\nconst x = 1;\n```\n')
    expect(rendered).toContain('class="hljs-keyword"')
    expect(sanitizeReadmeHtml(rendered)).toBe(rendered)
  })
})

describe('sanitizeReadmeHtml — idempotence', () => {
  const corpus = [
    '<p>hello</p><script>alert(1)</script>',
    '<img src="/x.png" onerror="alert(1)">',
    '<a href="javascript:alert(1)">click</a>',
    '<svg onload="alert(1)"><circle/></svg><p>after</p>',
    '<div style="width:expression(alert(1))">a</div>',
    '<div id="location">x</div>',
    '<ul><li><input type="checkbox" checked disabled> done</li></ul>',
    '<pre><code><span style="--shiki-light:#24292e;--shiki-dark:#e1e4e8">const x</span></code></pre>',
    '<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table>',
  ]

  for (const input of corpus) {
    test(`sanitize(sanitize(x)) === sanitize(x) for: ${input.slice(0, 40)}…`, () => {
      const once = sanitizeReadmeHtml(input)
      const twice = sanitizeReadmeHtml(once)
      expect(twice).toBe(once)
    })
  }
})

describe('sanitizeReadmeHtml — SSR guard', () => {
  test('builds the DOMPurify instance lazily and sanitizes normally when window is defined', () => {
    expect(sanitizeReadmeHtml('<p>hi</p><script>alert(1)</script>')).toBe('<p>hi</p>')
  })

  test('throws instead of an unsanitized pass-through when window is undefined (SSR/Node)', () => {
    vi.stubGlobal('window', undefined)
    try {
      // the dangerous alternative this guard exists to prevent: silently
      // returning `payload` itself, unsanitized — `toThrow` proves the
      // function never reaches its `return` at all.
      expect(() => sanitizeReadmeHtml('<script>alert(document.cookie)</script>')).toThrow(/client-only/)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
