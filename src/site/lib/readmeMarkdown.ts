// The README markdown pipeline: Sätteri with the theme's Markdown widgets
// (`@ocx-sh/theme/markdown`: GitHub alerts as asides, emoji shortcodes, task
// lists, HTML comments dropped) plus highlight.js. `src/build/readmes.ts`
// renders every README with it in the CLI process during assembly
// (`readmeRender.ts`); nothing here reaches the browser.
import { markdownToHtml, type HastPluginDefinition, type MdastPluginDefinition } from 'satteri'
import { asides, taskLabels, widgets } from '@ocx-sh/theme/markdown'
import hljs from 'highlight.js/lib/common'

// README content is semi-trusted (bot-mirrored from a third-party registry's
// __ocx.desc, not authored here): raw HTML is escaped to text, never parsed, and
// HTML comments are dropped. Runs before `widgets`, which would otherwise add
// markup to a raw `<summary>`.
const COMMENTS = /<!--[\s\S]*?-->/g
const escapeRawHtml: MdastPluginDefinition = {
  name: 'ocx-catalog/escape-raw-html',
  html(node, ctx) {
    const value = node.value.replace(COMMENTS, '')
    if (value.trim() === '') ctx.removeNode(node)
    else ctx.replaceNode(node, { type: 'text', value })
  },
}

// ponytail: `highlightAuto` tries every language, ~8 ms/KB, so a 1 MiB fence
// would hold the build for ~8 s. Past this size an unlabelled fence renders
// as plain escaped text; add a time budget only if 16 KiB proves too coarse.
const AUTO_DETECT_MAX_BYTES = 16 * 1024

/** hljs spans for `code`, or `null` for plain text (a highlighter fault included). */
function highlight(code: string, lang: string): string | null {
  try {
    if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value
    return code.length > AUTO_DETECT_MAX_BYTES ? null : hljs.highlightAuto(code).value
  } catch {
    return null
  }
}

const LANGUAGE_CLASS = /^language-([\w+#.-]+)$/

// A labelled fence uses its language; an unlabelled or unknown-language one is
// auto-detected. hljs escapes the source itself and only adds its own `hljs-*`
// spans, which the theme's `prose-code.css` colours, so its output is safe raw.
const highlightFences: HastPluginDefinition = {
  name: 'ocx-catalog/highlight-fences',
  element: {
    filter: ['code'],
    visit(node, ctx) {
      const parent = ctx.parent(node)
      if (parent?.type !== 'element' || parent.tagName !== 'pre') return
      const classes = [node.properties.className ?? []].flat().map(String)
      const lang = classes.map((c) => LANGUAGE_CLASS.exec(c)?.[1]).find(Boolean) ?? ''
      const html = highlight(ctx.textContent(node), lang)
      if (html === null) return
      const attr = lang ? ` class="language-${lang}"` : ''
      ctx.replaceNode(node, { type: 'raw', value: `<code${attr}>${html}</code>` })
    },
  },
}

/** Renders one README to unsanitised HTML; the caller sanitises it. */
export async function renderReadmeMarkdown(source: string): Promise<string> {
  const { html } = await markdownToHtml(source, {
    // `directive: false`: `index:package:1.0` in prose must stay text.
    features: { directive: false },
    mdastPlugins: [escapeRawHtml, widgets, asides],
    hastPlugins: [taskLabels, highlightFences],
  })
  return html
}
