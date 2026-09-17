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
  const totalPages = Math.ceil(total / pageSize);
  const el = document.getElementById(containerId);
  if (!el) return;
  if (totalPages <= 1) {
    el.innerHTML = `<div class="page-info">Showing ${total.toLocaleString()} records</div>`;
    return;
  }

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  const pages = [];
  for (let i = Math.max(1, page - 2); i <= Math.min(totalPages, page + 2); i++) {
    pages.push(i);
  }

  const fnName = typeof loadFn === 'function' ? loadFn.name : String(loadFn);
  el.innerHTML = `
    <div class="page-info">Showing ${start}–${end} of ${total.toLocaleString()}</div>
    <button class="page-btn" onclick="${fnName}(1)" ${page === 1 ? 'disabled' : ''} title="First page">«</button>
    <button class="page-btn" onclick="${fnName}(${page - 1})" ${page === 1 ? 'disabled' : ''} title="Previous page">‹</button>
    ${pages.map(p => `<button class="page-btn ${p === page ? 'active' : ''}" onclick="${fnName}(${p})">${p}</button>`).join('')}
    <button class="page-btn" onclick="${fnName}(${page + 1})" ${page === totalPages ? 'disabled' : ''} title="Next page">›</button>
    <button class="page-btn" onclick="${fnName}(${totalPages})" ${page === totalPages ? 'disabled' : ''} title="Last page">»</button>
  `;
}
