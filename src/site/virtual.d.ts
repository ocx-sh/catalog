// The Vite virtual module `src/site/integration.ts` serves from `site.json`
// (C-047). Pages read route keys / docs slugs from it in `getStaticPaths`.
declare module "virtual:ocx-catalog/site" {
  import type { SiteModel } from "./model/index.js";
  const site: SiteModel;
  export default site;
}
