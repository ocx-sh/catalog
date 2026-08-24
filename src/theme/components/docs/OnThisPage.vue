<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { Header } from 'vitepress'

// `page.headers` only ever carries levels 2–3 — capped by this repo's own
// `markdown.headers.level` in config.mts (extraction is OFF entirely by
// default for a blank/non-DefaultTheme site; verified against alpha.18's
// `resolveConfig`). h1 is the page title, never part of this list.
const props = defineProps<{ headers: Header[] }>()

const activeSlug = ref('')
let observer: IntersectionObserver | undefined

onMounted(() => {
  const slugs = props.headers.flatMap(h => [h.slug, ...h.children.map(c => c.slug)])
  const targets = slugs
    .map(slug => document.getElementById(slug))
    .filter((el): el is HTMLElement => el !== null)

  observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter(entry => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      if (visible[0]) activeSlug.value = visible[0].target.id
    },
    { rootMargin: '-72px 0px -70% 0px' },
  )
  targets.forEach(el => observer!.observe(el))
})

onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <nav v-if="headers.length" class="on-this-page" aria-label="On this page">
    <span class="otp-label">ON THIS PAGE</span>
    <template v-for="h in headers" :key="h.slug">
      <a :href="h.link" class="otp-item" :class="{ active: activeSlug === h.slug }">{{ h.title }}</a>
      <a
        v-for="c in h.children"
        :key="c.slug"
        :href="c.link"
        class="otp-item otp-item-sub"
        :class="{ active: activeSlug === c.slug }"
      >{{ c.title }}</a>
    </template>
  </nav>
</template>

<style scoped>
@layer ocx {
.on-this-page {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.otp-label {
  font-family: var(--ocx-font-mono);
  font-size: var(--ocx-text-2xs);
  font-weight: var(--ocx-font-weight-semibold);
  letter-spacing: 0.09em;
  color: var(--ocx-color-fg-subtle);
}

.otp-item {
  font-family: var(--ocx-font-sans);
  font-size: var(--ocx-text-sm);
  color: var(--ocx-color-fg-muted);
  border-left: var(--ocx-border-width-strong) solid var(--ocx-color-border);
  padding-left: 10px;
  line-height: 1.4;
}

.otp-item-sub {
  padding-left: 20px;
  font-size: var(--ocx-text-xs);
}

.otp-item:hover {
  color: var(--ocx-color-fg);
}

.otp-item.active {
  color: var(--ocx-color-accent);
  border-left-color: var(--ocx-color-accent);
}
}
</style>
