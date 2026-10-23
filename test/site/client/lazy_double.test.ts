import { describe, expect, it } from "vitest";
import { createLazyDouble } from "./lazy_double.js";

const root = {} as HTMLElement;

describe("createLazyDouble", () => {
  it("records the mount and runs load then start when fired", async () => {
    const double = createLazyDouble();
    const started: HTMLElement[] = [];
    const handle = double.mount(root, {
      trigger: "manual",
      load: async () => ({
        start(element) {
          started.push(element);
          return { api: "session", stop() {} };
        },
      }),
    });
    expect(double.mounts).toHaveLength(1);
    expect(double.mounts[0]?.spec.trigger).toBe("manual");
    expect(handle.api).toBeUndefined();

    await handle.start();
    await handle.ready;

    expect(started).toEqual([root]);
    expect(handle.api).toBe("session");
  });

  it("leaves api undefined when start returns nothing, and settles ready on destroy", async () => {
    const double = createLazyDouble();
    const handle = double.mount(root, { load: async () => ({ start() {} }) });
    await double.mounts[0]?.fire();
    expect(handle.api).toBeUndefined();

    handle.destroy();
    await handle.ready;
    expect(double.mounts[0]?.destroyed).toBe(true);
  });
});
