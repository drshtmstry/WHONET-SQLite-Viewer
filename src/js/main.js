/**
 * WHONET SQLite Viewer - Modern ES Module Entry Point
 * Orchestrates state, views, WASM SQLite engine, and UI interactions.
 */

// ── State & API ──
import { state, isLocalHost, setRuntimeBadge, updateCurrentFileDisplay } from './state/store.js';
import { api, API_BASE } from './api/client.js';

// ── Utils & UI Helpers ──
import { escapeHtml, fmtDate, formatAmrMonthLabel, debounce, isSqliteDatabase, isSampleDb } from './utils/formatters.js';
import { naturalKey, naturalCompare } from './utils/natural-sort.js';
import { getOrganismName, renderOrgBadge } from './utils/organisms.js';
import { renderSortHeader, renderPagination } from './ui/table.js';
import { toast } from './ui/toast.js';

// ── Modals & Dialogs ──
import {
  viewDetail, closeModal, startEdit, saveEdit, cancelEdit,
  openEditModal, closeEditModal, saveEditModal,
  confirmDeleteRow, confirmDeleteDupGroup, confirmDeleteSelectedDups,
  closeConfirm, executeConfirm, onDataMutated
} from './ui/modal.js';

// ── Database & Filesystem ──
import {
  getSqlJs, wasmSelect, wasmRun, ensureWasmFunctions, normaliseSchema,
  autoSaveToHandle, saveToFileHandle, exportSqliteDatabase
} from './db/wasm.js';
import {
  saveWhonetFolderHandle, getSavedWhonetFolderHandle, scanWhonetFolder,
  restoreWhonetFolder, chooseWhonetFolder, handleFolderSelected,
  renderLaunchDbSelect, checkNoticeModal, proceedToDataSourceModal,
  selectFromLaunchList, triggerBrowseFile, handleLaunchFileUpload, loadSampleFromLaunch
} from './db/filesystem.js';

// ── Page Controllers ──
import {
  loadStats, setChartTypeMode, onPeriodFilterChange, resetChartZoom,
  updateDashboardCharts, renderDbSelector, switchDb, loadSampleDatabase,
  handleFileUpload, handleFileDrop
} from './pages/dashboard.js';
import {
  sortIsolates, loadIsolates, renderIsolatesTable, debouncedLoadIsolates, toggleIsolateCol
} from './pages/isolates.js';
import {
  setDupMode, sortDuplicates, groupRows, loadDuplicates,
  renderDuplicatesTable, toggleSelectAllDups, updateDupSelectedState, debouncedLoadDups
} from './pages/duplicates.js';
import {
  loadMonthlyAmrData, renderAmrTable, getAmrRowsData, copyAmrTableTsv, exportAmrCsv
} from './pages/monthly-amr.js';
import {
  refreshSqlSchema, initSqlAutocomplete, insertSQL, clearSQL,
  sortSqlTable, renderSqlResultTable, runSQL
} from './pages/sql-workspace.js';
import {
  bulkFix, fixCasingAndRefresh
} from './pages/fixes.js';

// ── Theme Management ──
export function initTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem('whonet-theme');
  } catch (e) { }

  const effectiveTheme = (saved === 'dark' || saved === 'light')
    ? saved
    : (document.documentElement.getAttribute('data-theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

  document.documentElement.setAttribute('data-theme', effectiveTheme);
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute('content', effectiveTheme === 'dark' ? '#0b0f19' : '#4f46e5');

  updateThemeToggleBtn(effectiveTheme);
  if (typeof Chart !== 'undefined') {
    Chart.defaults.color = effectiveTheme === 'dark' ? '#e2e8f0' : '#334155';
  }
}

export function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme);
  try {
    localStorage.setItem('whonet-theme', newTheme);
  } catch (e) { }
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute('content', newTheme === 'dark' ? '#0b0f19' : '#4f46e5');
  updateThemeToggleBtn(newTheme);
  if (typeof Chart !== 'undefined') {
    Chart.defaults.color = newTheme === 'dark' ? '#e2e8f0' : '#334155';
  }
  if (state.currentDb) {
    updateDashboardCharts();
  }
}

export function updateThemeToggleBtn(theme) {
  const btn = document.getElementById('theme-toggle-btn');
  if (btn) {
    const icon = btn.querySelector('i');
    const label = btn.querySelector('#theme-toggle-label');
    const isDark = theme === 'dark';
    if (icon) icon.className = isDark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    if (label) label.textContent = isDark ? 'Light Mode' : 'Dark Mode';
    btn.title = isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode';
    btn.setAttribute('aria-label', btn.title);
  }
}

export function toggleMobileSidebar(force) {
  const sidebar = document.getElementById('app-sidebar');
  const toggle = document.querySelector('.mobile-nav-toggle');
  const backdrop = document.querySelector('.mobile-sidebar-backdrop');
  if (!sidebar || !toggle || !backdrop) return;

  const isOpen = typeof force === 'boolean' ? force : !sidebar.classList.contains('open');
  sidebar.classList.toggle('open', isOpen);
  backdrop.classList.toggle('open', isOpen);
  toggle.setAttribute('aria-expanded', String(isOpen));
  toggle.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
  toggle.setAttribute('title', isOpen ? 'Close navigation' : 'Open navigation');
  document.body.classList.toggle('mobile-nav-open', isOpen);
}

// ── Page Routing ──
export function showPage(name) {
  toggleMobileSidebar(false);
  state.currentPage = name;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const targetPage = document.getElementById('page-' + name);
  const targetNav = document.getElementById('nav-' + name);
  if (targetPage) targetPage.classList.add('active');
  if (targetNav) targetNav.classList.add('active');

  const mainEl = document.querySelector('.main');
  if (mainEl) {
    const noScrollPages = ['sql', 'isolates', 'duplicates'];
    mainEl.classList.toggle('page-no-scroll', noScrollPages.includes(name));
    mainEl.classList.toggle('page-sql-active', name === 'sql');
  }

  if (name === 'isolates') {
    if (state.currentDb) loadIsolates(1);
    else {
      const isoBody = document.getElementById('isolates-table-body');
      const countEl = document.getElementById('isolates-count');
      if (countEl) countEl.textContent = 'Open a database to view isolates';
      if (isoBody) {
        isoBody.innerHTML = `
          <div class="empty">
            <div class="empty-icon"><i class="fa-solid fa-database"></i></div>
            <div class="empty-title">No database loaded</div>
            <div class="empty-desc">Please open or upload a WHONET SQLite database to view isolates.</div>
          </div>`;
      }
    }
  }
  if (name === 'duplicates') {
    if (state.currentDb) loadDuplicates(1);
    else {
      const dupBody = document.getElementById('dup-table-body');
      const countEl = document.getElementById('dup-count');
      const casingBanner = document.getElementById('casing-banner');
      if (casingBanner) casingBanner.style.display = 'none';
      if (countEl) countEl.textContent = 'Open a database to view duplicates';
      if (dupBody) {
        dupBody.innerHTML = `
          <div class="empty">
            <div class="empty-icon"><i class="fa-solid fa-database"></i></div>
            <div class="empty-title">No database loaded</div>
            <div class="empty-desc">Please open or upload a WHONET SQLite database to inspect duplicate records.</div>
          </div>`;
      }
    }
  }
  if (name === 'dashboard' && state.currentDb) loadStats();
  if (name === 'monthly-amr') {
    if (state.currentDb) loadMonthlyAmrData();
    else {
      const amrBody = document.getElementById('amr-table-body');
      if (amrBody) {
        amrBody.innerHTML = `
          <tr>
            <td colspan="23" style="padding: 32px; text-align: center; color: var(--text3); font-weight: 500;">
              No database loaded — please open or select a WHONET database to view surveillance data.
            </td>
          </tr>`;
      }
    }
  }
  if (name === 'sql') {
    initSqlAutocomplete();
    refreshSqlSchema();
  }
}

// ── Connect Mutation Callback ──
onDataMutated((hint) => {
  loadStats();
  loadDuplicates(state.dupsPage || 1);
  if (state.currentPage === 'isolates') {
    loadIsolates(state.isolatesPage || 1);
  }
});

// ── App Initialization ──
export async function init() {
  initTheme();
  initSqlAutocomplete();

  if (isLocalHost) {
    try {
      const res = await fetch(API_BASE + '/api/databases');
      const data = await res.json();
      if (data && Array.isArray(data.databases)) {
        state.isWasmMode = false;
        state.databases = data.databases;
        state.currentDb = data.current;
        setRuntimeBadge('Local SQLite Server (Node.js)', true);
        renderDbSelector();
        if (state.currentDb) {
          await loadStats();
          refreshSqlSchema();
        }
        return;
      }
    } catch (e) {
      console.info('Local server unavailable, enabling in-browser SQLite mode:', e.message);
    }
  }

  // Fallback to in-browser engine mode
  state.isWasmMode = true;
  setRuntimeBadge('In-Browser Engine (Client-side)', false);
  const btnOpenPath = document.getElementById('btn-open-path');
  if (btnOpenPath) btnOpenPath.style.display = 'none';
  renderDbSelector();
  await restoreWhonetFolder();
}

// ── Global Event Handlers & Shortcuts ──
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    // Dismiss topmost open modal
    const openModals = Array.from(document.querySelectorAll('.modal-overlay.open'));
    if (openModals.length > 0) {
      const topModal = openModals[openModals.length - 1];
      topModal.classList.remove('open');
      if (topModal.id === 'detail-modal') closeModal();
      else if (topModal.id === 'confirm-modal') closeConfirm();
      else if (topModal.id === 'edit-modal') closeEditModal();
    }
  }
  if (e.key === 'F5' || (e.ctrlKey && e.key === 'Enter')) {
    const page = document.querySelector('.page.active');
    if (page?.id === 'page-sql') {
      e.preventDefault();
      runSQL();
    }
  }
});

// Close modals when clicking the dimmed backdrop
['detail-modal', 'confirm-modal', 'edit-modal', 'source-modal', 'disclaimer-modal'].forEach(id => {
  const modalEl = document.getElementById(id);
  if (modalEl) {
    modalEl.addEventListener('click', e => {
      if (e.target === modalEl) {
        modalEl.classList.remove('open');
        if (id === 'detail-modal') closeModal();
        else if (id === 'confirm-modal') closeConfirm();
        else if (id === 'edit-modal') closeEditModal();
      }
    });
  }
});

// Close column visibility dropdown when clicking outside
document.addEventListener('click', e => {
  const dropdown = document.getElementById('isolate-col-dropdown');
  if (dropdown && dropdown.classList.contains('open')) {
    if (!dropdown.contains(e.target)) {
      dropdown.classList.remove('open');
    }
  }
});

// Drag & Drop
window.addEventListener('dragover', e => {
  e.preventDefault();
  const dropzone = document.getElementById('global-dropzone');
  if (dropzone) dropzone.classList.add('dragover');
});

window.addEventListener('dragleave', e => {
  if (e.relatedTarget === null) {
    const dropzone = document.getElementById('global-dropzone');
    if (dropzone) dropzone.classList.remove('dragover');
  }
});

window.addEventListener('drop', e => {
  const files = e.dataTransfer?.files;
  if (files && files.length > 0 && files[0].name.toLowerCase().endsWith('.sqlite')) {
    handleFileDrop(e);
  }
});

window.addEventListener('beforeunload', e => {
  if (state.isModified && state.isWasmMode) {
    e.preventDefault();
    e.returnValue = 'You have unsaved changes. Leave anyway?';
  }
});

// ── Bind to window for 100% backward compatibility with index.html inline event handlers ──
Object.assign(window, {
  state,
  showPage,
  toggleMobileSidebar,
  toggleTheme,
  switchDb,
  renderDbSelector,
  loadStats,
  setChartTypeMode,
  onPeriodFilterChange,
  resetChartZoom,
  updateDashboardCharts,
  loadSampleDatabase,
  handleFileUpload,
  handleFileDrop,
  exportSqliteDatabase,
  saveToFileHandle,
  sortIsolates,
  loadIsolates,
  debouncedLoadIsolates,
  toggleIsolateCol,
  setDupMode,
  sortDuplicates,
  loadDuplicates,
  debouncedLoadDups,
  toggleSelectAllDups,
  updateDupSelectedState,
  viewDetail,
  closeModal,
  startEdit,
  saveEdit,
  cancelEdit,
  openEditModal,
  closeEditModal,
  saveEditModal,
  confirmDeleteRow,
  confirmDeleteDupGroup,
  confirmDeleteSelectedDups,
  closeConfirm,
  executeConfirm,
  loadMonthlyAmrData,
  copyAmrTableTsv,
  exportAmrCsv,
  refreshSqlSchema,
  insertSQL,
  clearSQL,
  sortSqlTable,
  runSQL,
  bulkFix,
  fixCasingAndRefresh,
  chooseWhonetFolder,
  handleFolderSelected,
  selectFromLaunchList,
  triggerBrowseFile,
  handleLaunchFileUpload,
  loadSampleFromLaunch,
  proceedToDataSourceModal,
  toast
});

// Auto-run startup: checkNoticeModal runs after init() so mode detection is
// complete before any modal logic reads state.isWasmMode.
init().then(() => checkNoticeModal());
