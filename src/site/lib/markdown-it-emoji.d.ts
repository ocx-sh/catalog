// `markdown-it-emoji` ships no types. Only the `full` preset is used
// (`readmeMarkdown.ts`); options are the plugin's own `defs`/
// `shortcuts`/`enabled`.
declare module 'markdown-it-emoji' {
  import type { PluginWithOptions } from 'markdown-it'
  export const full: PluginWithOptions<{ defs?: Record<string, string>; shortcuts?: Record<string, string | string[]>; enabled?: string[] }>
}
