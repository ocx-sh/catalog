import { JSDOM } from 'jsdom'
import hljs from 'highlight.js/lib/common'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { renderReadmeMarkdown } from '../../../src/site/lib/readmeMarkdown.js'
import { createReadmeSanitizer, type ReadmeWindow } from '../../../src/site/lib/readmeSanitizer.js'

const render = (src: string) => renderReadmeMarkdown(src)

afterEach(() => {
  vi.restoreAllMocks()
})

describe('HTML comments are dropped silently', () => {
  test('a block comment on its own line vanishes', async () => {
    const out = await render('before\n\n<!-- hidden note -->\n\nafter')
    expect(out).not.toContain('hidden note')
    expect(out).not.toContain('&lt;!--')
    expect(out).toBe('<p>before</p>\n<p>after</p>\n')
  })

  test('a multi-line block comment (with a blank line inside) vanishes', async () => {
    const out = await render('before\n\n<!--\nline one\n\nline two\n-->\n\nafter')
    expect(out).not.toContain('line one')
    expect(out).not.toContain('line two')
    expect(out).toBe('<p>before</p>\n<p>after</p>\n')
  })

  test('a block comment directly after a paragraph line interrupts it', async () => {
    expect(await render('text\n<!-- c -->\nmore')).toBe('<p>text</p>\n<p>more</p>\n')
  })

  test('an inline comment inside a sentence vanishes, surrounding text stays', async () => {
    const out = await render('keep <!-- secret --> this')
    expect(out).not.toContain('secret')
    expect(out).toBe('<p>keep  this</p>\n')
  })

  test('a comment followed by text on the same line drops only the comment', async () => {
    expect(await render('<!-- c --> visible')).toBe(' visible\n')
  })

  test('a multi-line inline comment inside a paragraph vanishes', async () => {
    const out = await render('one <!-- two\nthree --> four')
    expect(out).not.toContain('two')
    expect(out).not.toContain('three')
    expect(out).toContain('one')
    expect(out).toContain('four')
  })

  test('a comment inside a blockquote vanishes', async () => {
    const out = await render('> <!-- c -->\n> quoted')
    expect(out).not.toContain('c -->')
    expect(out).toContain('quoted')
  })

  test('an unterminated comment stays literal (escaped), never swallowing the rest', async () => {
    const out = await render('<!-- never closed\n\nstill here')
    expect(out).toContain('&lt;!-- never closed')
    expect(out).toContain('still here')
  })

  test('an unterminated inline comment stays literal', async () => {
    expect(await render('a <!-- b')).toBe('<p>a &lt;!-- b</p>\n')
  })

  test('a comment whose close lies outside the enclosing container stays literal', async () => {
    const out = await render('> <!-- open\n\ntext -->')
    expect(out).toContain('&lt;!-- open')
    expect(out).toContain('text --&gt;')
  })
})

describe('comments inside code are preserved verbatim', () => {
  test('inside a fenced block', async () => {
    const out = await render('```html\n<!-- keep me -->\n<p>x</p>\n```')
    expect(out).toContain('keep me')
    expect(out).toContain('&lt;')
  })

  test('inside a fence with no language', async () => {
    expect(await render('```\n<!-- keep me -->\n```')).toContain('keep me')
  })

  test('inside an inline code span', async () => {
    expect(await render('use `<!-- marker -->` here')).toBe(
      '<p>use <code>&lt;!-- marker --&gt;</code> here</p>\n',
    )
  })

  test('inside an indented code block', async () => {
    expect(await render('    <!-- keep me -->')).toContain('keep me')
  })
})

describe('raw HTML still never renders', () => {
  test('a non-comment HTML tag is escaped, as before', async () => {
    const out = await render('<div>hi</div>\n\ntext <b>bold</b>')
    expect(out).toContain('&lt;div&gt;hi&lt;/div&gt;')
    expect(out).toContain('&lt;b&gt;bold&lt;/b&gt;')
    expect(out).not.toMatch(/<div|<b>/)
  })

  test('a comment cannot smuggle a tag out of itself', async () => {
    const out = await render('<!-- <script>alert(1)</script> -->')
    expect(out).not.toContain('script')
  })
})

describe('emoji shortcodes', () => {
  test(':rocket: renders as the unicode emoji', async () => {
    expect(await render('ship it :rocket:')).toBe('<p>ship it 🚀</p>\n')
  })

  test('an unknown shortcode stays literal', async () => {
    expect(await render('a :notanemoji: b')).toBe('<p>a :notanemoji: b</p>\n')
  })

  test('shortcodes inside a fence stay literal', async () => {
    const out = await render('```text\n:rocket:\n```')
    expect(out).toContain(':rocket:')
    expect(out).not.toContain('🚀')
  })

  test('shortcodes inside inline code stay literal', async () => {
    expect(await render('`:rocket:`')).toBe('<p><code>:rocket:</code></p>\n')
  })

  test('text smileys are NOT converted (shortcodes only, like GitHub); a bare URL links, as on GitHub', async () => {
    expect(await render('fine :) and :D and http://x.y')).toBe('<p>fine :) and :D and <a href="http://x.y">http://x.y</a></p>\n')
  })

  test('the sanitizer keeps the emoji through to the set:html string', async () => {
    const sanitizer = createReadmeSanitizer(() => new JSDOM('').window as unknown as ReadmeWindow)
    const out = sanitizer.sanitize(await render('# Go :tada:\n\nlaunch :rocket:'))
    expect(out).toContain('🎉')
    expect(out).toContain('🚀')
  })
})

describe('theme Markdown widgets', () => {
  test('a GitHub alert renders as the theme aside and keeps its classes through the sanitizer', async () => {
    const sanitizer = createReadmeSanitizer(() => new JSDOM('').window as unknown as ReadmeWindow)
    const out = sanitizer.sanitize(await render('> [!WARNING]\n> Mind the gap.'))
    expect(out).toBe(
      '<aside aria-label="Warning" class="starlight-aside starlight-aside--caution"><p class="starlight-aside__title" aria-hidden="true">Warning</p><div class="starlight-aside__content"><p>Mind the gap.</p></div></aside>\n',
    )
  })

  test('a task list keeps its classes and each box its label; a raw <details> stays text', async () => {
    const sanitizer = createReadmeSanitizer(() => new JSDOM('').window as unknown as ReadmeWindow)
    const out = sanitizer.sanitize(await render('- [x] done\n\n<details><summary>S</summary>b</details>'))
    expect(out).toContain('<ul class="contains-task-list">\n<li class="task-list-item"><input type="checkbox" checked="" disabled="" aria-label="done"> done</li>')
    expect(out).toContain('&lt;details&gt;&lt;summary&gt;S&lt;/summary&gt;')
  })

  test('colon-separated text is no directive', async () => {
    expect(await render('index:package:1.0')).toBe('<p>index:package:1.0</p>\n')
  })
})

describe('highlighting', () => {
  test('a fence with a known language gets hljs spans', async () => {
    expect(await render('```js\nconst a = 1\n```')).toContain('hljs-keyword')
  })

  test('D-178 a fence with no language, or an unknown one, is auto-detected and highlighted', async () => {
    const autoSpy = vi.spyOn(hljs, 'highlightAuto')
    const code = 'const a = 1 < 2;\nfunction f() { return a }'
    expect(await render('```\n' + code + '\n```')).toContain('<span class="hljs-keyword">const</span>')
    expect(await render('```nonesuch\n' + code + '\n```')).toContain('<span class="hljs-keyword">const</span>')
    expect(autoSpy).toHaveBeenCalledTimes(2)
  })

  test('D-178 auto-detected output stays escaped: markup in the code is text', async () => {
    const out = await render('```\n<script>alert(1)</script>\n```')
    expect(out).not.toContain('<script')
    expect(out).toContain('&lt;')
  })

  test('D-178 a fence over 16 KiB is not auto-detected: plain escaped text; at the limit it still is', async () => {
    const autoSpy = vi.spyOn(hljs, 'highlightAuto')
    const line = 'const a = 1 < 2;\n'
    const atLimit = line.repeat(Math.floor(16384 / line.length))
    const over = atLimit + line
    expect(atLimit.length).toBeLessThanOrEqual(16384)
    expect(over.length).toBeGreaterThan(16384)
    expect(await render('```\n' + atLimit + '```')).toContain('hljs-')
    expect(autoSpy).toHaveBeenCalledTimes(1)
    const plain = await render('```\n' + over + '```')
    expect(plain).toContain('<pre><code>const a = 1 &lt; 2;')
    expect(plain).not.toContain('hljs-')
    expect(autoSpy).toHaveBeenCalledTimes(1)
  })

  test('D-178 a labelled fence does not auto-detect', async () => {
    const autoSpy = vi.spyOn(hljs, 'highlightAuto')
    await render('```js\nconst a = 1\n```')
    expect(autoSpy).not.toHaveBeenCalled()
  })

  test('a highlighter failure falls back to an escaped plain block', async () => {
    vi.spyOn(hljs, 'highlight').mockImplementation(() => {
      throw new Error('boom')
    })
    const out = await render('```js\n<b>x</b>\n```')
    expect(out).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(out).not.toContain('hljs-')
  })
})
