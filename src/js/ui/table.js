/**
 * Table Rendering & Pagination UI Helpers
 */

/**
 * Generates an HTML sortable table header (<th>).
 * @param {string} label User-visible title
 * @param {string} column Column identifier
 * @param {string|null} activeCol Currently active sort column
 * @param {'asc'|'desc'} activeDir Currently active sort direction
 * @param {string} onClickFnName Global function name to call on click
 * @param {string} [extraThAttrs=''] Additional attributes for <th>
 * @returns {string}
 */
export function renderSortHeader(label, column, activeCol, activeDir, onClickFnName, extraThAttrs = '') {
  const isSorted = activeCol === column;
  let iconHtml = '<i class="fa-solid fa-sort sort-icon"></i>';
  let sortedClass = '';
  let ariaSort = 'none';
  if (isSorted) {
    sortedClass = ' is-sorted';
    ariaSort = activeDir === 'asc' ? 'ascending' : 'descending';
    iconHtml = activeDir === 'asc'
      ? '<i class="fa-solid fa-arrow-up-short-wide sort-icon active"></i>'
      : '<i class="fa-solid fa-arrow-down-wide-short sort-icon active"></i>';
  }
  const nextDir = isSorted && activeDir === 'asc' ? 'descending' : 'ascending';
  let extraClass = '';
  let cleanedAttrs = extraThAttrs;
  const classMatch = extraThAttrs.match(/class=["']([^"']+)["']/i);
  if (classMatch) {
    extraClass = ' ' + classMatch[1];
    cleanedAttrs = extraThAttrs.replace(/class=["'][^"']+["']/i, '').trim();
  }
  return `<th scope="col" role="columnheader" aria-sort="${ariaSort}" tabindex="0" class="sortable${sortedClass}${extraClass}" onclick="${onClickFnName}('${column}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();${onClickFnName}('${column}');}" title="Click to sort by ${label} (${nextDir})" ${cleanedAttrs}>
    <div class="th-sort-content">
      <span>${label}</span>
      ${iconHtml}
    </div>
  </th>`;
}

/**
 * Renders pagination controls into a container element.
 * @param {string} containerId 
 * @param {number} page 
 * @param {number} total 
 * @param {number} pageSize 
 * @param {Function|string} loadFn 
 */
export function renderPagination(containerId, page, total, pageSize, loadFn) {
  const numPage = parseInt(page, 10) || 1;
  const numTotal = parseInt(total, 10) || 0;
  const numPageSize = parseInt(pageSize, 10) || 25;
  const totalPages = Math.ceil(numTotal / numPageSize);
  const el = document.getElementById(containerId);
  if (!el) return;

  if (totalPages <= 1) {
    el.innerHTML = `<div class="page-info">Showing ${numTotal.toLocaleString()} records</div>`;
    el.onclick = null;
    return;
  }

  const start = (numPage - 1) * numPageSize + 1;
  const end = Math.min(numPage * numPageSize, numTotal);

  const pages = [];
  for (let i = Math.max(1, numPage - 2); i <= Math.min(totalPages, numPage + 2); i++) {
    pages.push(i);
  }

  const fnName = typeof loadFn === 'string' ? loadFn : (loadFn?.name || '');
  const inlineCall = (targetPage) => fnName ? `if(typeof window['${fnName}'] === 'function'){window['${fnName}'](${targetPage});}` : '';

  el.innerHTML = `
    <div class="page-info">Showing ${start}–${end} of ${numTotal.toLocaleString()}</div>
    <button type="button" class="page-btn" data-page="1" onclick="${inlineCall(1)}" ${numPage === 1 ? 'disabled' : ''} title="First page" aria-label="First page">«</button>
    <button type="button" class="page-btn" data-page="${numPage - 1}" onclick="${inlineCall(numPage - 1)}" ${numPage === 1 ? 'disabled' : ''} title="Previous page" aria-label="Previous page">‹</button>
    ${pages.map(p => `<button type="button" class="page-btn ${p === numPage ? 'active' : ''}" data-page="${p}" onclick="${inlineCall(p)}" aria-label="Page ${p}" ${p === numPage ? 'aria-current="page"' : ''}>${p}</button>`).join('')}
    <button type="button" class="page-btn" data-page="${numPage + 1}" onclick="${inlineCall(numPage + 1)}" ${numPage === totalPages ? 'disabled' : ''} title="Next page" aria-label="Next page">›</button>
    <button type="button" class="page-btn" data-page="${totalPages}" onclick="${inlineCall(totalPages)}" ${numPage === totalPages ? 'disabled' : ''} title="Last page" aria-label="Last page">»</button>
  `;

  // Container click listener ensures navigation works even when function names are minified/mangled
  el.onclick = (e) => {
    const btn = e.target.closest('.page-btn');
    if (!btn || btn.disabled) return;
    const targetPage = parseInt(btn.dataset.page, 10);
    if (isNaN(targetPage) || targetPage < 1 || targetPage > totalPages || targetPage === numPage) return;
    if (typeof loadFn === 'function') {
      loadFn(targetPage);
    } else if (typeof loadFn === 'string' && typeof window[loadFn] === 'function') {
      window[loadFn](targetPage);
    }
  };
}
