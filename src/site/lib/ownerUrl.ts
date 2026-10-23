import { safeHref } from './safeHref.js'

/** The forge an owner's login is assumed to belong to when a deployment sets
 * no `ownerUrl` — what the theme linked to before the key existed. */
export const DEFAULT_OWNER_URL = 'https://github.com/{login}'

/**
 * An owner's profile link: `template` (`themeConfig.ownerUrl`, absent for
 * the GitHub default) with `{login}` replaced by the login, routed through
 * `safeHref`. `login` is wire data, so it is `encodeURIComponent`-ed — it
 * can never add a path segment, query or host to the template — and spliced
 * in with `split`/`join`, never `replace`: a replacement STRING is
 * `$`-significant (`$&`, `$1`). `null` (no login, or a template that is not
 * http(s) — a hand-written `themeConfig` skips `loadConfig`'s check) means
 * "render plain text".
 */
export function ownerProfileUrl(template: string | undefined, login: string | null | undefined): string | null {
  if (!login) return null
  return safeHref((template ?? DEFAULT_OWNER_URL).split('{login}').join(encodeURIComponent(login)))
}
