// Generic DOM helper leaf — shared by the grid and palette islands.

/**
 * True when `target` is a form control or `contenteditable` element — used
 * to skip a global single-key shortcut ("/", etc.) while the user is
 * already typing somewhere.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
}

/** The first `selector` inside `root`; an island cannot run without its markup, so absence throws. */
export function requireEl<T extends Element>(root: ParentNode, selector: string, island = "grid"): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`${island}: missing ${selector} in the ${island} root`);
  return el as T;
}

/** The nodes of `selector` inside `root`; none is fine. */
export const everyEl = (root: ParentNode, selector: string): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(selector)];
