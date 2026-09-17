import { state, setRuntimeBadge } from '../state/store.js';
import { toast } from '../ui/toast.js';
import { isSqliteDatabase } from '../utils/formatters.js';
import { getSqlJs, normaliseSchema, wasmSelect } from './wasm.js';
import { API_BASE } from '../api/client.js';

async function getFolderHandleStore() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('whonet-data-tool', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('settings');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveWhonetFolderHandle(dirHandle) {
  try {
    const db = await getFolderHandleStore();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('settings', 'readwrite');
      transaction.objectStore('settings').put(dirHandle, 'whonet-folder');
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  } catch (err) {
    console.info('Could not remember selected folder:', err.message);
  }
}

export async function getSavedWhonetFolderHandle() {
  try {
    const db = await getFolderHandleStore();
    const handle = await new Promise((resolve, reject) => {
      const request = db.transaction('settings').objectStore('settings').get('whonet-folder');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return handle;
  } catch (err) {
    console.info('Could not restore selected folder:', err.message);
    return null;
  }
}

export async function scanWhonetFolder(dirHandle, showToast = true) {
  state.dirHandle = dirHandle;
  if (showToast) toast('Scanning selected folder for .sqlite files…', 'info');

  const foundFiles = [];
  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file' && isSqliteDatabase(entry.name)) {
      state.fileHandles[entry.name] = entry;
      foundFiles.push(entry.name);
    }
  }

  foundFiles.sort();
  if (!foundFiles.length) {
    if (showToast) toast('No .sqlite files found in the selected folder.', 'error');
    return false;
  }

  foundFiles.forEach(f => {
    if (!state.databases.includes(f)) state.databases.push(f);
  });

  renderLaunchDbSelect();
  if (typeof window.renderDbSelector === 'function') {
    window.renderDbSelector();
  }
  if (showToast) toast(`Found ${foundFiles.length} WHONET database(s)! Select one to open.`, 'success');
  return true;
}

export async function restoreWhonetFolder() {
  if (!('showDirectoryPicker' in window)) return;
  const dirHandle = await getSavedWhonetFolderHandle();
  if (!dirHandle) return;

  try {
    const permission = await dirHandle.queryPermission({ mode: 'readwrite' });
    if (permission === 'granted') {
      await scanWhonetFolder(dirHandle, false);
    } else {
      const readPerm = await dirHandle.queryPermission({ mode: 'read' });
      if (readPerm === 'granted') await scanWhonetFolder(dirHandle, false);
    }
  } catch (err) {
    console.info('Saved folder is no longer available:', err.message);
  }
}

export async function chooseWhonetFolder() {
  if ('showDirectoryPicker' in window) {
    try {
      const dirHandle = await window.showDirectoryPicker({
        id: 'whonet_data_dir',
        startIn: 'documents'
      });
      await saveWhonetFolderHandle(dirHandle);
      await scanWhonetFolder(dirHandle);
    } catch (err) {
      if (err.name !== 'AbortError') {
        toast(`Failed to read folder: ${err.message}`, 'error');
      }
    }
  } else {
    const input = document.getElementById('folder-input-fallback');
    if (input) input.click();
  }
}

export async function handleFolderSelected(files) {
  if (!files || !files.length) return;
  const foundFiles = [];
  for (const file of files) {
    if (isSqliteDatabase(file.name)) {
      state.fileHandles[file.name] = file;
      foundFiles.push(file.name);
      if (!state.databases.includes(file.name)) {
        state.databases.push(file.name);
      }
    }
  }
  foundFiles.sort();
  if (!foundFiles.length) {
    return toast('No .sqlite files found in the selected folder.', 'error');
  }
  renderLaunchDbSelect();
  if (typeof window.renderDbSelector === 'function') {
    window.renderDbSelector();
  }
  toast(`Found ${foundFiles.length} WHONET database(s)!`, 'success');
}

export function renderLaunchDbSelect() {
  const sel = document.getElementById('launch-db-select');
  if (!sel) return;
  const localOption = document.getElementById('launch-option-local');
  const btnPickFolder = document.getElementById('btn-pick-folder');
  const btnOpenLaunch = document.getElementById('btn-open-launch-file');

  if (state.isWasmMode) {
    if (localOption) localOption.style.opacity = '1';
    if (btnPickFolder) {
      btnPickFolder.style.display = 'inline-flex';
      const folderConnected = Boolean(state.dirHandle);
      btnPickFolder.classList.toggle('btn-primary', !folderConnected);
      btnPickFolder.classList.toggle('btn-success', folderConnected);
      btnPickFolder.innerHTML = folderConnected
        ? '<i class="fa-solid fa-check"></i> Folder Connected'
        : '<i class="fa-solid fa-folder-open"></i> Select WHONET Folder (C:\\WHONET\\Data)';
      btnPickFolder.title = folderConnected
        ? 'Select a different WHONET data folder'
        : 'Select the WHONET data folder';
    }

    const localDbs = state.databases || [];

    if (!localDbs.length) {
      const descEl = document.getElementById('launch-local-desc');
      if (descEl) {
        descEl.innerHTML = '<span style="color:var(--text2)">Click below to select your <code>C:\\WHONET\\Data</code> folder once. Browser will automatically list and load all <code>.sqlite</code> files!</span>';
      }
      sel.innerHTML = '<option value="">(No folder selected yet — Click "Select WHONET Folder")</option>';
      if (btnOpenLaunch) btnOpenLaunch.disabled = true;
      return;
    }

    const descEl = document.getElementById('launch-local-desc');
    if (descEl) {
      descEl.innerHTML = `Folder loaded: <strong>${localDbs.length} database file(s)</strong> available. Select one to open:`;
    }
    if (btnOpenLaunch) btnOpenLaunch.disabled = false;
    sel.innerHTML = localDbs.map(db =>
      `<option value="${db}" ${db === state.currentDb ? 'selected' : ''}>${db}</option>`
    ).join('');
    return;
  }

  // Local Server mode
  if (btnPickFolder) btnPickFolder.style.display = 'none';
  if (btnOpenLaunch) btnOpenLaunch.disabled = false;
  const localDbs = state.databases || [];
  if (!localDbs.length) {
    sel.innerHTML = '<option value="">No laboratory .sqlite files found in C:\\WHONET\\Data</option>';
    return;
  }
  sel.innerHTML = localDbs.map(db =>
    `<option value="${db}" ${db === state.currentDb ? 'selected' : ''}>${db}</option>`
  ).join('');
}

export function checkNoticeModal() {
  try {
    if (sessionStorage.getItem('whonet_welcome_seen')) {
      return;
    }
    sessionStorage.setItem('whonet_welcome_seen', '1');
  } catch (e) { }

  const disc = document.getElementById('disclaimer-modal');
  if (disc) disc.classList.add('open');
}

export function proceedToDataSourceModal() {
  try {
    sessionStorage.setItem('whonet_welcome_seen', '1');
  } catch (e) { }
  const disc = document.getElementById('disclaimer-modal');
  if (disc) disc.classList.remove('open');
  renderLaunchDbSelect();
  const sourceModal = document.getElementById('source-modal');
  if (sourceModal) sourceModal.classList.add('open');
}

export async function selectFromLaunchList() {
  const sel = document.getElementById('launch-db-select');
  const filename = sel ? sel.value : '';
  if (!filename) return toast('Please select a file from the list', 'error');

  if (state.isWasmMode) {
    const handleOrFile = state.fileHandles[filename];
    if (handleOrFile) {
      const modal = document.getElementById('source-modal');
      if (modal) modal.classList.remove('open');
      if (typeof handleOrFile.getFile === 'function') {
        const file = await handleOrFile.getFile();
        await window.handleFileUpload(file, handleOrFile);
      } else {
        await window.handleFileUpload(handleOrFile, null);
      }
      return;
    }
    return toast('Please select your .sqlite file using Option 2 (Browse / Upload)', 'info');
  }

  if (typeof window.switchDb === 'function') {
    await window.switchDb(filename);
  }
  const modal = document.getElementById('source-modal');
  if (modal) modal.classList.remove('open');
}

export async function triggerBrowseFile() {
  if ('showOpenFilePicker' in window) {
    try {
      const [fileHandle] = await window.showOpenFilePicker({
        types: [{
          description: 'WHONET SQLite Database',
          accept: { 'application/x-sqlite3': ['.sqlite'] }
        }],
        multiple: false
      });
      const file = await fileHandle.getFile();
      const modal = document.getElementById('source-modal');
      if (modal) modal.classList.remove('open');
      state.isWasmMode = true;
      if (typeof window.handleFileUpload === 'function') {
        await window.handleFileUpload(file, fileHandle);
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        toast(`Failed to open file: ${err.message}`, 'error');
      }
    }
  } else {
    const input = document.getElementById('launch-file-input');
    if (input) input.click();
  }
}

export async function handleLaunchFileUpload(file) {
  if (!file) return;
  const modal = document.getElementById('source-modal');
  if (modal) modal.classList.remove('open');
  if (typeof window.handleFileUpload === 'function') {
    await window.handleFileUpload(file);
  }
}

export async function loadSampleFromLaunch(sampleFilename) {
  const modal = document.getElementById('source-modal');
  if (modal) modal.classList.remove('open');
  if (typeof window.loadSampleDatabase === 'function') {
    await window.loadSampleDatabase(sampleFilename);
  }
}
