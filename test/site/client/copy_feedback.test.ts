// @vitest-environment happy-dom
//
// Copy feedback, the theme's `@ocx-sh/theme/copy` every copy control of the site reaches (D-084, D-131, D-143): the
// clipboard never throws at the caller, and a finished copy asks the page toaster for "Copied — <meaning>" for 2 s in
// the one `copy` slot, or for the danger "Copy failed". The toaster itself is the theme's; what this site relies on is
// the event it receives.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

type Copy = typeof import("@ocx-sh/theme/copy");
let copy: Copy;
beforeAll(async () => {
  copy = await import("@ocx-sh/theme/copy");
});
afterEach(() => vi.unstubAllGlobals());

/** The `ocx:toast` details a copy dispatches on `target`. */
function toasts(target: EventTarget) {
  const seen: { title: string; tone?: string; duration?: number; slot?: string }[] = [];
  target.addEventListener("ocx:toast", (event) => seen.push((event as CustomEvent).detail));
  return seen;
}

describe("D-084 a clipboard that is not there is harmless", () => {
  test("D-084 no async clipboard (an insecure context) writes nothing and resolves false", async () => {
    vi.stubGlobal("navigator", {});

    await expect(copy.writeClipboard("ocx add x")).resolves.toBe(false);
  });

  test("D-084 a writeText that throws before it returns a promise is a false, not an uncaught TypeError", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: () => {
          throw new TypeError("clipboard is not available in this context");
        },
      },
    });

    await expect(copy.writeClipboard("ocx add x")).resolves.toBe(false);
  });

  test("D-084 a refused write (permission denied) resolves false", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: () => Promise.reject(new Error("denied")) } });

    await expect(copy.writeClipboard("ocx add x")).resolves.toBe(false);
  });

  test("D-084 control: a write that succeeds resolves true with the text on the clipboard", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await expect(copy.writeClipboard("ocx add x")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledExactlyOnceWith("ocx add x");
  });

  test("D-084 a copy that cannot write toasts 'Copy failed' in the danger tone and returns false", async () => {
    vi.stubGlobal("navigator", {});
    const host = document.createElement("button");
    const seen = toasts(host);

    await expect(copy.copyWithToast(host, "ocx add x", "install command")).resolves.toBe(false);

    expect(seen).toEqual([{ title: "Copy failed", tone: "danger", slot: "copy" }]);
  });
});

describe("D-131 D-143 a finished copy asks the page for one confirmation", () => {
  test("D-131 D-143 a copy toasts 'Copied — <meaning>' for 2000 ms in the shared copy slot", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: async () => {} } });
    const host = document.createElement("button");
    document.body.append(host);
    const seen = toasts(document); // bubbles: the page toaster listens on the document

    await expect(copy.copyWithToast(host, "ocx add x", "install command")).resolves.toBe(true);

    expect(seen).toEqual([{ title: "Copied — install command", duration: 2000, slot: "copy" }]);
    host.remove();
  });

  test("D-143 a long meaning is cut to 40 characters with an ellipsis", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: async () => {} } });
    const host = document.createElement("button");
    const seen = toasts(host);

    await copy.copyWithToast(host, "x", "a".repeat(60));

    expect(seen[0]?.title).toBe(`Copied — ${"a".repeat(39)}…`);
  });

  test("D-143 two copies in a row share the one slot, so the newer replaces the older", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: async () => {} } });
    const host = document.createElement("button");
    const seen = toasts(host);

    await copy.copyWithToast(host, "a", "package name");
    await copy.copyWithToast(host, "b", "registry address");

    expect(seen.map((toast) => toast.slot)).toEqual(["copy", "copy"]);
    expect(seen.map((toast) => toast.title)).toEqual(["Copied — package name", "Copied — registry address"]);
  });
});
