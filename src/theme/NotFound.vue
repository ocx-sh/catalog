<template>
  <!-- C-607: promoted to <main> (with the same #main-content skip-link
       target every other page's own <main> carries) — the 404 page had no
       landmark at all before. -->
  <main id="main-content" class="not-found">
    <span class="not-found-code">404</span>
    <p class="not-found-message">This page doesn't exist.</p>
    <a href="/" class="not-found-link">← back to catalog</a>
  </main>
</template>

<style scoped>
@layer ocx {
.not-found {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 64px 24px;
  text-align: center;
}

.not-found-code {
  font-family: var(--ocx-font-mono);
  font-size: var(--ocx-text-2xl);
  font-weight: 600;
  color: var(--ocx-color-fg-muted);
}

.not-found-message {
  margin: 0;
  color: var(--ocx-color-fg-subtle);
  font-size: var(--ocx-text-sm);
  font-family: var(--ocx-font-sans);
}

.not-found-link {
  font-family: var(--ocx-font-mono);
  font-size: var(--ocx-text-xs);
  font-weight: 500;
  color: var(--ocx-color-accent);
}

.not-found-link:hover {
  color: var(--ocx-color-accent-hover);
}
}
</style>
