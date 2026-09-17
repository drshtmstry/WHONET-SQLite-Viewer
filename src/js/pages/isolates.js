import { state } from '../state/store.js';
import { api } from '../api/client.js';
import { toast } from '../ui/toast.js';
import { renderSortHeader, renderPagination } from '../ui/table.js';
import { fmtDate, debounce } from '../utils/formatters.js';
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

export async function loadIsolates(page = 1) {
  const isoBody = document.getElementById('isolates-table-body');
  const countEl = document.getElementById('isolates-count');
  if (!state.currentDb) {
    if (countEl) countEl.textContent = 'Open a database to view isolates';
    if (isoBody) isoBody.innerHTML = '<div class="empty"><div class="empty-title">No database loaded</div></div>';
    return;
  }

  state.isolatesPage = page;
  const datasetVersion = state.datasetVersion;
  const databaseName = state.currentDb;
  const search = encodeURIComponent(document.getElementById('isolates-search')?.value || '');
  const month = encodeURIComponent(document.getElementById('isolates-month-filter')?.value || '');
  const org = encodeURIComponent(document.getElementById('isolates-org-filter')?.value || '');
  const ward = encodeURIComponent(document.getElementById('isolates-ward-filter')?.value || '');
  const sortCol = state.isolatesSortCol || 'ROW_IDX';
  const sortDir = state.isolatesSortDir || 'desc';

  if (isoBody) isoBody.innerHTML = '<div class="loading"><div class="spinner"></div>Loading isolates…</div>';
  const data = await api(`/api/isolates?page=${page}&pageSize=25&search=${search}&month=${month}&organism=${org}&ward=${ward}&sortCol=${sortCol}&sortDir=${sortDir}`);
  if (datasetVersion !== state.datasetVersion || databaseName !== state.currentDb) return;
  if (data.error) return toast(data.error, 'error');

  if (countEl) countEl.textContent = `${data.totalCount.toLocaleString()} records`;

  if (isoBody) {
    isoBody.innerHTML = renderIsolatesTable(data.rows);
    isoBody.scrollTop = 0;
    isoBody.scrollLeft = 0;
  }
  renderPagination('isolates-pagination', page, data.totalCount, 25, loadIsolates);
}

export function renderIsolatesTable(rows) {
  if (!rows || !rows.length) {
    return `<div class="empty"><div class="empty-icon"><i class="fa-solid fa-magnifying-glass"></i></div><div class="empty-title">No records found</div></div>`;
  }
  const sCol = state.isolatesSortCol;
  const sDir = state.isolatesSortDir;
  return `<table>
    <thead><tr>
      ${renderSortHeader('Row', 'ROW_IDX', sCol, sDir, 'sortIsolates')}
      ${renderSortHeader('Specimen #', 'SPEC_NUM', sCol, sDir, 'sortIsolates')}
      ${renderSortHeader('Date', 'SPEC_DATE', sCol, sDir, 'sortIsolates')}
      ${renderSortHeader('Type', 'SPEC_TYPE', sCol, sDir, 'sortIsolates')}
      ${renderSortHeader('Organism', 'ORGANISM', sCol, sDir, 'sortIsolates')}
      ${renderSortHeader('Sex', 'SEX', sCol, sDir, 'sortIsolates')}
      ${renderSortHeader('Age', 'AGE', sCol, sDir, 'sortIsolates')}
      ${renderSortHeader('Ward', 'WARD', sCol, sDir, 'sortIsolates')}
      ${renderSortHeader('ESBL', 'ESBL', sCol, sDir, 'sortIsolates')}
      ${renderSortHeader('Carbapenem', 'CARBAPENEM', sCol, sDir, 'sortIsolates')}
      ${renderSortHeader('MRSA', 'MRSA', sCol, sDir, 'sortIsolates')}
      <th>Actions</th>
    </tr></thead>
    <tbody>
    ${rows.map(r => `<tr>
      <td class="mono">${r.ROW_IDX}</td>
      <td class="mono">${r.SPEC_NUM || '—'}</td>
      <td>${fmtDate(r.SPEC_DATE)}</td>
      <td>${r.SPEC_TYPE || '—'}</td>
      <td>${renderOrgBadge(r.ORGANISM)}</td>
      <td>${r.SEX || '—'}</td>
      <td>${r.AGE || '—'}</td>
      <td>${r.WARD || '—'}</td>
      <td>${r.ESBL ? `<span class="badge badge-${r.ESBL === '+' ? 'r' : 's'}">${r.ESBL}</span>` : '—'}</td>
      <td>${r.CARBAPENEM ? `<span class="badge badge-${r.CARBAPENEM === '+' ? 'r' : 's'}">${r.CARBAPENEM}</span>` : '—'}</td>
      <td>${r.MRSA ? `<span class="badge badge-${r.MRSA === '+' ? 'r' : 's'}">${r.MRSA}</span>` : '—'}</td>
      <td>
        <button class="btn btn-ghost btn-xs" onclick="openEditModal(${r.ROW_IDX})" title="Edit / correct this isolate">Edit</button>
        <button class="btn btn-ghost btn-xs" onclick="viewDetail(${r.ROW_IDX})">View</button>
        <button class="btn btn-danger btn-xs" onclick="confirmDeleteRow(${r.ROW_IDX}, '${(r.SPEC_NUM || '').replace(/'/g, "\\'")}')">Del</button>
      </td>
    </tr>`).join('')}
    </tbody>
  </table>`;
}

export const debouncedLoadIsolates = debounce(() => loadIsolates(1), 350);
