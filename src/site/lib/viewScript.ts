import { SORT_STORAGE_KEY, VIEW_STORAGE_KEY } from "./viewPrefs.js";

/**
 * The inline script that runs before the lists are parsed (CatalogGrid.astro carries the same text, pinned equal by
 * `test/site/lib/viewScript.test.ts`). It marks the root element, which CSS keys on, so the page is right at first paint:
 * `data-catalog-view="table"` when the URL asks for the table view or, failing that, the reader remembered it, so the
 * server's cards never show for a returning reader; `data-catalog-wait` when the URL narrows what the keyword rail lists
 * (`?q`, `?index`, `?keyword`, `?platform`, `?status`) or orders it differently from the server (`?sort`, `?invert`, a
 * remembered sort), so neither the server's cards nor the rail show until the results settle them. Both
 * describe a URL the island boots on at load, and it clears them. Storage and the address can be unreadable: then the
 * page is simply the server's.
 */
export const VIEW_SCRIPT =
  "(()=>{const d=document.documentElement,p=new URLSearchParams(location.search);" +
  "let s;try{s=localStorage.getItem('" +
  SORT_STORAGE_KEY +
  "')}catch{}" +
  "if(p.get('q')||p.has('index')||p.get('keyword')||p.get('platform')||p.getAll('status').some(v=>v==='deprecated'||v==='yanked')" +
  "||p.get('invert')==='1'||/^(updated|created)$/.test(p.get('sort')||s||''))" +
  "d.dataset.catalogWait='';" +
  "try{if((p.get('view')||localStorage.getItem('" +
  VIEW_STORAGE_KEY +
  "'))==='table')d.dataset.catalogView='table'}catch{}})()";
