<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useClipboard } from '@vueuse/core'
import { PopoverRoot, PopoverTrigger, PopoverPortal, PopoverContent } from 'reka-ui'
import { casUrl } from '../../utils/cas'
import CopyIcon from '../shared/CopyIcon.vue'
import { useToast } from '../../composables/useToast'

// The pane is always rendered by DetailPage (no more `v-if="root.desc?.readme"`
// gate) — `digest` is `null` when the package has no readme at all, in which
// case `load()` skips the fetch and goes straight to the empty-state
// placeholder below. A real digest that 404s/fails lands on the same
// placeholder (muted message, no crash).
const props = defineProps<{
  /** Bare `<ns>/<pkg>` route params — CAS URLs, NEVER `root.name` (see
   * `usePackageRoot`'s CAS-gotcha docblock). */
  bareName: string
  digest: string | null
  /** Mount prefix of the source this package came from — see
   * `utils/cas.ts`'s `wirePrefix`. Omitted for the `root: true` source. */
  wireBase?: string
}>()

const html = ref<string | null>(null)
const loading = ref(true)
const failed = ref(false)

async function load() {
  loading.value = true
  failed.value = false
  html.value = null
  if (!props.digest) {
    failed.value = true
    loading.value = false
    return
  }
  const url = casUrl(props.bareName, props.digest, 'md', props.wireBase ?? '')
  if (!url) {
    failed.value = true
    loading.value = false
    return
  }
  try {
    // Dynamic imports — `markdown-it`, `highlight.js`, and the sanitizer
    // (dompurify, ~29KB) only reach the browser as their own chunks, fetched
    // the first time a README actually renders, instead of static imports
    // pulling them into the shared every-page/grid-entry bundle (C-606).
    // hljs `lib/common` = the ~35 mainstream grammars; fences without a
    // language hint fall back to auto-detection.
    const [resp, { default: MarkdownIt }, { default: hljs }, { sanitizeReadmeHtml }] = await Promise.all([
      fetch(url),
      import('markdown-it'),
      import('highlight.js/lib/common'),
      import('../../utils/sanitize'),
    ])
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const text = await resp.text()
    // `html: false` is non-negotiable — README content is semi-trusted
    // (bot-mirrored from a third-party registry's __ocx.desc, not authored
    // here). hljs output is safe to inject: it escapes the source itself
    // and only ever adds its own `hljs-*` spans; an empty-string return
    // tells markdown-it to escape the block as plain text instead.
    const md = new MarkdownIt({
      html: false,
      highlight: (code, lang) => {
        try {
          if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value
          return hljs.highlightAuto(code).value
        } catch {
          return ''
        }
      },
    })
    // Second layer over `html: false`: the markdown is wire-sourced (a
    // third-party registry's __ocx.desc, mirrored by the bot), so it passes
    // through the sanitizer before ever reaching v-html — defence against a
    // markdown-it config regression or a future plugin, and the enabler for
    // the GFM/Shiki affordances the allowlist permits (WP-08).
    html.value = sanitizeReadmeHtml(md.render(text))
    // Flip loading BEFORE injecting: the content div is v-else'd behind the
    // loading branch, so until this the ref target doesn't exist at all.
    loading.value = false
    await nextTick()
    injectCopyButtons()
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => [props.bareName, props.digest, props.wireBase], load)

// Provenance popover actions — copy targets, not prose (owner spec).
// URL resolved client-side only (popover never renders during SSG).
const readmeUrl = computed(() => {
  const path = props.digest ? casUrl(props.bareName, props.digest, 'md', props.wireBase ?? '') : null
  return path && typeof window !== 'undefined' ? `${window.location.origin}${path}` : null
})

const { copy: clipboardCopy } = useClipboard()
const { toast } = useToast()
const copiedKey = ref<string | null>(null)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

const ACTION_LABELS: Record<string, string> = {
  digest: 'README digest',
  url: 'README URL',
  curl: 'fetch command',
}

const infoOpen = ref(false)
const contentEl = ref<HTMLElement | null>(null)

// Per-fence copy buttons — the README arrives via v-html, so buttons are
// injected after each render (re-render replaces the tree wholesale, so
// there is nothing stale to clean up). Same look as the docs fences'
// VitePress-injected `.copy` button (docs-prose.css).
function injectCopyButtons() {
  for (const pre of contentEl.value?.querySelectorAll('pre') ?? []) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'readme-copy'
    btn.title = 'Copy code'
    btn.addEventListener('click', async () => {
      await clipboardCopy(pre.querySelector('code')?.textContent ?? '')
      toast('Copied — code block')
      btn.classList.add('copied')
      setTimeout(() => btn.classList.remove('copied'), 1500)
    })
    pre.appendChild(btn)
  }
}

async function copyAction(key: string, text: string) {
  infoOpen.value = false
  await clipboardCopy(text)
  toast(`Copied — ${ACTION_LABELS[key] ?? key}`)
  copiedKey.value = key
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => {
    copiedKey.value = null
  }, 1500)
}
</script>

<template>
  <div class="readme-pane">
    <span class="readme-heading">README</span>
    <div class="readme-card">
      <p v-if="loading" class="readme-status">Loading README…</p>
      <div v-else-if="failed" class="readme-empty">No README available.</div>
      <!-- eslint-disable-next-line vue/no-v-html -- markdown-it html:false: source is escaped/non-HTML, safe to inject -->
      <div v-else ref="contentEl" class="readme-content" v-html="html" />
      <!-- Provenance behind a clickable info button, card's top-right
           corner (owner spec) — popover carries the full detail the old
           prose line spelled out inline. -->
      <PopoverRoot v-if="digest && !loading" v-model:open="infoOpen">
        <PopoverTrigger class="readme-info" aria-label="README provenance">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent class="readme-info-pop" side="bottom" align="end" :side-offset="6">
            <span class="readme-info-title">mirrored README · content-addressed</span>
            <button type="button" class="readme-info-action" @click="copyAction('digest', digest!)">
              <CopyIcon :copied="copiedKey === 'digest'" :size="13" />
              Copy digest
            </button>
            <button v-if="readmeUrl" type="button" class="readme-info-action" @click="copyAction('url', readmeUrl)">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
              Copy URL
            </button>
            <button v-if="readmeUrl" type="button" class="readme-info-action" @click="copyAction('curl', `curl -sL ${readmeUrl}`)">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
              Copy fetch command
            </button>
          </PopoverContent>
        </PopoverPortal>
      </PopoverRoot>
    </div>
  </div>
</template>

<style scoped>
@layer ocx {
.readme-pane {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.readme-heading {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--c-text-3);
  letter-spacing: 0.06em;
}

.readme-card {
  position: relative;
  background: var(--c-surface);
  border: 1px solid var(--c-line);
  border-radius: var(--radius-lg);
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.readme-info {
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  color: var(--c-text-3);
  background: none;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: color 0.15s, background-color 0.15s;
}

.readme-info:hover,
.readme-info:focus-visible {
  color: var(--c-text-1);
  background: var(--c-surface-2);
  outline: none;
}

.readme-status {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--c-text-3);
  margin: 0;
}

/* WP6: no `opacity` — it diluted --c-text-3 to an effective ~2.34:1 against
 * --c-surface (opacity blends toward the background, undoing the token's
 * own WCAG margin). --c-text-3 alone is already the muted tone this state
 * wants, matching `.readme-status` (the loading state) just above. */
.readme-empty {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--c-text-3);
  text-align: center;
  padding: 32px 0;
}


/* First rendered block sits flush against the card's top padding — the UA
   default top margin on the first heading/paragraph otherwise stacks on top
   of `.readme-card`'s own padding, pushing content down too far. */
.readme-content > :deep(*:first-child) {
  margin-top: 0;
}

.readme-content :deep(h1),
.readme-content :deep(h2),
.readme-content :deep(h3) {
  font-family: var(--font-sans);
  color: var(--c-text-1);
}

.readme-content :deep(p) {
  font-family: var(--font-sans);
  font-size: var(--text-base);
  line-height: 1.65;
  color: var(--c-text-2);
}

.readme-content :deep(code) {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  background: var(--c-surface-2);
  padding: 1px 5px;
  border-radius: var(--radius-sm);
}

/* Fences: bg/text tokens follow the site theme (owner decision 2026-08-05,
   revising mock 1c/1f always-dark); border keeps the box visible against a
   same-family surface. */
.readme-content :deep(pre) {
  position: relative;
  background: var(--c-code-bg);
  border: 1px solid var(--c-line);
  border-radius: var(--radius-lg);
  padding: 12px 16px;
  overflow-x: auto;
}

/* Bare fade-in icon, not a boxed button (owner spec, matches docs fences). */
.readme-content :deep(.readme-copy) {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 24px;
  height: 24px;
  border: none;
  background: none;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s;
}

.readme-content :deep(pre:hover .readme-copy),
.readme-content :deep(.readme-copy:focus-visible) {
  opacity: 1;
}

.readme-content :deep(.readme-copy)::before {
  content: '';
  position: absolute;
  inset: 4px;
  background-color: var(--c-text-3);
  transition: background-color 0.15s;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='9' y='9' width='13' height='13' rx='2' ry='2'/%3E%3Cpath d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'/%3E%3C/svg%3E") center / contain no-repeat;
}

.readme-content :deep(.readme-copy:hover)::before {
  background-color: var(--c-accent);
}

.readme-content :deep(.readme-copy.copied)::before {
  background-color: var(--c-ok);
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'/%3E%3C/svg%3E");
}

.readme-content :deep(pre code) {
  background: none;
  padding: 0;
  font-size: var(--text-sm);
  line-height: 1.7;
  color: var(--c-code-text);
}

/* Semantic highlight theme — hljs supplies the token CLASSES (never our
   own parser, owner spec); the palette supplies the colors. One mapping,
   both site themes, via the theme-aware tokens. */
.readme-content :deep(.hljs-comment),
.readme-content :deep(.hljs-quote) {
  color: var(--c-text-3);
  font-style: italic;
}

.readme-content :deep(.hljs-keyword),
.readme-content :deep(.hljs-selector-tag),
.readme-content :deep(.hljs-built_in),
.readme-content :deep(.hljs-type),
.readme-content :deep(.hljs-tag) {
  color: var(--c-kw);
}

.readme-content :deep(.hljs-string),
.readme-content :deep(.hljs-regexp),
.readme-content :deep(.hljs-addition),
.readme-content :deep(.hljs-template-string) {
  color: var(--c-ok);
}

.readme-content :deep(.hljs-number),
.readme-content :deep(.hljs-literal),
.readme-content :deep(.hljs-symbol),
.readme-content :deep(.hljs-meta),
.readme-content :deep(.hljs-link) {
  color: var(--c-warn);
}

.readme-content :deep(.hljs-title),
.readme-content :deep(.hljs-section),
.readme-content :deep(.hljs-name),
.readme-content :deep(.hljs-selector-class),
.readme-content :deep(.hljs-selector-id) {
  color: var(--c-text-1);
  font-weight: 600;
}

.readme-content :deep(.hljs-variable),
.readme-content :deep(.hljs-template-variable),
.readme-content :deep(.hljs-attribute),
.readme-content :deep(.hljs-attr),
.readme-content :deep(.hljs-params) {
  color: var(--c-text-2);
}

.readme-content :deep(.hljs-deletion) {
  color: var(--c-accent);
}

/* WP6: an inline prose link distinguished from surrounding text by color
 * alone fails axe's link-in-text-block — underline gives it a second, non-
 * color cue. Same --c-accent-text swap as SiteHeader's `.nav-link.active`/
 * DetailPage's `.back-link`: plain --c-accent on --c-surface here is the
 * same 2.99:1 failing pair, -> 5.42:1. */
.readme-content :deep(a) {
  color: var(--c-accent-text);
  text-decoration: underline;
}

.readme-content :deep(table) {
  border-collapse: collapse;
  width: 100%;
}

.readme-content :deep(th),
.readme-content :deep(td) {
  border: 1px solid var(--c-line);
  padding: 6px 10px;
  font-size: var(--text-sm);
}
}
</style>

<style>
@layer ocx {
/* Unscoped — PopoverContent portals to <body> (same reasoning as
 * .copy-ctx-menu). */
.readme-info-pop {
  display: flex;
  flex-direction: column;
  min-width: 200px;
  padding: 0.35rem;
  background: var(--c-surface);
  border: 1px solid var(--c-line);
  border-radius: var(--radius-lg);
  z-index: 100;
  animation: copy-ctx-fade-in 0.12s ease-out;
}

.readme-info-title {
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  color: var(--c-text-3);
  padding: 0.35rem 0.6rem 0.45rem;
}

.readme-info-action {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.6rem;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--c-text-2);
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  transition: background 0.1s, color 0.1s;
}

.readme-info-action:hover {
  background: var(--c-surface-2);
  color: var(--c-accent);
}

.readme-info-action svg {
  flex-shrink: 0;
}
}
</style>
