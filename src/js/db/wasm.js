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
  // Guard: only run once per loaded database to avoid a PRAGMA query on every API call
  if (state._schemaNormalised) return;
  try {
    let rawCols = wasmSelect("PRAGMA table_info(Isolates)").map(r => r.name);
    if (!rawCols.length) {
      // If table is not named Isolates, check if there is an isolates/data table to alias
      const userTables = wasmSelect("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").map(t => t.name);
      const match = userTables.find(t => /isolate/i.test(t)) || (userTables.length === 1 ? userTables[0] : null);
      if (match && match.toLowerCase() !== 'isolates') {
        try {
          state.wasmDb.run(`CREATE VIEW IF NOT EXISTS Isolates AS SELECT * FROM "${match.replace(/"/g, '""')}"`);
          rawCols = wasmSelect("PRAGMA table_info(Isolates)").map(r => r.name);
        } catch (_) {}
      }
    }

    if (!rawCols.length) {
      state._schemaNormalised = true;
      return;
    }

    const cleanCol = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const colMap = new Map();
    for (const col of rawCols) {
      colMap.set(col.toUpperCase(), col);
      colMap.set(cleanCol(col), col);
    }

    const findCandidate = (aliases) => {
      for (const alias of aliases) {
        const found = colMap.get(alias.toUpperCase()) || colMap.get(cleanCol(alias));
        if (found) return found;
      }
      return null;
    };

    // 1. Ensure SPEC_NUM exists (resolves 'no such column: SPEC_NUM')
    if (!colMap.has('SPEC_NUM')) {
      const cand = findCandidate([
        'spec_no', 'specnum', 'specno', 'spec_id', 'specid', 'specimen_num',
        'specimen_no', 'specimen_number', 'specimen_id', 'specimen',
        'accession', 'accession_no', 'accession_num', 'accession_number',
        'acc_no', 'acc_num', 'sample_id', 'sample_no', 'sample_num',
        'sample_number', 'lab_no', 'lab_num', 'barcode'
      ]);
      try {
        state.wasmDb.run(`ALTER TABLE Isolates ADD COLUMN SPEC_NUM TEXT DEFAULT ''`);
        if (cand) {
          state.wasmDb.run(`UPDATE Isolates SET SPEC_NUM = COALESCE(TRIM(CAST("${cand.replace(/"/g, '""')}" AS TEXT)), '') WHERE "${cand.replace(/"/g, '""')}" IS NOT NULL`);
        }
        colMap.set('SPEC_NUM', 'SPEC_NUM');
      } catch (err) {
        console.warn('Failed to ensure SPEC_NUM column:', err.message);
      }
    }

    // 2. Ensure PATIENT_ID exists
    if (!colMap.has('PATIENT_ID')) {
      const cand = findCandidate([
        'pat_id', 'patientid', 'patid', 'patient_no', 'patient_num',
        'patient_number', 'patient', 'mrn', 'pid', 'subject_id',
        'hosp_no', 'reg_no', 'ip_no', 'op_no'
      ]);
      try {
        state.wasmDb.run(`ALTER TABLE Isolates ADD COLUMN PATIENT_ID TEXT DEFAULT ''`);
        if (cand) {
          state.wasmDb.run(`UPDATE Isolates SET PATIENT_ID = COALESCE(TRIM(CAST("${cand.replace(/"/g, '""')}" AS TEXT)), '') WHERE "${cand.replace(/"/g, '""')}" IS NOT NULL`);
        }
        colMap.set('PATIENT_ID', 'PATIENT_ID');
      } catch (err) {
        console.warn('Failed to ensure PATIENT_ID column:', err.message);
      }
    }

    // 3. Ensure ROW_IDX exists
    if (!colMap.has('ROW_IDX')) {
      const cand = findCandidate(['row_idx', 'rowidx', 'row_id', 'rowid', 'id']);
      try {
        state.wasmDb.run(`ALTER TABLE Isolates ADD COLUMN ROW_IDX INTEGER DEFAULT 0`);
        if (cand) {
          state.wasmDb.run(`UPDATE Isolates SET ROW_IDX = COALESCE(CAST("${cand.replace(/"/g, '""')}" AS INTEGER), rowid)`);
        } else {
          try {
            state.wasmDb.run(`UPDATE Isolates SET ROW_IDX = rowid`);
          } catch (_) {}
        }
        colMap.set('ROW_IDX', 'ROW_IDX');
      } catch (err) {
        console.warn('Failed to ensure ROW_IDX column:', err.message);
      }
    }

    // 4. Ensure FULL_NAME exists
    if (!colMap.has('FULL_NAME')) {
      const cand = findCandidate(['full_name', 'fullname', 'patient_name', 'patientname', 'name']);
      try {
        if (cand) {
          state.wasmDb.run(`ALTER TABLE Isolates ADD COLUMN FULL_NAME TEXT DEFAULT ''`);
          state.wasmDb.run(`UPDATE Isolates SET FULL_NAME = COALESCE(TRIM(CAST("${cand.replace(/"/g, '""')}" AS TEXT)), '') WHERE "${cand.replace(/"/g, '""')}" IS NOT NULL`);
        } else if (colMap.has('FIRST_NAME') && colMap.has('LAST_NAME')) {
          state.wasmDb.run(
            `ALTER TABLE Isolates ADD COLUMN FULL_NAME TEXT GENERATED ALWAYS AS ` +
            `(TRIM(COALESCE(FIRST_NAME,'') || ' ' || COALESCE(LAST_NAME,''))) VIRTUAL`
          );
        } else if (colMap.has('LAST_NAME')) {
          state.wasmDb.run(
            `ALTER TABLE Isolates ADD COLUMN FULL_NAME TEXT GENERATED ALWAYS AS (COALESCE(LAST_NAME, '')) VIRTUAL`
          );
        } else if (colMap.has('FIRST_NAME')) {
          state.wasmDb.run(
            `ALTER TABLE Isolates ADD COLUMN FULL_NAME TEXT GENERATED ALWAYS AS (COALESCE(FIRST_NAME, '')) VIRTUAL`
          );
        } else {
          state.wasmDb.run(`ALTER TABLE Isolates ADD COLUMN FULL_NAME TEXT DEFAULT ''`);
        }
        colMap.set('FULL_NAME', 'FULL_NAME');
      } catch (err) {
        console.warn('Failed to ensure FULL_NAME column:', err.message);
      }
    }

    // 5. Ensure core clinical & surveillance fields exist
    const textCols = [
      { name: 'SPEC_DATE', aliases: ['spec_date', 'date_spec', 'specdate', 'collection_date', 'date'] },
      { name: 'SPEC_TYPE', aliases: ['spec_type', 'spectype', 'specimen_type', 'spec_code', 'sample_type'] },
      { name: 'ORGANISM', aliases: ['organism', 'org', 'organism_code', 'org_code', 'pathogen', 'bacteria'] },
      { name: 'WARD', aliases: ['ward', 'ward_name', 'unit', 'location'] },
      { name: 'DEPARTMENT', aliases: ['department', 'dept', 'service'] },
      { name: 'WARD_TYPE', aliases: ['ward_type', 'wardtype'] }
    ];
    for (const { name, aliases } of textCols) {
      if (!colMap.has(name)) {
        const cand = findCandidate(aliases);
        try {
          state.wasmDb.run(`ALTER TABLE Isolates ADD COLUMN ${name} TEXT DEFAULT ''`);
          if (cand) {
            state.wasmDb.run(`UPDATE Isolates SET ${name} = COALESCE(TRIM(CAST("${cand.replace(/"/g, '""')}" AS TEXT)), '') WHERE "${cand.replace(/"/g, '""')}" IS NOT NULL`);
          }
          colMap.set(name, name);
        } catch (_) {}
      }
    }

    state._schemaNormalised = true;
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
