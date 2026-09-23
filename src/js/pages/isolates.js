import { state } from '../state/store.js';
import { api } from '../api/client.js';
import { toast } from '../ui/toast.js';
import { renderSortHeader, renderPagination } from '../ui/table.js';
import { fmtDate, formatAgeSex, debounce, escapeHtml } from '../utils/formatters.js';
import { renderOrgBadge } from '../utils/organisms.js';

export function sortIsolates(column) {
  if (state.isolatesSortCol === column) {
    state.isolatesSortDir = state.isolatesSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    state.isolatesSortCol = column;
    state.isolatesSortDir = 'asc';
  }
  loadIsolates(1);
}

export function syncIsolateColCheckboxes() {
  const vis = state.visibleIsolateCols || { esbl: false, carba: false, mrsa: false };
  ['esbl', 'carba', 'mrsa'].forEach(key => {
    const chk = document.getElementById(`col-toggle-${key}`);
    if (chk) chk.checked = !!vis[key];
  });
}

export function toggleIsolateCol(colKey) {
  if (!state.visibleIsolateCols) {
    state.visibleIsolateCols = { esbl: false, carba: false, mrsa: false };
  }
  state.visibleIsolateCols[colKey] = !state.visibleIsolateCols[colKey];
  try {
    localStorage.setItem('whonet-isolate-cols', JSON.stringify(state.visibleIsolateCols));
  } catch (_) {}

  // Update checkbox state in DOM if present
  const chk = document.getElementById(`col-toggle-${colKey}`);
  if (chk) chk.checked = state.visibleIsolateCols[colKey];

  // Re-render table with current cached rows if table is populated
  const isoBody = document.getElementById('isolates-table-body');
  if (isoBody && state._lastIsolateRows) {
    isoBody.innerHTML = renderIsolatesTable(state._lastIsolateRows);
  } else {
    loadIsolates(state.isolatesPage || 1);
  }
}

export async function loadIsolates(page = 1) {
  const numPage = parseInt(page, 10) || 1;
  syncIsolateColCheckboxes();
  const isoBody = document.getElementById('isolates-table-body');
  const countEl = document.getElementById('isolates-count');
  if (!state.currentDb) {
    if (countEl) countEl.textContent = 'Open a database to view isolates';
    if (isoBody) isoBody.innerHTML = '<div class="empty"><div class="empty-title">No database loaded</div></div>';
    return;
  }

  state.isolatesPage = numPage;
  const datasetVersion = state.datasetVersion;
  const databaseName = state.currentDb;
  const search = encodeURIComponent(document.getElementById('isolates-search')?.value || '');
  const month = encodeURIComponent(document.getElementById('isolates-month-filter')?.value || '');
  const org = encodeURIComponent(document.getElementById('isolates-org-filter')?.value || '');
  const ward = encodeURIComponent(document.getElementById('isolates-ward-filter')?.value || '');
  const sortCol = state.isolatesSortCol || 'ROW_IDX';
  const sortDir = state.isolatesSortDir || 'desc';

  if (isoBody) isoBody.innerHTML = '<div class="loading"><div class="spinner"></div>Loading isolates…</div>';
  const data = await api(`/api/isolates?page=${numPage}&pageSize=25&search=${search}&month=${month}&organism=${org}&ward=${ward}&sortCol=${sortCol}&sortDir=${sortDir}`);
  if (datasetVersion !== state.datasetVersion || databaseName !== state.currentDb) return;
  if (data.error) return toast(data.error, 'error');

  state._lastIsolateRows = data.rows || [];
  if (countEl) countEl.textContent = `${data.totalCount.toLocaleString()} records`;

  if (isoBody) {
    isoBody.innerHTML = renderIsolatesTable(data.rows);
    isoBody.scrollTop = 0;
    isoBody.scrollLeft = 0;
    attachIsolatesTableListeners(isoBody);
  }
  renderPagination('isolates-pagination', numPage, data.totalCount, 25, loadIsolates);
}

function attachIsolatesTableListeners(container) {
  if (!container || container._hasActionsListener) return;
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const rowIdx = parseInt(btn.dataset.rowIdx, 10);
    if (isNaN(rowIdx)) return;
    if (action === 'delete') {
      const specNum = btn.dataset.specNum || '';
      if (typeof confirmDeleteRow === 'function') {
        confirmDeleteRow(rowIdx, specNum);
      } else if (typeof window.confirmDeleteRow === 'function') {
        window.confirmDeleteRow(rowIdx, specNum);
      }
    } else if (action === 'edit') {
      if (typeof openEditModal === 'function') openEditModal(rowIdx);
      else if (typeof window.openEditModal === 'function') window.openEditModal(rowIdx);
    } else if (action === 'view') {
      if (typeof viewDetail === 'function') viewDetail(rowIdx);
      else if (typeof window.viewDetail === 'function') window.viewDetail(rowIdx);
    }
  });
  container._hasActionsListener = true;
}

export function renderIsolatesTable(rows) {
  if (!rows || !rows.length) {
    return `<div class="empty"><div class="empty-icon"><i class="fa-solid fa-magnifying-glass"></i></div><div class="empty-title">No records found</div></div>`;
  }
  const sCol = state.isolatesSortCol;
  const sDir = state.isolatesSortDir;
  const showEsbl = !!state.visibleIsolateCols?.esbl;
  const showCarba = !!state.visibleIsolateCols?.carba;
  const showMrsa = !!state.visibleIsolateCols?.mrsa;

  return `<table>
    <thead><tr>
      ${renderSortHeader('Row', 'ROW_IDX', sCol, sDir, 'sortIsolates')}
      ${renderSortHeader('Specimen #', 'SPEC_NUM', sCol, sDir, 'sortIsolates')}
      <th class="col-name">Patient Name</th>
      <th class="col-agesex">Age/Sex</th>
      ${renderSortHeader('Date', 'SPEC_DATE', sCol, sDir, 'sortIsolates')}
      ${renderSortHeader('Type', 'SPEC_TYPE', sCol, sDir, 'sortIsolates')}
      ${renderSortHeader('Organism', 'ORGANISM', sCol, sDir, 'sortIsolates')}
      ${renderSortHeader('Ward', 'WARD', sCol, sDir, 'sortIsolates')}
      ${showEsbl ? renderSortHeader('ESBL', 'ESBL', sCol, sDir, 'sortIsolates') : ''}
      ${showCarba ? renderSortHeader('Carbapenem', 'CARBAPENEM', sCol, sDir, 'sortIsolates') : ''}
      ${showMrsa ? renderSortHeader('MRSA', 'MRSA', sCol, sDir, 'sortIsolates') : ''}
      <th>Actions</th>
    </tr></thead>
    <tbody>
    ${rows.map(r => {
      const fullName = (r.FULL_NAME || '').trim() || '—';
      const safeFullName = escapeHtml(fullName);
      const safeSpecNum = escapeHtml(JSON.stringify(r.SPEC_NUM || ''));
      const safeSpecNumAttr = escapeHtml(r.SPEC_NUM || '');
      const ageSex = formatAgeSex(r.AGE, r.SEX);
      return `<tr>
      <td class="mono">${r.ROW_IDX}</td>
      <td class="mono">${escapeHtml(r.SPEC_NUM || '—')}</td>
      <td class="pt-name col-name" title="${safeFullName}"><span class="cell-truncate">${safeFullName}</span></td>
      <td class="col-agesex">${ageSex}</td>
      <td>${fmtDate(r.SPEC_DATE)}</td>
      <td>${escapeHtml(r.SPEC_TYPE || '—')}</td>
      <td>${renderOrgBadge(r.ORGANISM)}</td>
      <td>${escapeHtml(r.WARD || '—')}</td>
      ${showEsbl ? `<td>${r.ESBL ? `<span class="badge badge-${r.ESBL === '+' ? 'r' : 's'}">${r.ESBL}</span>` : '—'}</td>` : ''}
      ${showCarba ? `<td>${r.CARBAPENEM ? `<span class="badge badge-${r.CARBAPENEM === '+' ? 'r' : 's'}">${r.CARBAPENEM}</span>` : '—'}</td>` : ''}
      ${showMrsa ? `<td>${r.MRSA ? `<span class="badge badge-${r.MRSA === '+' ? 'r' : 's'}">${r.MRSA}</span>` : '—'}</td>` : ''}
      <td class="col-actions">
        <div class="row-actions-group">
          <button type="button" class="btn btn-ghost btn-icon-sm" data-action="edit" data-row-idx="${r.ROW_IDX}" onclick="openEditModal(${r.ROW_IDX})" title="Edit / correct this isolate" aria-label="Edit isolate">
            <i class="fa-solid fa-pen-to-square"></i>
          </button>
          <button type="button" class="btn btn-ghost btn-icon-sm" data-action="view" data-row-idx="${r.ROW_IDX}" onclick="viewDetail(${r.ROW_IDX})" title="View isolate details" aria-label="View isolate details">
            <i class="fa-solid fa-eye"></i>
          </button>
          <button type="button" class="btn btn-danger btn-icon-sm" data-action="delete" data-row-idx="${r.ROW_IDX}" data-spec-num="${safeSpecNumAttr}" onclick="confirmDeleteRow(${r.ROW_IDX}, ${safeSpecNum})" title="Delete this isolate" aria-label="Delete isolate">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      </td>
    </tr>`;
    }).join('')}
    </tbody>
  </table>`;
}

export const debouncedLoadIsolates = debounce(() => loadIsolates(1), 350);

