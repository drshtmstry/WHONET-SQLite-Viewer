import { api } from '../api/client.js';
import { toast } from '../ui/toast.js';
import { state } from '../state/store.js';

export async function bulkFix(op) {
  const data = await api('/api/bulk-fix', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation: op })
  });
  if (data.error) return toast(data.error, 'error');

  toast(`${data.description}: ${data.changes} rows updated`, 'success');

  const histEl = document.getElementById('fix-history');
  if (histEl) {
    const item = document.createElement('div');
    item.style.cssText = 'background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:12px 16px;display:flex;align-items:center;gap:12px;';
    item.innerHTML = `
      <span style="color:var(--green);font-size:16px"><i class="fa-solid fa-check"></i></span>
      <div style="flex:1">
        <div style="font-weight:600;font-size:13.5px">${data.description}</div>
        <div style="font-size:12px;color:var(--text3)">${data.changes} rows affected · ${new Date().toLocaleTimeString()}</div>
      </div>
      <span style="font-family:JetBrains Mono,monospace;font-size:12px;color:var(--accent2)">op: ${op}</span>
    `;
    if (histEl.querySelector('.empty')) histEl.innerHTML = '';
    histEl.prepend(item);
  }

  if (typeof window.loadStats === 'function') {
    window.loadStats();
  }
}

export async function fixCasingAndRefresh() {
  const data = await api('/api/bulk-fix', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation: 'upper_spec_num' })
  });
  if (data.error) return toast(data.error, 'error');
  if (data.changes === 0) {
    toast('All SPEC_NUMs are already uppercase', 'info');
  } else {
    toast(`Normalized ${data.changes} SPEC_NUM(s) to UPPERCASE`, 'success');
  }
  const casingBanner = document.getElementById('casing-banner');
  if (casingBanner) {
    casingBanner.style.display = 'none';
  }
  if (typeof window.loadStats === 'function') {
    window.loadStats();
  }
  if (typeof window.loadDuplicates === 'function') {
    window.loadDuplicates(state.dupsPage || 1);
  }
}
