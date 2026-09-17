/**
 * In-Browser SQLite WebAssembly Engine & File Access API Integration
 */
import { state, markModified, resetModified, setRuntimeBadge } from '../state/store.js';
import { toast } from '../ui/toast.js';

export async function getSqlJs() {
  if (state.sqlJsInstance) return state.sqlJsInstance;
  if (typeof window.initSqlJs !== 'function') {
    throw new Error('sql.js library not loaded in browser');
  }
  const SQL = await window.initSqlJs({
    locateFile: file => `vendor/${file}`
  });
  state.sqlJsInstance = SQL;
  return SQL;
}

function registerFunctions(db) {
  if (!db) return;
  try {
    const fn = (str) => {
      if (str === null || str === undefined) return '';
      return String(str).toLowerCase().replace(/\d+/g, (m) => m.padStart(12, '0'));
    };
    db.create_function('NATURAL_KEY', fn);
    db.create_function('natural_key', fn);
    db.create_function('Natural_key', fn);
    db._hasNaturalKey = true;
  } catch (e) {
    console.warn('Could not register NATURAL_KEY in wasmDb:', e.message);
  }
}

export function ensureWasmFunctions() {
  if (!state.wasmDb) return;

  // In sql.js, calling db.export() flushes the database by closing and re-opening
  // a brand new SQLite connection, which wipes out all registered UDFs.
  // Intercept export() so functions are immediately re-registered on the new handle.
  if (!state.wasmDb._exportIntercepted && typeof state.wasmDb.export === 'function') {
    const origExport = state.wasmDb.export.bind(state.wasmDb);
    state.wasmDb.export = function (...args) {
      const result = origExport(...args);
      state.wasmDb._hasNaturalKey = false;
      registerFunctions(state.wasmDb);
      return result;
    };
    state.wasmDb._exportIntercepted = true;
  }

  if (state.wasmDb._hasNaturalKey) return;
  registerFunctions(state.wasmDb);
}

export function wasmSelect(sql, params = []) {
  if (!state.wasmDb) throw new Error('No client-side SQLite database loaded');
  ensureWasmFunctions();
  const stmt = state.wasmDb.prepare(sql);
  if (params && params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

export function wasmRun(sql, params = []) {
  if (!state.wasmDb) throw new Error('No client-side SQLite database loaded');
  ensureWasmFunctions();
  state.wasmDb.run(sql, params);
  const changes = state.wasmDb.getRowsModified();
  if (changes > 0) {
    markModified();
    triggerAutoSave();
  }
  return { changes };
}

export function normaliseSchema() {
  if (!state.wasmDb) return;
  try {
    const cols = wasmSelect("PRAGMA table_info(Isolates)").map(r => r.name);
    if (!cols.includes('FULL_NAME')) {
      if (cols.includes('FIRST_NAME') && cols.includes('LAST_NAME')) {
        state.wasmDb.run(
          `ALTER TABLE Isolates ADD COLUMN FULL_NAME TEXT GENERATED ALWAYS AS ` +
          `(TRIM(COALESCE(FIRST_NAME,'') || ' ' || COALESCE(LAST_NAME,''))) VIRTUAL`
        );
      } else if (cols.includes('LAST_NAME')) {
        state.wasmDb.run(
          `ALTER TABLE Isolates ADD COLUMN FULL_NAME TEXT GENERATED ALWAYS AS ` +
          `(COALESCE(LAST_NAME, '')) VIRTUAL`
        );
      } else if (cols.includes('FIRST_NAME')) {
        state.wasmDb.run(
          `ALTER TABLE Isolates ADD COLUMN FULL_NAME TEXT GENERATED ALWAYS AS ` +
          `(COALESCE(FIRST_NAME, '')) VIRTUAL`
        );
      } else {
        state.wasmDb.run(`ALTER TABLE Isolates ADD COLUMN FULL_NAME TEXT DEFAULT ''`);
      }
    }
  } catch (e) {
    console.warn('normaliseSchema:', e.message);
  }
}

export async function autoSaveToHandle() {
  if (!state.wasmDb || !state.activeFileHandle || typeof state.activeFileHandle.createWritable !== 'function') return;
  try {
    const perm = await state.activeFileHandle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') return;
    const binaryArray = state.wasmDb.export();
    ensureWasmFunctions();
    const writable = await state.activeFileHandle.createWritable();
    await writable.write(binaryArray);
    await writable.close();
    resetModified();
    
    const badge = document.getElementById('runtime-badge');
    if (badge) {
      const prev = badge.innerHTML;
      badge.innerHTML = '<i class="fa-solid fa-circle-check"></i> Auto-saved';
      setTimeout(() => { badge.innerHTML = prev; }, 1500);
    }
  } catch (err) {
    console.warn('Auto-save failed, falling back to manual save:', err.message);
  }
}

function triggerAutoSave() {
  if (state.activeFileHandle && typeof state.activeFileHandle.createWritable === 'function') {
    state.activeFileHandle.queryPermission({ mode: 'readwrite' }).then(perm => {
      if (perm === 'granted') {
        const saveBtn = document.getElementById('btn-save-file');
        if (saveBtn) saveBtn.style.display = 'none';
        autoSaveToHandle();
      }
    }).catch(() => {});
  }
}

export async function saveToFileHandle() {
  if (!state.wasmDb) return;
  const saveBtn = document.getElementById('btn-save-file');
  try {
    let handle = state.activeFileHandle;
    if (!handle || typeof handle.createWritable !== 'function') {
      if ('showSaveFilePicker' in window) {
        handle = await window.showSaveFilePicker({
          suggestedName: state.currentDb || 'WHONET_DATA.sqlite',
          types: [{
            description: 'SQLite Database',
            accept: { 'application/x-sqlite3': ['.sqlite'] }
          }]
        });
        state.activeFileHandle = handle;
      } else {
        return exportSqliteDatabase();
      }
    }

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';
    }

    const binaryArray = state.wasmDb.export();
    ensureWasmFunctions();
    const writable = await handle.createWritable();
    await writable.write(binaryArray);
    await writable.close();

    resetModified();
    toast(`Successfully saved changes directly to ${handle.name || state.currentDb}`, 'success');

    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fa-solid fa-check"></i> Saved';
      setTimeout(() => {
        if (!state.isModified && saveBtn) {
          saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save to File';
        }
      }, 2500);
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      toast(`Save failed: ${err.message}`, 'error');
    }
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save to File';
    }
  }
}

export function exportSqliteDatabase() {
  if (!state.wasmDb) return;
  const binaryArray = state.wasmDb.export();
  ensureWasmFunctions();
  const blob = new Blob([binaryArray], { type: 'application/x-sqlite3' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = state.currentDb || 'WHONET_DATA.sqlite';
  a.click();
  URL.revokeObjectURL(url);
  resetModified();
  toast('Database downloaded successfully', 'success');
}
