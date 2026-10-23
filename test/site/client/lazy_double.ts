/**
 * Test double for `LazyMount` (C-033). Records every `mount` call and lets a
 * test fire the trigger by hand, so an island test never needs the theme, a
 * DOM event or a real dynamic import ordering.
 */
import type { LazyMount, LazyModule, MountHandle, MountSpec } from "../../../src/site/client/mount.js";

export interface RecordedMount {
  readonly root: HTMLElement;
  readonly spec: MountSpec;
  /** Runs `spec.load()`, then `start(root)` on the result, as the real trigger would. */
  fire(): Promise<LazyModule>;
  readonly destroyed: boolean;
}

export interface LazyDouble extends LazyMount {
  readonly mounts: readonly RecordedMount[];
}

export function createLazyDouble(): LazyDouble {
  const mounts: RecordedMount[] = [];
  return {
    mounts,
    mount(root: HTMLElement, spec: MountSpec): MountHandle {
      let api: unknown;
      let destroyed = false;
      let settle: () => void = () => {};
      const ready = new Promise<void>((resolve) => (settle = resolve));
      const recorded: RecordedMount = {
        root,
        spec,
        get destroyed() {
          return destroyed;
        },
        async fire() {
          const module = await spec.load();
          const session = module.start(root);
          api = session ? session.api : undefined;
          settle();
          return module;
        },
      };
      mounts.push(recorded);
      return {
        start: async () => {
          await recorded.fire();
        },
        destroy: () => {
          destroyed = true;
          settle();
        },
        ready,
        get api() {
          return api;
        },
      };
    },
  };
}
