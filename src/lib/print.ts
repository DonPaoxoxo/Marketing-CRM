/** Printing, and "Export PDF" through the browser's own Save as PDF.
 *
 *  A PDF library would add a large dependency and still struggle with Hindi,
 *  Indonesian diacritics and emoji. The browser's print engine handles every
 *  script the page can show, so an export is rendered as a clean print document
 *  and handed to the print dialog, where "Save as PDF" is one of the destinations.
 *  Nothing is uploaded anywhere. */

const ROOT_ID = 'print-root';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface PrintTable {
  title: string;
  subtitle?: string;
  headers: string[];
  values: string[][];
  footnote?: string;
}

/** Build the print document for a table. Exported for tests. */
export function printTableHtml(t: PrintTable): string {
  const head = t.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
  const body = t.values.map((r) => `<tr>${r.map((v) => `<td>${escapeHtml(v)}</td>`).join('')}</tr>`).join('');
  return `<h1>${escapeHtml(t.title)}</h1>${t.subtitle ? `<p class="print-meta">${escapeHtml(t.subtitle)}</p>` : ''}`
    + `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
    + (t.footnote ? `<p class="print-meta">${escapeHtml(t.footnote)}</p>` : '');
}

/** Print only the given table (used for Export PDF). */
export function printTable(t: PrintTable): void {
  let root = document.getElementById(ROOT_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = ROOT_ID;
    document.body.appendChild(root);
  }
  root.innerHTML = printTableHtml(t);
  const previousTitle = document.title;
  // Browsers use the document title as the suggested PDF file name.
  document.title = t.title;
  document.body.classList.add('print-export');
  const cleanup = () => {
    document.body.classList.remove('print-export');
    document.title = previousTitle;
    root?.replaceChildren();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
  // Some browsers print synchronously and never fire afterprint in tests.
  setTimeout(cleanup, 1000);
}

/** Print the page as it is on screen, without the navigation and toolbars. */
export function printPage(): void {
  document.body.classList.add('print-page');
  const cleanup = () => { document.body.classList.remove('print-page'); window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  window.print();
  setTimeout(cleanup, 1000);
}
