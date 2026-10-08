// The README markdown pipeline: markdown-it + highlight.js + two README-only
// behaviours. `ReadmePane.vue` loads this module with ONE dynamic `import()`,
// so markdown-it, highlight.js and markdown-it-emoji all stay in the lazy
// README chunk and never reach the shared every-page bundle (C-606) — never
// import it statically from a component.
//
// `html: false` is non-negotiable — README content is semi-trusted
// (bot-mirrored from a third-party registry's __ocx.desc, not authored here),
// so raw HTML is escaped, never parsed. Everything below works WITHOUT
// enabling it.
import MarkdownIt from 'markdown-it'
import type { StateBlock, StateInline } from 'markdown-it'
import { full as emoji } from 'markdown-it-emoji'
import hljs from 'highlight.js/lib/common'

const COMMENT_OPEN = '<!--'
const COMMENT_CLOSE = '-->'

// Block rule: `<!-- … -->` on its own line(s), possibly multi-line, is
// consumed and emits no token. Runs before the fence/inline rules see its
// interior, so a comment can hide anything; a comment INSIDE a fence never
// gets here (the fence rule consumes those lines first). A comment with text
// after the closing `-->` on the same line is left to the inline rule below
// (so the trailing text survives); an unterminated one stays literal.
function commentBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const pos = state.bMarks[startLine] + state.tShift[startLine]
  if (!state.src.startsWith(COMMENT_OPEN, pos)) return false
  const close = state.src.indexOf(COMMENT_CLOSE, pos + COMMENT_OPEN.length)
  if (close === -1) return false
  let line = startLine
  while (line < endLine && state.eMarks[line] < close + COMMENT_CLOSE.length) line++
  if (line >= endLine) return false
  if (state.src.slice(close + COMMENT_CLOSE.length, state.eMarks[line]).trim() !== '') return false
  if (silent) return true
  state.line = line + 1
  return true
}

// Inline rule: `<!-- … -->` inside a paragraph is skipped without a token.
// Registered after `backticks`, so a comment inside a code span is consumed
// by the span first and stays verbatim.
function commentInline(state: StateInline): boolean {
  if (!state.src.startsWith(COMMENT_OPEN, state.pos)) return false
  const close = state.src.indexOf(COMMENT_CLOSE, state.pos + COMMENT_OPEN.length)
  if (close === -1) return false
  state.pos = close + COMMENT_CLOSE.length
  return true
}

function highlight(code: string, lang: string): string {
  try {
    if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value
    return hljs.highlightAuto(code).value
  } catch {
    // An empty return tells markdown-it to escape the block as plain text.
    return ''
  }
}

/**
 * A fresh markdown-it instance for one README render. hljs output is safe to
 * inject: it escapes the source itself and only adds its own `hljs-*` spans.
 * Emoji shortcodes (`:rocket:`) become unicode, GitHub-style; text smileys
 * (`:)`) are deliberately NOT converted, and unknown shortcodes stay literal.
 */
export function createReadmeMarkdown(): MarkdownIt {
  const md = new MarkdownIt({ html: false, highlight })
  md.block.ruler.before('html_block', 'html_comment', commentBlock, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  })
  md.inline.ruler.before('html_inline', 'html_comment', commentInline)
  md.use(emoji, { shortcuts: {} })
  return md
}
