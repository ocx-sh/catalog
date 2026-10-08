// Just the slice of jsdom the README sanitizer uses (`new JSDOM("").window`);
// `@types/jsdom` is not a dependency of this package.
declare module "jsdom" {
  import type { WindowLike } from "dompurify";

  export class JSDOM {
    constructor(html?: string);
    readonly window: WindowLike & { close(): void };
  }
}
