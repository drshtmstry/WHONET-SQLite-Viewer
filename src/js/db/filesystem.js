import { state, setRuntimeBadge } from "../state/store.js";
import { toast } from "../ui/toast.js";
import { isSqliteDatabase } from "../utils/formatters.js";
import { getSqlJs, normaliseSchema, wasmSelect } from "./wasm.js";
import { API_BASE } from "../api/client.js";
import { parseLabConfig } from "../utils/antibiogram-engine.js";

async function getFolderHandleStore() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("whonet-data-tool", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("settings");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveWhonetFolderHandle(dirHandle) {
  try {
    const db = await getFolderHandleStore();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("settings", "readwrite");
      transaction.objectStore("settings").put(dirHandle, "whonet-folder");
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  } catch (err) {
    console.info("Could not remember selected folder:", err.message);
  }
}

export async function getSavedWhonetFolderHandle() {
  try {
    const db = await getFolderHandleStore();
    const handle = await new Promise((resolve, reject) => {
      const request = db
        .transaction("settings")
        .objectStore("settings")
        .get("whonet-folder");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return handle;
  } catch (err) {
    console.info("Could not restore selected folder:", err.message);
    return null;
  }
}

export async function scanWhonetFolder(dirHandle, showToast = true) {
  state.dirHandle = dirHandle;
  if (showToast)
    toast(
      "Scanning selected folder for WHONET data files and lab configs…",
      "info",
    );

  const foundFiles = [];
  let foundLabFile = null;
  let dataSubDirHandle = null;

  // 1. Inspect the selected folder root:
  // Look for any laboratory configuration file (LAB*.txt, LAB*.ini, etc.)
  // and identify if there is a dedicated "Data" subfolder.
  for await (const entry of dirHandle.values()) {
    if (entry.kind === "file") {
      if (/^LAB/i.test(entry.name) && !foundLabFile) {
        foundLabFile = entry;
      }
    } else if (
      entry.kind === "directory" &&
      entry.name.toLowerCase() === "data"
    ) {
      dataSubDirHandle = entry;
    }
  }

  // 2. WHONET main folder access is for lab configuration rules.
  // Surveillance data files reside under the "Data" subfolder.
  // If the selected folder has a "Data" subfolder, strictly scan under Data/
  // and ignore non-data SQLite files (e.g. WHONET.sqlite, translations, backups) in the root.
  // If the user picked the Data folder directly, scan dirHandle.
  const targetDataDir = dataSubDirHandle || dirHandle;

  async function scanDirectoryForDbs(handle) {
    for await (const entry of handle.values()) {
      if (entry.kind === "file") {
        if (isSqliteDatabase(entry.name)) {
          state.fileHandles[entry.name] = entry;
          if (!foundFiles.includes(entry.name)) foundFiles.push(entry.name);
        } else if (/^LAB/i.test(entry.name) && !foundLabFile) {
          foundLabFile = entry;
        }
      } else if (entry.kind === "directory") {
        // Recurse into subdirectories inside the Data folder (e.g. Data/2024/, Data/ICU/, etc.)
        try {
          await scanDirectoryForDbs(entry);
        } catch (_) {}
      }
    }
  }

  // Reset fileHandles so databases from previous folders do not linger
  state.fileHandles = {};
  await scanDirectoryForDbs(targetDataDir);

  // 3. If a laboratory configuration file was discovered in the root or data folder, auto-parse it
  if (foundLabFile) {
    try {
      const file = await foundLabFile.getFile();
      const text = await file.text();
      const config = parseLabConfig(text);
      if (config) {
        config.filename = foundLabFile.name;
        state.customLabConfig = config;
        console.info(
          `[WASM Lab Config] Loaded ${foundLabFile.name} (${config.metadata?.["Laboratory Name"] || "Custom"})`,
        );
      }
    } catch (err) {
      console.warn("Could not load WHONET lab config:", err.message);
    }
  }

  foundFiles.sort();
  if (!foundFiles.length) {
    if (showToast) {
      const folderNote = dataSubDirHandle
        ? "under Data subfolder"
        : "in selected folder";
      toast(`No data .sqlite files found ${folderNote}.`, "error");
    }
    return false;
  }

  state.databases = [...foundFiles];

  renderLaunchDbSelect();
  if (typeof window.renderDbSelector === "function") {
    window.renderDbSelector();
  }
  if (showToast) {
    const locText = dataSubDirHandle ? "Data subfolder" : "folder";
    toast(
      `Found ${foundFiles.length} WHONET database(s) in ${locText}! Select one to open.`,
      "success",
    );
  }
  return true;
}

export async function restoreWhonetFolder() {
  if (!("showDirectoryPicker" in window)) return;
  const dirHandle = await getSavedWhonetFolderHandle();
  if (!dirHandle) return;

  try {
    const permission = await dirHandle.queryPermission({ mode: "readwrite" });
    if (permission === "granted") {
      await scanWhonetFolder(dirHandle, false);
    } else {
      const readPerm = await dirHandle.queryPermission({ mode: "read" });
      if (readPerm === "granted") await scanWhonetFolder(dirHandle, false);
    }
  } catch (err) {
    console.info("Saved folder is no longer available:", err.message);
  }
}

export async function chooseWhonetFolder() {
  if ("showDirectoryPicker" in window) {
    try {
      const dirHandle = await window.showDirectoryPicker({
        id: "whonet_data_dir",
        startIn: "documents",
      });
      await saveWhonetFolderHandle(dirHandle);
      await scanWhonetFolder(dirHandle);
    } catch (err) {
      if (err.name !== "AbortError") {
        toast(`Failed to read folder: ${err.message}`, "error");
      }
    }
  } else {
    const input = document.getElementById("folder-input-fallback");
    if (input) input.click();
  }
}

export async function handleFolderSelected(files) {
  if (!files || !files.length) return;
  const foundFiles = [];
  state.fileHandles = {};
  let foundLabFile = null;

  // Determine if files contain a "data" subfolder (e.g. WHONET/Data/...)
  const hasDataFolder = Array.from(files).some((file) => {
    const rel = (file.webkitRelativePath || "").replace(/\\/g, "/");
    const parts = rel.split("/");
    return parts.slice(0, -1).some((p) => p.toLowerCase() === "data");
  });

  for (const file of files) {
    const rel = (file.webkitRelativePath || "").replace(/\\/g, "/");
    const parts = rel.split("/");
    const inDataFolder = parts
      .slice(0, -1)
      .some((p) => p.toLowerCase() === "data");

    // If a Data subfolder exists, only include .sqlite files that are under Data/
    if (hasDataFolder && !inDataFolder) {
      if (/^LAB/i.test(file.name) && !foundLabFile) {
        foundLabFile = file;
      }
      continue;
    }

    if (isSqliteDatabase(file.name)) {
      state.fileHandles[file.name] = file;
      if (!foundFiles.includes(file.name)) foundFiles.push(file.name);
    } else if (/^LAB/i.test(file.name) && !foundLabFile) {
      foundLabFile = file;
    }
  }

  if (foundLabFile) {
    try {
      const text = await foundLabFile.text();
      const config = parseLabConfig(text);
      if (config) {
        config.filename = foundLabFile.name;
        state.customLabConfig = config;
        console.info(
          `[WASM Lab Config] Loaded ${foundLabFile.name} (${config.metadata?.["Laboratory Name"] || "Custom"})`,
        );
      }
    } catch (err) {
      console.warn("Could not load WHONET lab config:", err.message);
    }
  }

  foundFiles.sort();
  if (!foundFiles.length) {
    return toast("No data .sqlite files found in the Data folder.", "error");
  }

  state.databases = [...foundFiles];
  renderLaunchDbSelect();
  if (typeof window.renderDbSelector === "function") {
    window.renderDbSelector();
  }
  toast(`Found ${foundFiles.length} WHONET database(s)!`, "success");
}

export function renderLaunchDbSelect() {
  const sel = document.getElementById("launch-db-select");
  if (!sel) return;
  const localOption = document.getElementById("launch-option-local");
  const btnPickFolder = document.getElementById("btn-pick-folder");
  const btnOpenLaunch = document.getElementById("btn-open-launch-file");

  if (state.isWasmMode) {
    if (localOption) localOption.style.opacity = "1";
    if (btnPickFolder) {
      btnPickFolder.style.display = "inline-flex";
      const folderConnected = Boolean(state.dirHandle);
      btnPickFolder.classList.toggle("btn-primary", !folderConnected);
      btnPickFolder.classList.toggle("btn-success", folderConnected);
      btnPickFolder.innerHTML = folderConnected
        ? '<i class="fa-solid fa-check"></i> Folder Connected'
        : '<i class="fa-solid fa-folder-open"></i> Select WHONET Folder (C:\\WHONET)';
      btnPickFolder.title = folderConnected
        ? "Select a different WHONET data folder"
        : "Select the WHONET data folder";
    }

    const localDbs = state.databases || [];

    if (!localDbs.length) {
      const descEl = document.getElementById("launch-local-desc");
      if (descEl) {
        descEl.innerHTML =
          '<span style="color:var(--text2)">Click below to select your <code>C:\\WHONET</code> folder once. Browser will automatically list and load all <code>.sqlite</code> files!</span>';
      }
      sel.innerHTML =
        '<option value="">(No folder selected yet — Click "Select WHONET Folder")</option>';
      if (btnOpenLaunch) btnOpenLaunch.disabled = true;
      return;
    }

    const descEl = document.getElementById("launch-local-desc");
    if (descEl) {
      descEl.innerHTML = `Folder loaded: <strong>${localDbs.length} database file(s)</strong> available. Select one to open:`;
    }
    const wasmOptions = [
      `<option value="" ${!state.currentDb ? "selected disabled" : ""}>Select file</option>`,
      ...localDbs.map(
        (db) =>
          `<option value="${db}" ${db === state.currentDb ? "selected" : ""}>${db}</option>`,
      ),
    ];
    sel.innerHTML = wasmOptions.join("");
    if (btnOpenLaunch) btnOpenLaunch.disabled = !sel.value;
    sel.onchange = () => {
      if (btnOpenLaunch) btnOpenLaunch.disabled = !sel.value;
    };
    sel.onkeydown = (e) => {
      if (e.key === "Enter" && sel.value) {
        e.preventDefault();
        selectFromLaunchList();
      }
    };
    return;
  }

  // Local Server mode
  if (btnPickFolder) btnPickFolder.style.display = "none";
  const localDbs = state.databases || [];
  if (!localDbs.length) {
    sel.innerHTML =
      '<option value="">No laboratory .sqlite files found in C:\\WHONET\\Data</option>';
    if (btnOpenLaunch) btnOpenLaunch.disabled = true;
    return;
  }
  const localOptions = [
    `<option value="" ${!state.currentDb ? "selected disabled" : ""}>Select file</option>`,
    ...localDbs.map(
      (db) =>
        `<option value="${db}" ${db === state.currentDb ? "selected" : ""}>${db}</option>`,
    ),
  ];
  sel.innerHTML = localOptions.join("");
  if (btnOpenLaunch) btnOpenLaunch.disabled = !sel.value;
  sel.onchange = () => {
    if (btnOpenLaunch) btnOpenLaunch.disabled = !sel.value;
  };
  sel.onkeydown = (e) => {
    if (e.key === "Enter" && sel.value) {
      e.preventDefault();
      selectFromLaunchList();
    }
  };
}

export function checkNoticeModal() {
  try {
    if (sessionStorage.getItem("whonet_welcome_seen")) {
      return;
    }
    sessionStorage.setItem("whonet_welcome_seen", "1");
  } catch (e) {}

  const disc = document.getElementById("disclaimer-modal");
  if (disc) disc.classList.add("open");
}

export function closeDisclaimerModal() {
  try {
    sessionStorage.setItem("whonet_welcome_seen", "1");
  } catch (e) {}
  const disc = document.getElementById("disclaimer-modal");
  if (disc) disc.classList.remove("open");
}

export function proceedToDataSourceModal() {
  closeDisclaimerModal();
}

export async function selectFromLaunchList() {
  const sel = document.getElementById("launch-db-select");
  const filename = sel ? sel.value : "";
  if (!filename) return toast("Please select a file from the list", "error");

  if (state.isWasmMode) {
    const handleOrFile = state.fileHandles[filename];
    if (handleOrFile) {
      if (typeof handleOrFile.getFile === "function") {
        const file = await handleOrFile.getFile();
        await window.handleFileUpload(file, handleOrFile);
      } else {
        await window.handleFileUpload(handleOrFile, null);
      }
      return;
    }
    return toast("Please select your .sqlite file", "info");
  }

  if (typeof window.switchDb === "function") {
    await window.switchDb(filename);
  }
}

export async function triggerBrowseFile() {
  if ("showOpenFilePicker" in window) {
    try {
      const [fileHandle] = await window.showOpenFilePicker({
        types: [
          {
            description: "WHONET SQLite Database",
            accept: { "application/x-sqlite3": [".sqlite"] },
          },
        ],
        multiple: false,
      });
      const file = await fileHandle.getFile();
      state.isWasmMode = true;
      if (typeof window.handleFileUpload === "function") {
        await window.handleFileUpload(file, fileHandle);
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        toast(`Failed to open file: ${err.message}`, "error");
      }
    }
  } else {
    const input = document.getElementById("file-upload-input");
    if (input) input.click();
  }
}

export async function handleLaunchFileUpload(file) {
  if (!file) return;
  if (typeof window.handleFileUpload === "function") {
    await window.handleFileUpload(file);
  }
}

export async function loadSampleFromLaunch(sampleFilename) {
  if (typeof window.loadSampleDatabase === "function") {
    await window.loadSampleDatabase(sampleFilename);
  }
}
