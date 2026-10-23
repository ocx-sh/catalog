/**
 * The support-matrix dialog's rows (D-149), loaded by `detail.ts` on the first click of the dialog's
 * trigger and never before: the page carries the dialog shell and a skeleton, this fills in the rows. It
 * fetches the package's `data/catalog/support/<key>.json` once (one request in flight; a failure is
 * not kept, so Retry asks again) and writes DOM through `createElement`, `textContent`, `setAttribute`
 * and `hidden` only. The theme DataTable cannot take rows at runtime, so the rows are drawn here into the
 * table `PlatformMatrix.astro` renders.
 *
 * Markup contract, inside `host` = `[data-support-matrix]` (`data-support-url`: the file's URL):
 *   - `[data-matrix-require="<os/arch>"]`  a platform chip; the pressed ones (`aria-pressed`) are the
 *                              platforms every shown row must ship for
 *   - `[data-matrix-table]`    the `<table>`; `aria-busy` is true until rows are in or the load failed
 *   - `th[data-matrix-col="<os/arch>"]`, `th[data-matrix-note]`  the header's platform and note columns
 *   - `tbody[data-matrix-rows]`  receives one `tr[data-ocx-row]` per tag, its cells in header order, and
 *                              `data-copy` (the `CopyMenu` host texts; a click copies `name:tag` in `detail.ts`)
 *   - `[data-matrix-skeleton]` placeholder, hidden once rows are in
 *   - `[data-matrix-empty]`    shown when the pressed chips leave no row
 *   - `[data-matrix-error]`    shown with `[data-matrix-retry]` after a failed load
 */
import { cardCopyData } from "../lib/cardCopy.js";
import { DEFAULT_INSTALL_FLAVORS } from "../lib/installFlavors.js";
import { isSupportData, type SupportData } from "../lib/supportWire.js";
import type { FetchLike } from "../lib/wireTypes.js";

export interface SupportMatrixOptions {
  /** Defaults to the global `fetch`. */
  readonly fetch?: FetchLike;
  /** The package's qualified name, for the rows' copy texts. */
  readonly name: string;
}

/** The contract's parts: `PlatformMatrix.astro` renders every one of them, so a miss is the template's bug and fails the first use. */
const part = <T extends HTMLElement>(host: HTMLElement, selector: string): T => host.querySelector<T>(selector) as T;

export function mountSupportMatrix(host: HTMLElement, options: SupportMatrixOptions): { readonly ready: Promise<void>; destroy(): void } {
  const fetchFn: FetchLike = options.fetch ?? ((url) => globalThis.fetch(url));
  const url = String(host.dataset.supportUrl);
  const table = part(host, "[data-matrix-table]");
  const body = part(host, "[data-matrix-rows]");
  const skeleton = part(host, "[data-matrix-skeleton]");
  const empty = part(host, "[data-matrix-empty]");
  const error = part(host, "[data-matrix-error]");
  const columns = [...host.querySelectorAll<HTMLElement>("th[data-matrix-col]")].map((th) => String(th.dataset.matrixCol));
  const hasNote = host.querySelector("th[data-matrix-note]") !== null;
  const shown: { row: HTMLTableRowElement; platforms: ReadonlySet<string> }[] = [];

  const load = async (): Promise<SupportData> => {
    const resp = await fetchFn(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    // The mirrored tree is untrusted: check the shape before anything is drawn.
    const data: unknown = await resp.json();
    if (!isSupportData(data)) throw new Error("support matrix is not a list of tags");
    return data;
  };

  const cell = (text: string): HTMLTableCellElement => {
    const td = document.createElement("td");
    td.textContent = text;
    return td;
  };
  const draw = (data: SupportData): void => {
    const name = options.name;
    const rows = data.rows.map((entry) => {
      const row = document.createElement("tr");
      row.setAttribute("data-ocx-row", "");
      row.dataset.copy = JSON.stringify(cardCopyData(name, entry.tag, DEFAULT_INSTALL_FLAVORS));
      const platforms = new Set(entry.platforms);
      row.append(cell(entry.tag), ...columns.map((label) => cell(platforms.has(label) ? "✓" : "")));
      if (hasNote) row.append(cell(entry.ephemeral ? "ephemeral: may be pruned" : ""));
      shown.push({ row, platforms });
      return row;
    });
    body.replaceChildren(...rows);
  };

  const filter = (): void => {
    const required = [...host.querySelectorAll<HTMLElement>('[data-matrix-require][aria-pressed="true"]')].map((chip) => String(chip.dataset.matrixRequire));
    let visible = 0;
    for (const { row, platforms } of shown) {
      row.hidden = !required.every((label) => platforms.has(label));
      if (!row.hidden) visible += 1;
    }
    empty.hidden = visible > 0 || shown.length === 0;
  };

  const settle = (state: { busy: boolean; failed: boolean }): void => {
    table.setAttribute("aria-busy", String(state.busy));
    skeleton.hidden = !state.busy;
    error.hidden = !state.failed;
  };

  // One request at a time: a Retry while one is out joins it. A success is drawn once and never fetched again.
  let loading: Promise<void> | undefined;
  const start = (): Promise<void> => {
    if (loading) return loading;
    settle({ busy: true, failed: false });
    return (loading = load().then(
      (data) => {
        draw(data);
        filter();
        settle({ busy: false, failed: false });
      },
      () => {
        loading = undefined;
        settle({ busy: false, failed: true });
      },
    ));
  };

  const onClick = (event: Event): void => {
    // A click's target is an element.
    const target = event.target as Element;
    const chip = target.closest<HTMLElement>("[data-matrix-require]");
    if (chip) {
      chip.setAttribute("aria-pressed", String(chip.getAttribute("aria-pressed") !== "true"));
      filter();
    } else if (target.closest("[data-matrix-retry]")) void start();
  };
  host.addEventListener("click", onClick);

  return { ready: start(), destroy: () => host.removeEventListener("click", onClick) };
}
