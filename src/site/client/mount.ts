/**
 * The lazy-mount seam islands depend on (C-033): the shape of the theme's
 * `@ocx-sh/theme/lazy` (`mount(root, {load, trigger, replay})`; its typedefs
 * are the JSDoc in `lazy.mjs`, and the theme ships no `.d.mts` until packed,
 * so these interfaces mirror them). Island modules take a `LazyMount` instead
 * of importing theme internals, so they unit-test against
 * `test/site/client/lazy_double.ts`; the real binding is the `<script>` of
 * `CatalogGrid.astro`, `VersionList.astro` and `Palette.astro`, which pass
 * `{ mount }` from `@ocx-sh/theme/lazy`. Each island's `*_real_lazy` test runs
 * it against the real module, so a drift in either shape fails there. Islands receive `base` via `data-base` or mount
 * options, never a global.
 */

/** What `load` resolves to: starts the widget on its root. */
export interface LazyModule {
  start(root: HTMLElement, firstEvent?: MouseEvent | KeyboardEvent): { readonly api: unknown; stop(): void } | void;
}

export interface MountSpec {
  /** Dynamic `import()` of the module that starts the widget. */
  readonly load: () => Promise<LazyModule>;
  /** Default `interaction`. */
  readonly trigger?: "interaction" | "visible" | "manual";
  /** Re-dispatch one early activation after start; default true. */
  readonly replay?: boolean;
}

export interface MountHandle {
  /** Begins loading (the `manual` trigger); resolves with `ready`. */
  start(): Promise<void>;
  destroy(): void;
  /** Settles when the module is live, failed, or destroyed. */
  readonly ready: Promise<void>;
  /** The latest session api, `undefined` until live. */
  readonly api: unknown;
}

export interface LazyMount {
  mount(root: HTMLElement, spec: MountSpec): MountHandle;
}
