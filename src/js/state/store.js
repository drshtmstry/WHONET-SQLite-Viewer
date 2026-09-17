/**
 * Central Application State & Store
 */
import { escapeHtml } from '../utils/formatters.js';

export const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
export const API_BASE = isLocalHost && (window.location.port === '7890' || window.location.port === '') ? '' : 'http://localhost:7890';

export const state = {
  currentDb: null,
  // Incremented whenever a new database becomes active. Async page requests use
  // this to ignore responses that belong to the previously selected database.
  datasetVersion: 0,
  databases: [],
  stats: {},
  isolatesPage: 1,
  isolatesSortCol: 'ROW_IDX',
  isolatesSortDir: 'desc',
  dupsPage: 1,
  dupSortCol: null,
  dupSortDir: 'asc',
  dupMode: 'spec', // 'spec' | 'patient'
  monthlyAmrData: null,
  fixHistory: [],
  confirmAction: null,
  isWasmMode: false,
  wasmDb: null,
  sqlJsInstance: null,
  dirHandle: null,
  fileHandles: {}, // filename -> FileSystemFileHandle or File
  activeFileHandle: null,
  isModified: false
};

// Simple event bus for state changes
const subscribers = new Set();

export function subscribe(listener) {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

export function notify(event, payload) {
  for (const sub of subscribers) {
    try {
      sub(event, payload);
    } catch (err) {
      console.error('State subscriber error:', err);
    }
  }
}

export function setRuntimeBadge(text, isServer = false) {
  const badge = document.getElementById('runtime-badge');
  if (!badge) return;
  const iconHtml = isServer
    ? '<i class="fa-solid fa-server" aria-hidden="true"></i>'
    : '<i class="fa-solid fa-globe" aria-hidden="true"></i>';
  const cleanText = text.replace(/^[^\w\s]+/, '').trim();
  badge.innerHTML = `${iconHtml} <span>${cleanText}</span>`;
  badge.style.background = isServer ? 'var(--green-bg)' : 'var(--accent-light)';
  badge.style.color = isServer ? 'var(--green)' : 'var(--accent)';
  badge.style.borderColor = isServer ? 'var(--green-border)' : 'var(--accent-glow)';
}

export function updateCurrentFileDisplay(filename) {
  const dbLabel = document.getElementById('db-label');
  if (dbLabel) {
    if (filename) {
      dbLabel.innerHTML = `
        <div class="current-file-badge">
          <span class="current-file-name" title="${escapeHtml(filename)}"><i class="fa-solid fa-database"></i> ${escapeHtml(filename)}</span>
          <span class="current-file-status">Active</span>
        </div>
      `;
    } else {
      dbLabel.textContent = 'No database loaded';
    }
  }

  const dropSub = document.getElementById('dropzone-sub');
  if (dropSub) {
    if (filename) {
      dropSub.innerHTML = `
        <div class="db-dropzone-dataset-row">
          <span>Active dataset:</span>
          <span class="current-file-chip"><i class="fa-solid fa-database"></i> ${escapeHtml(filename)}</span>
        </div>
      `;
    } else {
      dropSub.innerHTML = 'Works directly with standard WHONET files from <code>C:\\WHONET\\Data</code> or custom folders/downloads.';
    }
  }
}

export function markModified() {
  state.isModified = true;
  const saveBtn = document.getElementById('btn-save-file');
  if (saveBtn && state.isWasmMode) {
    saveBtn.style.display = 'inline-flex';
    saveBtn.classList.remove('btn-outline');
    saveBtn.classList.add('btn-success');
    saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save to File *';
  }
  notify('modified', true);
}

export function resetModified() {
  state.isModified = false;
  const saveBtn = document.getElementById('btn-save-file');
  if (saveBtn && state.isWasmMode) {
    saveBtn.classList.remove('btn-success');
    saveBtn.classList.add('btn-outline');
    saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save to File';
  }
  notify('modified', false);
}
