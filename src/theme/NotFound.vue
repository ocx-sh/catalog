<template>
  <div class="not-found">
    <span class="not-found-code">404</span>
    <p class="not-found-message">This page doesn't exist.</p>
    <a href="/" class="not-found-link">← back to catalog</a>
  </div>
</template>

<style scoped>
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
  font-family: var(--font-mono);
  font-size: var(--text-2xl);
  font-weight: 600;
  color: var(--c-text-2);
}

.not-found-message {
  margin: 0;
  color: var(--c-text-3);
  font-size: var(--text-sm);
  font-family: var(--font-sans);
}

.not-found-link {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--c-accent);
}

.not-found-link:hover {
  color: var(--c-accent-hover);
}
</style>
