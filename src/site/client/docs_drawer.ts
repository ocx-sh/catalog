/**
 * The docs mount's mobile drawer: the theme `Drawer` closes itself on Escape, the
 * backdrop and its close button, but a link inside it that stays on the page (an
 * outline `#fragment`) leaves it open over the target. Following any link in the
 * drawer closes it, as the old docs drawer did; a link to another page ends the
 * document anyway.
 */
export function closeOnLink(drawer: HTMLElement): void {
  drawer.addEventListener("click", (event) => {
    if (!(event.target instanceof Element) || event.target.closest("a") === null) return;
    drawer.querySelector<HTMLElement>("[data-part='close-trigger']")?.click();
  });
}
