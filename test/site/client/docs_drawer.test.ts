// @vitest-environment happy-dom
//
// The docs mount's mobile drawer closes when a link inside it is followed (D-109).
import { beforeEach, expect, test, vi } from "vitest";
import { closeOnLink } from "../../../src/site/client/docs_drawer.js";

let closed: ReturnType<typeof vi.fn>;
let drawer: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = `
    <div class="docs__drawer">
      <button type="button" data-part="close-trigger">Close</button>
      <nav><a href="/docs/guide/"><span>Guide</span></a><p>text</p></nav>
    </div>`;
  drawer = document.querySelector<HTMLElement>(".docs__drawer")!;
  closed = vi.fn();
  drawer.querySelector("[data-part='close-trigger']")!.addEventListener("click", closed);
  closeOnLink(drawer);
});

test("D-109 following a link in the drawer closes it, whichever element inside the link was hit", () => {
  drawer.querySelector("a")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  drawer.querySelector("a > span")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  expect(closed).toHaveBeenCalledTimes(2);
});

test("D-109 a click on anything else in the drawer leaves it open", () => {
  drawer.querySelector("p")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  drawer.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(closed).not.toHaveBeenCalled();
});

test("D-109 a click on a text node's parent chain without a close button is a no-op", () => {
  drawer.querySelector("[data-part='close-trigger']")!.remove();
  expect(() => drawer.querySelector("a")!.dispatchEvent(new MouseEvent("click", { bubbles: true }))).not.toThrow();
});

test("D-109 a click whose target is not an element is ignored", () => {
  drawer.dispatchEvent(new Event("click", { bubbles: true }));
  const event = new MouseEvent("click", { bubbles: true });
  Object.defineProperty(event, "target", { value: document });
  drawer.dispatchEvent(event);
  expect(closed).not.toHaveBeenCalled();
});
