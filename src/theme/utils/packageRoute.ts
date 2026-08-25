/**
 * The theme's door onto the route rule — a re-export, never a second
 * implementation.
 *
 * The rule itself lives in `src/viewmodel/route.ts`, which
 * `build/sources_pipeline.ts` imports too, so the path a page is WRITTEN at
 * and the path it is LINKED at come from one function rather than from two
 * copies of one sentence. This branch paid for the two-copy version twice
 * (the ⌘K palette, and `DetailPage.vue`'s route split) — see that file's own
 * doc comment.
 *
 * This file stays as the theme's import site because every component already
 * imports from `utils/`, and because a component reaching into `viewmodel/`
 * for a route would blur which module owns the rule.
 */
export { isDefaultIndex, packageRoutePath } from '../../viewmodel/route.js'
