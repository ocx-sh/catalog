import { JSDOM } from 'jsdom'
import hljs from 'highlight.js/lib/common'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createReadmeMarkdown } from '../../../src/site/lib/readmeMarkdown.js'
import { createReadmeSanitizer, type ReadmeWindow } from '../../../src/site/lib/readmeSanitizer.js'

const render = (src: string) => createReadmeMarkdown().render(src)

afterEach(() => {
  vi.restoreAllMocks()
})

describe('HTML comments are dropped silently', () => {
  test('a block comment on its own line vanishes', () => {
    const out = render('before\n\n<!-- hidden note -->\n\nafter')
    expect(out).not.toContain('hidden note')
    expect(out).not.toContain('&lt;!--')
    expect(out).toBe('<p>before</p>\n<p>after</p>\n')
  })

  test('a multi-line block comment (with a blank line inside) vanishes', () => {
    const out = render('before\n\n<!--\nline one\n\nline two\n-->\n\nafter')
    expect(out).not.toContain('line one')
    expect(out).not.toContain('line two')
    expect(out).toBe('<p>before</p>\n<p>after</p>\n')
  })

  test('a block comment directly after a paragraph line interrupts it', () => {
    expect(render('text\n<!-- c -->\nmore')).toBe('<p>text</p>\n<p>more</p>\n')
  })

  test('an inline comment inside a sentence vanishes, surrounding text stays', () => {
    const out = render('keep <!-- secret --> this')
    expect(out).not.toContain('secret')
    expect(out).toBe('<p>keep  this</p>\n')
  })

  test('a comment followed by text on the same line drops only the comment', () => {
    expect(render('<!-- c --> visible')).toBe('<p> visible</p>\n')
  })

  test('a multi-line inline comment inside a paragraph vanishes', () => {
    const out = render('one <!-- two\nthree --> four')
    expect(out).not.toContain('two')
    expect(out).not.toContain('three')
    expect(out).toContain('one')
    expect(out).toContain('four')
  })

  test('a comment inside a blockquote vanishes', () => {
    const out = render('> <!-- c -->\n> quoted')
    expect(out).not.toContain('c -->')
    expect(out).toContain('quoted')
  })

  test('an unterminated comment stays literal (escaped), never swallowing the rest', () => {
    const out = render('<!-- never closed\n\nstill here')
    expect(out).toContain('&lt;!-- never closed')
    expect(out).toContain('still here')
  })

  test('an unterminated inline comment stays literal', () => {
    expect(render('a <!-- b')).toBe('<p>a &lt;!-- b</p>\n')
  })

  test('a comment whose close lies outside the enclosing container stays literal', () => {
    const out = render('> <!-- open\n\ntext -->')
    expect(out).toContain('&lt;!-- open')
    expect(out).toContain('text --&gt;')
  })
})

describe('comments inside code are preserved verbatim', () => {
  test('inside a fenced block', () => {
    const out = render('```html\n<!-- keep me -->\n<p>x</p>\n```')
    expect(out).toContain('keep me')
    expect(out).toContain('&lt;')
  })

  test('inside a fence with no language', () => {
    expect(render('```\n<!-- keep me -->\n```')).toContain('keep me')
  })

  test('inside an inline code span', () => {
    expect(render('use `<!-- marker -->` here')).toBe(
      '<p>use <code>&lt;!-- marker --&gt;</code> here</p>\n',
    )
  })

  test('inside an indented code block', () => {
    expect(render('    <!-- keep me -->')).toContain('keep me')
  })
})

describe('raw HTML still never renders', () => {
  test('a non-comment HTML tag is escaped, as before', () => {
    const out = render('<div>hi</div>\n\ntext <b>bold</b>')
    expect(out).toContain('&lt;div&gt;hi&lt;/div&gt;')
    expect(out).toContain('&lt;b&gt;bold&lt;/b&gt;')
    expect(out).not.toMatch(/<div|<b>/)
  })

  test('a comment cannot smuggle a tag out of itself', () => {
    const out = render('<!-- <script>alert(1)</script> -->')
    expect(out).not.toContain('script')
  })
})

describe('emoji shortcodes', () => {
  test(':rocket: renders as the unicode emoji', () => {
    expect(render('ship it :rocket:')).toBe('<p>ship it 🚀</p>\n')
  })

  test('an unknown shortcode stays literal', () => {
    expect(render('a :notanemoji: b')).toBe('<p>a :notanemoji: b</p>\n')
  })

  test('shortcodes inside a fence stay literal', () => {
    const out = render('```text\n:rocket:\n```')
    expect(out).toContain(':rocket:')
    expect(out).not.toContain('🚀')
  })

  test('shortcodes inside inline code stay literal', () => {
    expect(render('`:rocket:`')).toBe('<p><code>:rocket:</code></p>\n')
  })

  test('text smileys are NOT converted (shortcodes only, like GitHub)', () => {
    expect(render('fine :) and :D and http://x.y')).toBe('<p>fine :) and :D and http://x.y</p>\n')
  })

  test('the sanitizer keeps the emoji through to the set:html string', () => {
    const sanitizer = createReadmeSanitizer(() => new JSDOM('').window as unknown as ReadmeWindow)
    const out = sanitizer.sanitize(render('# Go :tada:\n\nlaunch :rocket:'))
    expect(out).toContain('🎉')
    expect(out).toContain('🚀')
  })
})

describe('highlighting', () => {
  test('a fence with a known language gets hljs spans', () => {
    expect(render('```js\nconst a = 1\n```')).toContain('hljs-keyword')
  })

  test('a fence with no language, or an unknown one, is plain escaped text (no auto-detection)', () => {
    const autoSpy = vi.spyOn(hljs, 'highlightAuto')
    const plain = render('```\nconst a = 1 < 2\n```')
    expect(plain).toContain('<pre><code>const a = 1 &lt; 2')
    expect(plain).not.toContain('hljs-')
    expect(render('```nonesuch\nconst a = 1\n```')).not.toContain('hljs-')
    expect(autoSpy).not.toHaveBeenCalled()
  })

  test('a highlighter failure falls back to an escaped plain block', () => {
    vi.spyOn(hljs, 'highlight').mockImplementation(() => {
      throw new Error('boom')
    })
    const out = render('```js\n<b>x</b>\n```')
    expect(out).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(out).not.toContain('hljs-')
  })
})
