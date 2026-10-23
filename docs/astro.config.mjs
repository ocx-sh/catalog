// The catalog section of ocx.sh: `/apps/catalog/` (a claim in the theme's nav.json).
import { satteri } from '@astrojs/markdown-satteri';
import starlight from '@astrojs/starlight';
import ocxTheme from '@ocx-sh/theme/starlight';
import { defineConfig } from 'astro/config';

export default defineConfig({
  base: '/apps/catalog/',
  // Starlight reads it before plugins run, so the theme checks it rather than sets it.
  trailingSlash: 'always',
  devToolbar: { enabled: false },
  // Explicit: Starlight's default processor (Sätteri), chosen rather than inherited.
  markdown: { processor: satteri() },
  integrations: [
    starlight({
      title: 'OCX Catalog',
      description: 'Render one or more OCX package indices into a browsable static catalog site.',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/ocx-sh/catalog' }],
      editLink: { baseUrl: 'https://github.com/ocx-sh/catalog/edit/main/docs/' },
      pagefind: true,
      plugins: [ocxTheme()],
      // Order inside each group comes from the pages' `sidebar.order` frontmatter.
      sidebar: [
        { label: 'Home', link: '/' },
        { label: 'How-To', items: [{ autogenerate: { directory: 'how-to' } }] },
        { label: 'Reference', items: [{ autogenerate: { directory: 'reference' } }] },
        { label: 'Explanation', items: [{ autogenerate: { directory: 'explanation' } }] },
        { label: 'Ops', items: [{ autogenerate: { directory: 'ops' } }] },
      ],
    }),
  ],
});
