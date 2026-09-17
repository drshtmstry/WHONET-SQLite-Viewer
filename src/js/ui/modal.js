import { api } from '../api/client.js';
import { toast } from './toast.js';
import { escapeHtml } from '../utils/formatters.js';
import { getOrganismName } from '../utils/organisms.js';
import { state } from '../state/store.js';

export const EDITABLE = [
  'SPEC_NUM', 'PATIENT_ID', 'SPEC_DATE', 'SPEC_TYPE', 'ORGANISM',
  'FULL_NAME', 'SEX', 'AGE', 'WARD', 'DEPARTMENT', 'INSTITUT',
  'DATE_ADMIS', 'DATE_DATA', 'COMMENT', 'ESBL', 'CARBAPENEM',
  'MRSA', 'URINECOUNT', 'SEROTYPE', 'BETA_LACT', 'INDUC_CLI'
];

let refreshListeners = [];

export function onDataMutated(callback) {
  if (typeof callback === 'function') {
    refreshListeners.push(callback);
  }
}

export function notifyDataMutated(hint) {
  for (const fn of refreshListeners) {
    try { fn(hint); } catch (e) { console.error('Data mutation callback error:', e); }
  }
}

// ── Detail Modal ──
export async function viewDetail(rowIdx) {
  const data = await api(`/api/isolate/${rowIdx}`);
  if (data.error) return toast(data.error, 'error');
  const r = data.row;

  const modalTitle = document.getElementById('modal-title');
  if (modalTitle) {
    modalTitle.textContent = `Isolate #${r.ROW_IDX} — ${r.SPEC_NUM || 'No Specimen #'}`;
  }

  const fields = [
    ['SPEC_NUM', 'Specimen Number'], ['PATIENT_ID', 'Patient ID'], ['SPEC_DATE', 'Specimen Date'], ['SPEC_TYPE', 'Specimen Type'],
    ['ORGANISM', 'Organism'], ['FULL_NAME', 'Full Name'], ['SEX', 'Sex'], ['AGE', 'Age'],
    ['WARD', 'Ward'], ['DEPARTMENT', 'Department'], ['INSTITUT', 'Institution'],
    ['DATE_ADMIS', 'Admission Date'], ['DATE_DATA', 'Entry Date'],
    ['ESBL', 'ESBL'], ['CARBAPENEM', 'Carbapenem'], ['MRSA', 'MRSA'],
    ['URINECOUNT', 'Urine Count'], ['SEROTYPE', 'Serotype'], ['BETA_LACT', 'Beta-Lactamase'],
    ['INDUC_CLI', 'Inducible Clinda'], ['COMMENT', 'Comment']
  ];

  const modalBody = document.getElementById('modal-body');
  if (modalBody) {
    modalBody.innerHTML = `
      <div class="detail-grid">
        ${fields.map(([key, label]) => {
          const editable = EDITABLE.includes(key);
          let valDisplay = r[key] || '<span style="color:var(--text3)">—</span>';
          if (key === 'ORGANISM' && r[key]) {
            const orgName = getOrganismName(r[key]);
            if (orgName) {
              valDisplay = `${r[key]} <span style="font-size:12px;color:var(--text3);font-weight:normal">(${orgName})</span>`;
            }
          }
          return `<div class="detail-field ${editable ? 'editable' : ''}">
            <label>${label}</label>
            ${editable
              ? `<div class="field-val" id="fv-${rowIdx}-${key}" onclick="startEdit(${rowIdx},'${key}')">${valDisplay}</div>`
              : `<div class="field-val">${valDisplay}</div>`}
          </div>`;
        }).join('')}
      </div>
      <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border);display:flex;gap:10px;justify-content:flex-end;">
        <button class="btn btn-ghost btn-sm" onclick="closeModal();openEditModal(${r.ROW_IDX})">
          <i class="fa-solid fa-pen-to-square"></i> Edit All Fields
        </button>
        <button class="btn btn-danger btn-sm" onclick="confirmDeleteRow(${r.ROW_IDX}, '${(r.SPEC_NUM || '').replace(/'/g, "\\'")}');closeModal()">
          Delete This Record
        </button>
      </div>
    `;
  }

  const detailModal = document.getElementById('detail-modal');
  if (detailModal) detailModal.classList.add('open');
}

export function closeModal() {
  const detailModal = document.getElementById('detail-modal');
  if (detailModal) detailModal.classList.remove('open');
}

export function startEdit(rowIdx, field) {
  const el = document.getElementById(`fv-${rowIdx}-${field}`);
  if (!el) return;
  const current = el.textContent.trim() === '—' ? '' : el.textContent.trim();
  el.innerHTML = `<input class="field-input" id="fi-${rowIdx}-${field}" value="${current.replace(/"/g, '&quot;')}" onblur="saveEdit(${rowIdx},'${field}')" onkeydown="if(event.key==='Enter')saveEdit(${rowIdx},'${field}');if(event.key==='Escape')cancelEdit(${rowIdx},'${field}','${current}')">`;
  const fi = document.getElementById(`fi-${rowIdx}-${field}`);
  if (fi) fi.focus();
}

export async function saveEdit(rowIdx, field) {
  const inp = document.getElementById(`fi-${rowIdx}-${field}`);
  if (!inp) return;
  const value = inp.value;
  const data = await api('/api/update-field', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ row_idx: rowIdx, field, value })
  });
  const el = document.getElementById(`fv-${rowIdx}-${field}`);
  if (data.error) {
    toast(data.error, 'error');
    if (el) el.innerHTML = value || '<span style="color:var(--text3)">—</span>';
  } else {
    if (el) el.innerHTML = value || '<span style="color:var(--text3)">—</span>';
    toast(`${field} updated`, 'success');
    notifyDataMutated('single-field');
  }
}

export function cancelEdit(rowIdx, field, original) {
  const el = document.getElementById(`fv-${rowIdx}-${field}`);
  if (el) el.innerHTML = original || '<span style="color:var(--text3)">—</span>';
}

// ── Edit Modal for Corrections ──
export async function openEditModal(rowIdx) {
  const data = await api(`/api/isolate/${rowIdx}`);
  if (data.error) return toast(data.error, 'error');
  const r = data.row;

  const title = document.getElementById('edit-modal-title');
  if (title) {
    title.innerHTML = `<i class="fa-solid fa-pen-to-square"></i> Edit Isolate #${r.ROW_IDX} — ${escapeHtml(r.SPEC_NUM || 'No Specimen #')}`;
  }

  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  };

  setVal('edit-row-idx', r.ROW_IDX);
  setVal('edit-spec-num', r.SPEC_NUM || '');
  setVal('edit-patient-id', r.PATIENT_ID || '');
  setVal('edit-full-name', r.FULL_NAME || '');
  setVal('edit-spec-date', r.SPEC_DATE ? r.SPEC_DATE.split(' ')[0] : '');
  setVal('edit-spec-type', r.SPEC_TYPE || '');
  setVal('edit-organism', r.ORGANISM || '');
  setVal('edit-ward', r.WARD || '');
  setVal('edit-department', r.DEPARTMENT || '');
  setVal('edit-sex', (r.SEX || '').toLowerCase());
  setVal('edit-age', r.AGE || '');
  setVal('edit-comment', r.COMMENT || '');

  const editModal = document.getElementById('edit-modal');
  if (editModal) editModal.classList.add('open');
}

export function closeEditModal() {
  const editModal = document.getElementById('edit-modal');
  if (editModal) editModal.classList.remove('open');
}

export async function saveEditModal(e) {
  if (e && e.preventDefault) e.preventDefault();
  const rowIdxEl = document.getElementById('edit-row-idx');
  const rowIdx = rowIdxEl ? parseInt(rowIdxEl.value, 10) : 0;
  if (!rowIdx) return;

  const saveBtn = document.getElementById('edit-save-btn');
  if (saveBtn) saveBtn.disabled = true;

  const getVal = (id) => {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
  };

  const fields = {
    SPEC_NUM: getVal('edit-spec-num'),
    PATIENT_ID: getVal('edit-patient-id'),
    FULL_NAME: getVal('edit-full-name'),
    SPEC_DATE: getVal('edit-spec-date'),
    SPEC_TYPE: getVal('edit-spec-type'),
    ORGANISM: getVal('edit-organism'),
    WARD: getVal('edit-ward'),
    DEPARTMENT: getVal('edit-department'),
    SEX: getVal('edit-sex'),
    AGE: getVal('edit-age'),
    COMMENT: getVal('edit-comment')
  };

  const data = await api('/api/update-row', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ row_idx: rowIdx, fields })
  });

  if (saveBtn) saveBtn.disabled = false;

  if (data.error) {
    return toast(data.error, 'error');
  }

  toast(`Isolate #${rowIdx} successfully updated`, 'success');
  closeEditModal();
  notifyDataMutated('full-row');
}

// ── Confirm Modal ──
export function confirmDeleteRow(rowIdx, specNum) {
  const title = document.getElementById('confirm-title');
  const body = document.getElementById('confirm-body');
  if (title) title.textContent = 'Delete Record';
  if (body) {
    body.innerHTML = `
      <div class="confirm-danger"><i class="fa-solid fa-triangle-exclamation"></i> This will permanently delete isolate <strong>#${rowIdx}</strong> (Specimen: <strong>${escapeHtml(specNum)}</strong>).<br><br>This action cannot be undone.</div>
    `;
  }
  state.confirmAction = async () => {
    const data = await api('/api/delete-row', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ row_idx: rowIdx })
    });
    if (data.error) return toast(data.error, 'error');
    toast(`Row #${rowIdx} deleted`, 'success');
    notifyDataMutated('delete-row');
  };
  const confirmModal = document.getElementById('confirm-modal');
  if (confirmModal) confirmModal.classList.add('open');
}

export function confirmDeleteDupGroup(specNum) {
  const title = document.getElementById('confirm-title');
  const body = document.getElementById('confirm-body');
  if (title) title.textContent = 'Keep Only First Record';
  if (body) {
    body.innerHTML = `
      <div class="confirm-danger"><i class="fa-solid fa-triangle-exclamation"></i> This will delete all <strong>duplicate records</strong> for Specimen # <strong>${escapeHtml(specNum)}</strong>, keeping only the first (lowest ROW_IDX).<br><br>This action cannot be undone.</div>
    `;
  }
  state.confirmAction = async () => {
    const data = await api('/api/delete-duplicates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spec_num: specNum })
    });
    if (data.error) return toast(data.error, 'error');
    toast(`Deleted ${data.changes} duplicate(s) for ${specNum}`, 'success');
    notifyDataMutated('delete-duplicates');
  };
  const confirmModal = document.getElementById('confirm-modal');
  if (confirmModal) confirmModal.classList.add('open');
}

export function confirmDeleteSelectedDups() {
  const selectedCheckboxes = Array.from(document.querySelectorAll('.dup-row-check:checked'));
  const rowIndices = selectedCheckboxes.map(cb => parseInt(cb.value, 10)).filter(n => !isNaN(n));
  if (!rowIndices.length) {
    return toast('No isolates selected for deletion', 'warn');
  }

  const title = document.getElementById('confirm-title');
  const body = document.getElementById('confirm-body');
  if (title) title.textContent = `Delete ${rowIndices.length} Selected Record(s)`;
  if (body) {
    body.innerHTML = `
      <div class="confirm-danger">
        <i class="fa-solid fa-triangle-exclamation"></i> This will permanently delete <strong>${rowIndices.length}</strong> selected isolate(s) from the database.<br><br>
        This action cannot be undone. Are you sure you want to proceed?
      </div>
    `;
  }
  state.confirmAction = async () => {
    const data = await api('/api/delete-rows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ row_indices: rowIndices })
    });
    if (data.error) return toast(data.error, 'error');
    toast(`Deleted ${data.changes ?? rowIndices.length} isolate(s)`, 'success');
    notifyDataMutated('delete-rows');
  };
  const confirmModal = document.getElementById('confirm-modal');
  if (confirmModal) confirmModal.classList.add('open');
}

export function closeConfirm() {
  const confirmModal = document.getElementById('confirm-modal');
  if (confirmModal) confirmModal.classList.remove('open');
  state.confirmAction = null;
}

export async function executeConfirm() {
  if (state.confirmAction) await state.confirmAction();
  closeConfirm();
}
