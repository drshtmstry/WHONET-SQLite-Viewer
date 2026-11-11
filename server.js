import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, basename, extname, sep } from "node:path";
import { URL } from "node:url";
import { exec } from "node:child_process";
import { watch } from "node:fs";

const __dirname = process.pkg
  ? dirname(process.execPath)
  : dirname(fileURLToPath(import.meta.url));
const WHONET_DIR = process.env.WHONET_DIR || "C:\\WHONET\\Data";
const WHONET_ROOT = process.env.WHONET_ROOT || "C:\\WHONET";

import {
  parseLabConfig,
  deduplicateFirstIsolates,
  calculateCumulativeAntibiogram,
  interpretAstValue,
  getApplicableBreakpoint
} from "./src/js/utils/antibiogram-engine.js";
import {
  CUSTOM_SQL_ROW_LIMIT,
  classifySqlStatement,
  buildIsolatesQuery,
  buildDuplicatesQuery,
  buildChartDataQuery,
  buildDeleteDuplicatesQuery,
  buildUpdateFieldQuery,
  buildUpdateRowQuery,
  buildDateProfileQueries,
  buildAntibiogramDateExclusionQuery
} from "./src/js/db/query-core.js";
import {
  analyzeDateProfile,
  suggestSurveillancePeriods
} from "./src/js/utils/date-profile.js";

// Cached WHONET Resources Tables (CLSI Breakpoints & Intrinsic Resistance)
// Attribution: Breakpoints.txt and ExpectedResistancePhenotypes.txt parsing logic
// is adapted from AMRIE (https://github.com/WHONET-Development/AMRIE)
const breakpointCache = new Map();
const intrinsicCache = new Map();

function getWhonetResourceBreakpoints(guideline = "CLSI", year = "2026") {
  const cacheKey = `${guideline}:${year}`;
  if (breakpointCache.has(cacheKey)) {
    return breakpointCache.get(cacheKey);
  }
  const bpFile = join(WHONET_ROOT, "Resources", "Breakpoints.txt");
  if (!existsSync(bpFile)) return null;

  try {
    const content = readFileSync(bpFile, "utf8");
    const lines = content.split("\n");
    const bpByTest = {};
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split("\t");
      if (parts.length < 18) continue;
      const g = parts[0]?.trim();
      const yr = parts[1]?.trim();
      if (g !== guideline || yr !== year) continue;

      // AMRIE Filter: Only Human clinical breakpoints (HOST=Human / BREAKPOINT_TYPE=Human)
      // Exclude Animal (veterinary), ECOFF (epidemiological cutoffs), and non-human hosts
      const bpType = (parts[6] || "").trim();
      const host = (parts[7] || "").trim();
      if (bpType && bpType.toLowerCase() !== "human") continue;
      if (host && host.toLowerCase() !== "human") continue;

      const orgCode = (parts[4] || "").toLowerCase().trim();
      const testCode = (parts[12] || "").trim();
      const rVal = parseFloat(parts[13]);
      const sVal = parseFloat(parts[16]);
      if (!testCode || (isNaN(rVal) && isNaN(sVal))) continue;

      const site = (parts[8] || "").trim().toLowerCase();
      if (!bpByTest[testCode]) bpByTest[testCode] = {};

      // Prefer systemic / general rows over meningitis / UTI specific rows when resolving standard breakpoints
      if (bpByTest[testCode][orgCode]) {
        const existingSite = bpByTest[testCode][orgCode].site || "";
        if ((site.includes("meningitis") || site.includes("urinary")) && (!existingSite || existingSite === "non-meningitis" || existingSite === "parenteral")) {
          continue;
        }
      }

      bpByTest[testCode][orgCode] = {
        r: isNaN(rVal) ? null : rVal,
        s: isNaN(sVal) ? null : sVal,
        year: yr,
        site: site
      };
    }
    breakpointCache.set(cacheKey, bpByTest);
    console.log(`[WHONET-Resources] Loaded ${Object.keys(bpByTest).length} test breakpoints from ${bpFile} (${guideline} ${year})`);
    return bpByTest;
  } catch (err) {
    console.warn("[WHONET-Resources] Could not load Breakpoints.txt:", err.message);
    return null;
  }
}

function getWhonetResourceIntrinsic(guideline = "CLSI") {
  if (intrinsicCache.has(guideline)) return intrinsicCache.get(guideline);
  const intFile = join(WHONET_ROOT, "Resources", "ExpectedResistancePhenotypes.txt");
  if (!existsSync(intFile)) return null;

  try {
    const content = readFileSync(intFile, "utf8");
    const lines = content.split("\n");
    const map = {};
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split("\t");
      if (parts.length < 8) continue;
      const g = parts[0]?.trim();
      if (g !== guideline) continue;
      const org = (parts[2] || "").toLowerCase().trim();
      const abx = (parts[6] || "").toUpperCase().trim();
      if (!org || !abx) continue;
      if (!map[org]) map[org] = [];
      if (!map[org].includes(abx)) map[org].push(abx);
    }
    intrinsicCache.set(guideline, map);
    console.log(`[WHONET-Resources] Loaded ${Object.keys(map).length} intrinsic resistance organism rules from ${intFile}`);
    return map;
  } catch (err) {
    console.warn("[WHONET-Resources] Could not load ExpectedResistancePhenotypes.txt:", err.message);
    return null;
  }
}

// Live-reload SSE clients
const liveReloadClients = new Set();

function broadcastReload() {
  for (const client of liveReloadClients) {
    try {
      client.write("data: reload\n\n");
    } catch (_) {
      liveReloadClients.delete(client);
    }
  }
}

// Watch src folder for changes to auto-reload browser
const srcDir = join(__dirname, "src");
if (!process.env.WHONET_NO_WATCH && existsSync(srcDir)) {
  let debounceTimer = null;
  watch(srcDir, { recursive: true }, (eventType, filename) => {
    if (
      filename &&
      (filename.endsWith(".html") ||
        filename.endsWith(".js") ||
        filename.endsWith(".css"))
    ) {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        console.log(
          `[Auto-Sync] File changed: ${filename}, refreshing browser tabs...`,
        );
        broadcastReload();
      }, 150);
    }
  });
}

// Auto-discover all .sqlite files in the WHONET folder (Data/ subfolder or root) and bundled sample folders
function getDbFiles() {
  const found = new Set();
  try {
    if (existsSync(WHONET_DIR)) {
      for (const f of readdirSync(WHONET_DIR)) {
        if (f.toLowerCase().endsWith(".sqlite")) found.add(f);
      }
    }
  } catch (e) {
    console.error(`Could not read ${WHONET_DIR}:`, e.message);
  }

  try {
    if (existsSync(WHONET_ROOT)) {
      for (const f of readdirSync(WHONET_ROOT)) {
        if (f.toLowerCase().endsWith(".sqlite") && f.toLowerCase() !== "whonet.sqlite") {
          found.add(f);
        }
      }
    }
  } catch (_) { }

  const sampleDirs = [
    join(__dirname, "public", "sample-data"),
    join(__dirname, "sample-data"),
  ];
  for (const dir of sampleDirs) {
    if (existsSync(dir)) {
      try {
        for (const f of readdirSync(dir)) {
          if (f.toLowerCase().endsWith(".sqlite")) found.add(f);
        }
      } catch (_) { }
    }
  }

  return Array.from(found).sort();
}

let DB_FILES = getDbFiles();

let currentDbFile = null;
let currentDbFullPath = null;
let dbWatcher = null;
let dbDebounceTimer = null;
let lastSelfWriteTime = 0;

function broadcastDataChange() {
  for (const client of liveReloadClients) {
    try {
      client.write("data: data-refresh\n\n");
    } catch (_) {
      liveReloadClients.delete(client);
    }
  }
}

function watchActiveDb() {
  if (dbWatcher) {
    try {
      dbWatcher.close();
    } catch (_) { }
    dbWatcher = null;
  }
  if (!currentDbFullPath || !existsSync(currentDbFullPath)) return;

  try {
    const targetFile = currentDbFullPath;
    const targetDir = dirname(targetFile);
    const targetBase = basename(targetFile).toLowerCase();

    dbWatcher = watch(targetDir, (eventType, filename) => {
      if (!filename) return;
      const lower = filename.toLowerCase();
      // Match the main sqlite file, wal, or journal
      if (
        lower === targetBase ||
        lower === targetBase + "-wal" ||
        lower === targetBase + "-journal"
      ) {
        // Skip if this change was triggered by our own API write within the last 1500ms
        if (Date.now() - lastSelfWriteTime < 1500) return;

        clearTimeout(dbDebounceTimer);
        dbDebounceTimer = setTimeout(() => {
          console.log(
            `[Auto-Sync] Database file updated externally on disk: ${filename}. Broadcasting data-refresh...`,
          );
          broadcastDataChange();
        }, 350);
      }
    });

    dbWatcher.on("error", (err) => {
      console.warn("DB watcher error:", err.message);
    });
  } catch (err) {
    console.warn("Could not start DB watcher:", err.message);
  }
}

function setTargetDb(filename, customPath = null) {
  currentDbFile = filename;
  if (customPath && existsSync(customPath)) {
    currentDbFullPath = customPath;
    watchActiveDb();
    return;
  }
  const defaultPath = join(WHONET_DIR, filename);
  if (existsSync(defaultPath)) {
    currentDbFullPath = defaultPath;
    watchActiveDb();
    return;
  }
  const rootPath = join(WHONET_ROOT, filename);
  if (existsSync(rootPath)) {
    currentDbFullPath = rootPath;
    watchActiveDb();
    return;
  }
  const sampleCandidates = [
    join(__dirname, "public", "sample-data", filename),
    join(__dirname, "sample-data", filename),
    join(__dirname, filename),
  ];
  for (const cand of sampleCandidates) {
    if (existsSync(cand)) {
      currentDbFullPath = cand;
      watchActiveDb();
      return;
    }
  }
  currentDbFullPath = defaultPath;
  watchActiveDb();
}

// Execute query with on-demand connection that closes immediately, freeing the file lock
function ensureDatabaseSchema(db) {
  try {
    let rawCols = db
      .prepare("PRAGMA table_info(Isolates)")
      .all()
      .map((c) => c.name);

    if (!rawCols.length) {
      const userTables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all()
        .map((t) => t.name);
      const match = userTables.find((t) => /isolate/i.test(t)) || (userTables.length === 1 ? userTables[0] : null);
      if (match && match.toLowerCase() !== "isolates") {
        try {
          db.exec(`CREATE VIEW IF NOT EXISTS Isolates AS SELECT * FROM "${match.replace(/"/g, '""')}"`);
          rawCols = db
            .prepare("PRAGMA table_info(Isolates)")
            .all()
            .map((c) => c.name);
        } catch (_) {}
      }
    }

    if (!rawCols.length) return;

    const cleanCol = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
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

    // 1. Ensure SPEC_NUM exists
    if (!colMap.has("SPEC_NUM")) {
      const cand = findCandidate([
        "spec_no", "specnum", "specno", "spec_id", "specid", "specimen_num",
        "specimen_no", "specimen_number", "specimen_id", "specimen",
        "accession", "accession_no", "accession_num", "accession_number",
        "acc_no", "acc_num", "sample_id", "sample_no", "sample_num",
        "sample_number", "lab_no", "lab_num", "barcode"
      ]);
      try {
        db.exec("ALTER TABLE Isolates ADD COLUMN SPEC_NUM TEXT DEFAULT ''");
        if (cand) {
          db.exec(`UPDATE Isolates SET SPEC_NUM = COALESCE(TRIM(CAST("${cand.replace(/"/g, '""')}" AS TEXT)), '') WHERE "${cand.replace(/"/g, '""')}" IS NOT NULL`);
        }
        colMap.set("SPEC_NUM", "SPEC_NUM");
      } catch (_) {}
    }

    // 2. Ensure PATIENT_ID exists
    if (!colMap.has("PATIENT_ID")) {
      const cand = findCandidate([
        "pat_id", "patientid", "patid", "patient_no", "patient_num",
        "patient_number", "patient", "mrn", "pid", "subject_id",
        "hosp_no", "reg_no", "ip_no", "op_no"
      ]);
      try {
        db.exec("ALTER TABLE Isolates ADD COLUMN PATIENT_ID TEXT DEFAULT ''");
        if (cand) {
          db.exec(`UPDATE Isolates SET PATIENT_ID = COALESCE(TRIM(CAST("${cand.replace(/"/g, '""')}" AS TEXT)), '') WHERE "${cand.replace(/"/g, '""')}" IS NOT NULL`);
        }
        colMap.set("PATIENT_ID", "PATIENT_ID");
      } catch (_) {}
    }

    // 3. Ensure ROW_IDX exists
    if (!colMap.has("ROW_IDX")) {
      const cand = findCandidate(["row_idx", "rowidx", "row_id", "rowid", "id"]);
      try {
        db.exec("ALTER TABLE Isolates ADD COLUMN ROW_IDX INTEGER DEFAULT 0");
        if (cand) {
          db.exec(`UPDATE Isolates SET ROW_IDX = COALESCE(CAST("${cand.replace(/"/g, '""')}" AS INTEGER), rowid)`);
        } else {
          try {
            db.exec("UPDATE Isolates SET ROW_IDX = rowid");
          } catch (_) {}
        }
        colMap.set("ROW_IDX", "ROW_IDX");
      } catch (_) {}
    }

    // 4. Ensure FULL_NAME exists
    if (!colMap.has("FULL_NAME")) {
      const cand = findCandidate(["full_name", "fullname", "patient_name", "patientname", "name"]);
      try {
        if (cand) {
          db.exec("ALTER TABLE Isolates ADD COLUMN FULL_NAME TEXT DEFAULT ''");
          db.exec(`UPDATE Isolates SET FULL_NAME = COALESCE(TRIM(CAST("${cand.replace(/"/g, '""')}" AS TEXT)), '') WHERE "${cand.replace(/"/g, '""')}" IS NOT NULL`);
        } else if (colMap.has("FIRST_NAME") && colMap.has("LAST_NAME")) {
          db.exec(
            `ALTER TABLE Isolates ADD COLUMN FULL_NAME TEXT GENERATED ALWAYS AS ` +
            `(TRIM(COALESCE(FIRST_NAME,'') || ' ' || COALESCE(LAST_NAME,''))) VIRTUAL`,
          );
        } else if (colMap.has("LAST_NAME")) {
          db.exec(
            `ALTER TABLE Isolates ADD COLUMN FULL_NAME TEXT GENERATED ALWAYS AS (COALESCE(LAST_NAME, '')) VIRTUAL`,
          );
        } else if (colMap.has("FIRST_NAME")) {
          db.exec(
            `ALTER TABLE Isolates ADD COLUMN FULL_NAME TEXT GENERATED ALWAYS AS (COALESCE(FIRST_NAME, '')) VIRTUAL`,
          );
        } else {
          db.exec("ALTER TABLE Isolates ADD COLUMN FULL_NAME TEXT DEFAULT ''");
        }
        colMap.set("FULL_NAME", "FULL_NAME");
      } catch (_) {}
    }

    // 5. Ensure core clinical & surveillance fields exist
    const textCols = [
      { name: "SPEC_DATE", aliases: ["spec_date", "date_spec", "specdate", "collection_date", "date"] },
      { name: "SPEC_TYPE", aliases: ["spec_type", "spectype", "specimen_type", "spec_code", "sample_type"] },
      { name: "ORGANISM", aliases: ["organism", "org", "organism_code", "org_code", "pathogen", "bacteria"] },
      { name: "WARD", aliases: ["ward", "ward_name", "unit", "location"] },
      { name: "DEPARTMENT", aliases: ["department", "dept", "service"] },
      { name: "WARD_TYPE", aliases: ["ward_type", "wardtype"] }
    ];
    for (const { name, aliases } of textCols) {
      if (!colMap.has(name)) {
        const cand = findCandidate(aliases);
        try {
          db.exec(`ALTER TABLE Isolates ADD COLUMN ${name} TEXT DEFAULT ''`);
          if (cand) {
            db.exec(`UPDATE Isolates SET ${name} = COALESCE(TRIM(CAST("${cand.replace(/"/g, '""')}" AS TEXT)), '') WHERE "${cand.replace(/"/g, '""')}" IS NOT NULL`);
          }
          colMap.set(name, name);
        } catch (_) {}
      }
    }
  } catch (_) { }
}

function withDb(callback) {
  if (!currentDbFullPath) {
    throw new Error("No database selected");
  }
  const db = new DatabaseSync(currentDbFullPath);
  try {
    db.exec("PRAGMA busy_timeout = 5000;");
    const naturalKeyFn = (str) => {
      if (str === null || str === undefined) return "";
      return String(str)
        .toLowerCase()
        .replace(/\d+/g, (m) => m.padStart(12, "0"));
    };
    db.function("NATURAL_KEY", { deterministic: true, varargs: true }, naturalKeyFn);
    db.function("natural_key", { deterministic: true, varargs: true }, naturalKeyFn);
    db.function("Natural_key", { deterministic: true, varargs: true }, naturalKeyFn);
    ensureDatabaseSchema(db);
    return callback(db);
  } finally {
    try {
      db.close();
    } catch (_) { }
  }
}

function getAllowedOrigin(req) {
  const origin = req?.headers?.origin;
  if (!origin) return null;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin) ? origin : null;
}

function getCorsHeaders(req) {
  const origin = getAllowedOrigin(req);
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
  };
}

function sendJson(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    ...(res._corsHeaders || {}),
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendHtml(res, html) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(html),
  });
  res.end(html);
}

/**
 * Reads the full request body as a binary Buffer with a size cap.
 * Rejects with statusCode 413 if the cap is exceeded.
 */
function readRawBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let size = 0;
    let aborted = false;
    req.on("data", (chunk) => {
      if (aborted) return;
      size += chunk.length;
      if (size > maxBytes) {
        aborted = true;
        const err = Object.assign(new Error("Request body too large"), { statusCode: 413 });
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => {
      if (!aborted) resolvePromise(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

/**
 * Reads a UTF-8 text/JSON request body with a size cap.
 */
async function readBody(req, maxBytes = 64 * 1024) {
  const buf = await readRawBody(req, maxBytes);
  return buf.toString("utf8");
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".sqlite": "application/x-sqlite3",
  ".sqlite3": "application/x-sqlite3",
};

function handleRequest(req, res) {
  const urlObj = new URL(req.url, `http://localhost`);
  const path = urlObj.pathname;
  const rawOrigin = req.headers.origin;
  res._corsHeaders = getCorsHeaders(req);

  if (rawOrigin && !getAllowedOrigin(req)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Cross-origin requests are restricted to localhost" }));
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      ...(res._corsHeaders || {}),
      "Access-Control-Allow-Methods": "GET,POST",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  if (path === "/api/live-reload") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      ...(res._corsHeaders || {}),
    });
    res.write("data: connected\n\n");
    liveReloadClients.add(res);
    req.on("close", () => liveReloadClients.delete(res));
    return;
  }

  // Handle static assets natively from src/ and public/ with strict path containment
  const srcRoot = resolve(__dirname, "src");
  const publicRoot = resolve(__dirname, "public");
  let reqPath;
  try {
    reqPath = decodeURIComponent(path === "/" ? "/index.html" : path);
  } catch (_) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Bad request");
    return;
  }
  const relPath = reqPath.replace(/^\/+/, "");
  const staticChecks = [
    { root: srcRoot, candidate: resolve(srcRoot, relPath) },
    { root: publicRoot, candidate: resolve(publicRoot, relPath) },
  ];
  if (reqPath.startsWith("/src/")) {
    staticChecks.unshift({
      root: srcRoot,
      candidate: resolve(srcRoot, reqPath.slice(5)),
    });
  }

  for (const { root, candidate } of staticChecks) {
    if (candidate !== root && !candidate.startsWith(root + sep)) {
      continue;
    }
    if (existsSync(candidate)) {
      try {
        if (statSync(candidate).isDirectory()) continue;
        const ext = extname(candidate).toLowerCase();
        const contentType = MIME_TYPES[ext] || "application/octet-stream";
        const isDynamicDev = ext === ".html" || ext === ".js" || ext === ".css" || ext === ".json";
        const data = readFileSync(candidate);
        res.writeHead(200, {
          "Content-Type": contentType,
          ...(res._corsHeaders || {}),
          "Cache-Control": isDynamicDev
            ? "no-cache, no-store, must-revalidate"
            : "public, max-age=86400",
          "Content-Length": Buffer.byteLength(data),
        });
        return res.end(data);
      } catch (_) { }
    }
  }

  handleApi(req, res).catch((err) => {
    const status = err?.statusCode || 500;
    if (!res.headersSent) sendJson(res, { error: err.message }, status);
  });
}

async function handleApi(req, res) {
  const urlObj = new URL(req.url, `http://localhost`);
  const path = urlObj.pathname;

  if (path === "/api/schema" && req.method === "GET") {
    if (!currentDbFullPath)
      return sendJson(res, { error: "No database open" }, 400);
    try {
      withDb((db) => {
        const tables = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
          )
          .all()
          .map((t) => t.name);
        const columns = {};
        for (const t of tables) {
          try {
            columns[t] = db
              .prepare(`PRAGMA table_info("${t.replace(/"/g, '""')}")`)
              .all()
              .map((c) => c.name);
          } catch (_) {
            columns[t] = [];
          }
        }
        sendJson(res, { tables, columns });
      });
    } catch (e) {
      sendJson(res, { error: e.message }, 500);
    }
    return;
  }

  if (path === "/api/databases" && req.method === "GET") {
    DB_FILES = getDbFiles(); // refresh from disk
    return sendJson(res, { databases: DB_FILES, current: currentDbFile });
  }

  if (path === "/api/close-database" && req.method === "POST") {
    if (dbWatcher) {
      try { dbWatcher.close(); } catch (_) {}
      dbWatcher = null;
    }
    clearTimeout(dbDebounceTimer);
    currentDbFile = null;
    currentDbFullPath = null;
    return sendJson(res, { ok: true });
  }

  if (path === "/api/open-database" && req.method === "POST") {
    const body = await readBody(req);
    const { filename, path: customPath } = JSON.parse(body);
    if (customPath) {
      return sendJson(res, { error: "Arbitrary customPath loading is disabled" }, 403);
    }
    if (!DB_FILES.includes(filename))
      return sendJson(res, { error: "Invalid database" }, 400);
    setTargetDb(filename);
    const count = withDb((db) => db.prepare("SELECT COUNT(*) as c FROM Isolates").get());
    return sendJson(res, { ok: true, filename, count: count.c });
  }

  // Upload/drop SQLite database file (50 MB cap)
  if (path === "/api/upload-database" && req.method === "POST") {
    const filename = urlObj.searchParams.get("filename") || "uploaded.sqlite";
    const safeName = basename(filename) || "uploaded.sqlite";
    const targetPath = join(WHONET_DIR, safeName);
    const buffer = await readRawBody(req, 50 * 1024 * 1024);
    try {
      lastSelfWriteTime = Date.now();
      // Save to WHONET_DIR if possible, otherwise local data directory
      try {
        writeFileSync(targetPath, buffer);
        setTargetDb(safeName, targetPath);
      } catch (_) {
        const localPath = join(__dirname, safeName);
        writeFileSync(localPath, buffer);
        setTargetDb(safeName, localPath);
      }
      DB_FILES = getDbFiles();
      if (!DB_FILES.includes(safeName)) DB_FILES.push(safeName);
      const count = withDb((db) => db.prepare("SELECT COUNT(*) as c FROM Isolates").get());
      return sendJson(res, { ok: true, filename: safeName, count: count.c, databases: DB_FILES });
    } catch (e) {
      return sendJson(res, { error: "Failed to process SQLite file: " + e.message }, 500);
    }
  }

  if (path === "/api/stats" && req.method === "GET") {
    if (!currentDbFullPath)
      return sendJson(res, { error: "No database open" }, 400);
    try {
      withDb((db) => {
        const total = db.prepare("SELECT COUNT(*) as c FROM Isolates").get().c;
        const cols = db.prepare("PRAGMA table_info(Isolates)").all().map((c) => c.name.toUpperCase());
        const hasSpecNum = cols.includes("SPEC_NUM");
        const hasPatientId = cols.includes("PATIENT_ID");

        const dupInfo = hasSpecNum
          ? db.prepare(`
              SELECT COUNT(*) as dupRows, COUNT(DISTINCT UPPER(SPEC_NUM)) as dupGroups
              FROM Isolates WHERE SPEC_NUM IS NOT NULL AND SPEC_NUM != '' AND UPPER(SPEC_NUM) IN (
                SELECT UPPER(SPEC_NUM) FROM Isolates WHERE SPEC_NUM IS NOT NULL AND SPEC_NUM != '' GROUP BY UPPER(SPEC_NUM) HAVING COUNT(*) > 1
              )
            `).get()
          : { dupRows: 0, dupGroups: 0 };

        const dupPtInfo = hasPatientId
          ? db.prepare(`
              SELECT COUNT(*) as dupPtRows, COUNT(DISTINCT UPPER(PATIENT_ID)) as dupPtGroups
              FROM Isolates WHERE PATIENT_ID IS NOT NULL AND PATIENT_ID != '' AND UPPER(PATIENT_ID) IN (
                SELECT UPPER(PATIENT_ID) FROM Isolates WHERE PATIENT_ID IS NOT NULL AND PATIENT_ID != '' GROUP BY UPPER(PATIENT_ID) HAVING COUNT(*) > 1
              )
            `).get()
          : { dupPtRows: 0, dupPtGroups: 0 };

        const organisms = cols.includes("ORGANISM")
          ? db.prepare("SELECT DISTINCT ORGANISM FROM Isolates WHERE ORGANISM != '' ORDER BY ORGANISM").all().map((r) => r.ORGANISM)
          : [];
        const wards = cols.includes("WARD")
          ? db.prepare("SELECT DISTINCT WARD FROM Isolates WHERE WARD != '' ORDER BY WARD").all().map((r) => r.WARD)
          : [];
        const wardTypes = cols.includes("WARD_TYPE")
          ? db.prepare("SELECT DISTINCT WARD_TYPE FROM Isolates WHERE WARD_TYPE IS NOT NULL AND WARD_TYPE != '' ORDER BY WARD_TYPE").all().map((r) => r.WARD_TYPE)
          : [];
        const specimens = cols.includes("SPEC_TYPE")
          ? db.prepare("SELECT DISTINCT SPEC_TYPE FROM Isolates WHERE SPEC_TYPE IS NOT NULL AND SPEC_TYPE != '' ORDER BY SPEC_TYPE").all().map((r) => r.SPEC_TYPE)
          : [];
        const dpQueries = buildDateProfileQueries(cols);
        const auditRow = db.prepare(dpQueries.auditSql).get() || {};
        const monthRows = dpQueries.monthCountsSql
          ? db.prepare(dpQueries.monthCountsSql).all()
          : [];
        const anomalySamples = dpQueries.anomalySamplesSql
          ? db.prepare(dpQueries.anomalySamplesSql).all(...dpQueries.anomalyParams)
          : [];

        const dateProfile = analyzeDateProfile({
          totalRows: auditRow.totalRows ?? total,
          missingCount: auditRow.missingCount ?? 0,
          malformedCount: auditRow.malformedCount ?? 0,
          monthRows,
          anomalySamples,
        });
        const suggestedPeriods = suggestSurveillancePeriods(dateProfile);

        const plausibleMonths = dateProfile.monthCounts.filter((m) => m.isPlausible).map((m) => m.ym);
        const months = plausibleMonths.length > 0
          ? plausibleMonths
          : dateProfile.monthCounts.map((m) => m.ym);
        const maxDate = dateProfile.maxValidDate || null;

        sendJson(res, {
          total,
          dupRows: dupInfo?.dupRows || 0,
          dupGroups: dupInfo?.dupGroups || 0,
          dupPtRows: dupPtInfo?.dupPtRows || 0,
          dupPtGroups: dupPtInfo?.dupPtGroups || 0,
          organisms,
          wards,
          wardTypes,
          specimens,
          months,
          maxDate,
          dateProfile,
          suggestedPeriods,
        });
      });
    } catch (e) {
      sendJson(res, { error: e.message }, 500);
    }
    return;
  }

  if (path === "/api/antibiogram" && req.method === "GET") {
    if (!currentDbFullPath)
      return sendJson(res, { error: "No database open" }, 400);
    try {
      const minIsolates = parseInt(urlObj.searchParams.get("minIsolates") || "30", 10);
      const orgFilter = (urlObj.searchParams.get("organism") || "").trim().toLowerCase();
      const wardFilter = (urlObj.searchParams.get("ward") || "").trim();
      const locType = (urlObj.searchParams.get("locType") || urlObj.searchParams.get("wardType") || "").trim().toLowerCase();
      const specFilter = (urlObj.searchParams.get("specType") || "").trim();
      const startDate = (urlObj.searchParams.get("startDate") || "").trim();
      const endDate = (urlObj.searchParams.get("endDate") || "").trim();
      const dedupMode = (urlObj.searchParams.get("dedupMode") || "patient_first").trim();
      const episodeDays = parseInt(urlObj.searchParams.get("episodeDays") || "30", 10);

      // Attempt to auto-locate matching Lab Configuration file (e.g. LABIND.BMCRI for IND-BMCRI-2024)
      let customLabConfig = null;
      try {
        if (existsSync(WHONET_ROOT)) {
          const labFiles = readdirSync(WHONET_ROOT).filter(f => f.toUpperCase().startsWith("LAB"));
          const currentBase = basename(currentDbFullPath).toUpperCase();
          // Match by prefix or suffix (e.g. IND-BMCRI -> LABIND.BMCRI)
          let matchedLabFile = labFiles.find(f => {
            const clean = f.replace(/^LAB/i, "").replace(/\.[^.]+$/, "").toUpperCase();
            return clean && currentBase.includes(clean);
          }) || labFiles.find(f => f.toUpperCase() === "LABWHO.TST") || labFiles[0];

          if (matchedLabFile) {
            const labPath = join(WHONET_ROOT, matchedLabFile);
            const content = readFileSync(labPath, "utf8");
            customLabConfig = parseLabConfig(content);
            if (customLabConfig) customLabConfig.filename = matchedLabFile;
          }
        }
      } catch (e) {
        console.warn("Could not load WHONET lab config:", e.message);
      }

      // Load official WHONET Resources Breakpoints (CLSI 2026) and Expected Resistance Phenotypes
      const guidelineYear = customLabConfig?.metadata?.["Guideline year"] ||
                            customLabConfig?.metadata?.["Dynamic breakpoints notification year"] ||
                            "2026";
      const resourceBreakpoints = getWhonetResourceBreakpoints("CLSI", guidelineYear);
      const resourceIntrinsicMap = getWhonetResourceIntrinsic("CLSI");

      if (customLabConfig) {
        customLabConfig.resourceBreakpoints = resourceBreakpoints;
        customLabConfig.resourceIntrinsicMap = resourceIntrinsicMap;
      } else if (resourceBreakpoints) {
        customLabConfig = {
          metadata: { "Guideline year": guidelineYear, "Laboratory Name": `CLSI ${guidelineYear} Official WHONET` },
          resourceBreakpoints,
          resourceIntrinsicMap
        };
      }

      withDb((db) => {
        const where = [];
        const params = [];

        if (orgFilter) {
          where.push("LOWER(ORGANISM) = ?");
          params.push(orgFilter);
        }
        if (locType) {
          const lt = locType.toLowerCase();
          if (lt === "icu") {
            where.push("(LOWER(COALESCE(WARD_TYPE, '')) = 'icu' OR LOWER(COALESCE(WARD, '')) LIKE '%icu%' OR LOWER(COALESCE(WARD, '')) LIKE '%intensive%' OR LOWER(COALESCE(WARD, '')) LIKE '%ccu%')");
          } else if (lt === "outpatient" || lt === "out") {
            where.push("(LOWER(COALESCE(WARD_TYPE, '')) = 'out' OR LOWER(COALESCE(WARD, '')) LIKE '%opd%' OR LOWER(COALESCE(WARD, '')) LIKE '%out%' OR LOWER(COALESCE(WARD, '')) LIKE '%clinic%')");
          } else if (lt === "inpatient" || lt === "in") {
            where.push("(LOWER(COALESCE(WARD_TYPE, '')) = 'in' OR (NOT (LOWER(COALESCE(WARD_TYPE, '')) = 'icu' OR LOWER(COALESCE(WARD, '')) LIKE '%icu%' OR LOWER(COALESCE(WARD, '')) LIKE '%intensive%' OR LOWER(COALESCE(WARD, '')) LIKE '%ccu%') AND NOT (LOWER(COALESCE(WARD_TYPE, '')) = 'out' OR LOWER(COALESCE(WARD, '')) LIKE '%opd%' OR LOWER(COALESCE(WARD, '')) LIKE '%out%' OR LOWER(COALESCE(WARD, '')) LIKE '%clinic%')))");
          } else {
            where.push("(LOWER(COALESCE(WARD_TYPE, '')) = ? OR (COALESCE(WARD_TYPE, '') = '' AND LOWER(COALESCE(WARD, '')) LIKE ?))");
            params.push(lt, `%${lt}%`);
          }
        } else if (wardFilter) {
          where.push("WARD = ?");
          params.push(wardFilter);
        }
        if (specFilter) {
          where.push("LOWER(SPEC_TYPE) = LOWER(?)");
          params.push(specFilter);
        }
        // Exclude negative culture / non-pathogen / no growth results (e.g. 'xxx', 'xpa', 'xxp')
        where.push("LOWER(COALESCE(ORGANISM, '')) NOT LIKE 'x%' AND COALESCE(ORGANISM, '') != ''");

        const nonDateWhereClause = where.length ? "WHERE " + where.join(" AND ") : "";
        const nonDateParams = [...params];

        if (startDate) {
          where.push("SUBSTR(TRIM(COALESCE(SPEC_DATE, DATE_DATA, '')), 1, 10) >= ?");
          params.push(startDate);
        }
        if (endDate) {
          where.push("SUBSTR(TRIM(COALESCE(SPEC_DATE, DATE_DATA, '')), 1, 10) <= ?");
          params.push(endDate);
        }

        const whereClause = where.length ? "WHERE " + where.join(" AND ") : "";
        const rawIsolates = db.prepare(`SELECT * FROM Isolates ${whereClause}`).all(...params);

        let excludedUndated = 0;
        let excludedOutsideRange = 0;
        if (startDate || endDate) {
          const tableCols = db.prepare("PRAGMA table_info(Isolates)").all().map((c) => c.name);
          const exclQ = buildAntibiogramDateExclusionQuery({
            cols: tableCols,
            nonDateWhereClause,
            nonDateParams,
            startDate,
            endDate,
          });
          if (exclQ) {
            const exclRow = db.prepare(exclQ.sql).get(...exclQ.params) || {};
            excludedUndated = Number(exclRow.excludedUndated) || 0;
            excludedOutsideRange = Number(exclRow.excludedOutsideRange) || 0;
          }
        }

        // Deduplication per user options (CLSI M39 First-Isolate, By Isolate, Episode, AST, etc.)
        const filteredIsolates = deduplicateFirstIsolates(rawIsolates, {
          mode: dedupMode,
          episodeDays,
          customLabConfig
        });

        // Calculate Antibiogram
        const report = calculateCumulativeAntibiogram(filteredIsolates, {
          minIsolates,
          customLabConfig,
          mode: dedupMode,
          episodeDays
        });

        report.labConfigFile = customLabConfig?.filename || (resourceBreakpoints ? `WHONET CLSI ${guidelineYear}` : null);
        report.labName = customLabConfig?.metadata?.["Laboratory Name"] || null;
        report.guideline = `CLSI ${guidelineYear}`;
        report.usesWhonetResources = !!resourceBreakpoints;
        report.totalRawIsolates = rawIsolates.length;
        report.startDate = startDate || null;
        report.endDate = endDate || null;
        report.excludedUndated = excludedUndated;
        report.excludedOutsideRange = excludedOutsideRange;

        sendJson(res, report);
      });
    } catch (e) {
      sendJson(res, { error: e.message }, 500);
    }
    return;
  }

  if (path === "/api/duplicates" && req.method === "GET") {
    if (!currentDbFullPath)
      return sendJson(res, { error: "No database open" }, 400);
    try {
      withDb((db) => {
        const dupCols = db.prepare("PRAGMA table_info(Isolates)").all().map((c) => c.name);
        const q = buildDuplicatesQuery({
          cols: dupCols,
          page: parseInt(urlObj.searchParams.get("page") || "1", 10),
          pageSize: parseInt(urlObj.searchParams.get("pageSize") || "50", 10),
          mode: urlObj.searchParams.get("mode") || "spec",
          search: urlObj.searchParams.get("search") || "",
          sortCol: urlObj.searchParams.get("sortCol") || "",
          sortDir: urlObj.searchParams.get("sortDir") || "ASC",
        });

        const rows = db.prepare(q.rowsSql).all(...q.params);
        const totalCount = db.prepare(q.countSql).get(...q.params).c;
        const hasMixedCaseSpecNum = q.mixedCaseSql
          ? (db.prepare(q.mixedCaseSql).get()?.c || 0) > 0
          : false;

        sendJson(res, {
          rows,
          totalCount,
          page: q.page,
          pageSize: q.pageSize,
          mode: q.mode,
          hasMixedCaseSpecNum,
        });
      });
    } catch (e) {
      sendJson(res, { error: e.message }, 500);
    }
    return;
  }

  if (path === "/api/isolates" && req.method === "GET") {
    if (!currentDbFullPath)
      return sendJson(res, { error: "No database open" }, 400);
    try {
      withDb((db) => {
        const cols = db.prepare("PRAGMA table_info(Isolates)").all().map((c) => c.name);
        const q = buildIsolatesQuery({
          cols,
          page: parseInt(urlObj.searchParams.get("page") || "1", 10),
          pageSize: parseInt(urlObj.searchParams.get("pageSize") || "25", 10),
          search: urlObj.searchParams.get("search") || "",
          organism: urlObj.searchParams.get("organism") || "",
          ward: urlObj.searchParams.get("ward") || "",
          month: urlObj.searchParams.get("month") || "",
          specimen: urlObj.searchParams.get("specimen") || urlObj.searchParams.get("specType") || "",
          sortCol: urlObj.searchParams.get("sortCol") || "ROW_IDX",
          sortDir: urlObj.searchParams.get("sortDir") || "DESC",
        });

        const rows = db.prepare(q.rowsSql).all(...q.params);
        const totalCount = db.prepare(q.countSql).get(...q.params).c;
        sendJson(res, {
          rows,
          totalCount,
          page: q.page,
          pageSize: q.pageSize,
          sortCol: q.sortCol,
          sortDir: q.sortDir,
        });
      });
    } catch (e) {
      sendJson(res, { error: e.message }, 500);
    }
    return;
  }

  if (path === "/api/monthly-amr" && req.method === "GET") {
    if (!currentDbFullPath)
      return sendJson(res, { error: "No database open" }, 400);
    try {
      withDb((db) => {
        const cols = db.prepare("PRAGMA table_info(Isolates)").all().map((c) => c.name);
        const colExpr = (name, fallback = "NULL") => cols.includes(name) ? name : `${fallback} AS ${name}`;
        const hasDate = cols.includes("SPEC_DATE");
        const rows = hasDate ? db
          .prepare(
            `
          SELECT ${colExpr("ROW_IDX", "rowid")},
                 ${colExpr("SPEC_NUM", "''")},
                 ${colExpr("SPEC_DATE", "''")},
                 ${colExpr("SPEC_TYPE", "''")},
                 ${colExpr("WARD_TYPE", "''")},
                 ${colExpr("WARD", "''")},
                 ${colExpr("DEPARTMENT", "''")},
                 ${colExpr("ORGANISM", "''")}
          FROM Isolates
          WHERE SPEC_DATE IS NOT NULL AND LENGTH(SPEC_DATE) >= 7
        `,
          )
          .all() : [];

        const monthMap = {};

        // Negative & commensal definitions:
        // Blood: 'xxx' (no growth), 'xpa', 'nor' (normal flora), 'scn' (CoNS/skin contaminant)
        // Others: 'xxx', 'xpa', 'xep', 'xsg', 'nor', 'ora', 'vag'
        const bloodNoGrowth = ["xxx", "xpa", "nor", "scn", ""];
        const othersNoGrowth = [
          "xxx",
          "xpa",
          "xep",
          "xsg",
          "nor",
          "ora",
          "vag",
          "",
        ];

        for (const r of rows) {
          const ym = (r.SPEC_DATE || "").substring(0, 7);
          if (!/^\d{4}-\d{2}$/.test(ym)) continue;

          if (!monthMap[ym]) {
            monthMap[ym] = {
              month: ym,
              totalRows: 0,
              srcSamples: { opd: 0, ipd: 0, icu: 0, others: 0, total: 0 },
              srcPositives: { opd: 0, ipd: 0, icu: 0, others: 0, total: 0 },
              typeSamples: {
                blood: 0,
                pus: 0,
                sputum: 0,
                urine: 0,
                others: 0,
                total: 0,
              },
              typePositives: {
                blood: 0,
                pus: 0,
                sputum: 0,
                urine: 0,
                others: 0,
                total: 0,
              },
            };
          }

          const m = monthMap[ym];
          m.totalRows++;

          const wt = (r.WARD_TYPE || "").toLowerCase();
          const st = (r.SPEC_TYPE || "").toLowerCase();
          const org = (r.ORGANISM || "").toLowerCase().trim();

          // Growth rule:
          // Blood (st === 'bl'): 'xxx', 'xpa', 'nor', 'scn' are no growth / contaminants
          // Others (st !== 'bl'): 'xxx', 'xpa', 'xep', 'xsg', 'nor', 'ora', 'vag' are no growth
          const isPos =
            st === "bl"
              ? !bloodNoGrowth.includes(org)
              : !othersNoGrowth.includes(org);

          // By Source of sample (OPD / IPD / ICU / Others)
          if (wt === "out") {
            m.srcSamples.opd++;
            if (isPos) m.srcPositives.opd++;
          } else if (wt === "in") {
            m.srcSamples.ipd++;
            if (isPos) m.srcPositives.ipd++;
          } else if (wt === "icu") {
            m.srcSamples.icu++;
            if (isPos) m.srcPositives.icu++;
          } else {
            m.srcSamples.others++;
            if (isPos) m.srcPositives.others++;
          }

          // By Type of sample (Blood / Pus / Sputum / Urine / Others)
          if (st === "bl") {
            m.typeSamples.blood++;
            if (isPos) m.typePositives.blood++;
          } else if (st === "ps") {
            m.typeSamples.pus++;
            if (isPos) m.typePositives.pus++;
          } else if (st === "sp") {
            m.typeSamples.sputum++;
            if (isPos) m.typePositives.sputum++;
          } else if (st === "ur") {
            m.typeSamples.urine++;
            if (isPos) m.typePositives.urine++;
          } else {
            m.typeSamples.others++;
            if (isPos) m.typePositives.others++;
          }
        }

        // Calculate totals and sort months in ascending order
        const sortedMonths = Object.keys(monthMap).sort((a, b) =>
          a.localeCompare(b),
        );
        const monthlyData = sortedMonths.map((ym) => {
          const m = monthMap[ym];
          m.srcSamples.total =
            m.srcSamples.opd +
            m.srcSamples.ipd +
            m.srcSamples.icu +
            m.srcSamples.others;
          m.srcPositives.total =
            m.srcPositives.opd +
            m.srcPositives.ipd +
            m.srcPositives.icu +
            m.srcPositives.others;
          m.typeSamples.total =
            m.typeSamples.blood +
            m.typeSamples.pus +
            m.typeSamples.sputum +
            m.typeSamples.urine +
            m.typeSamples.others;
          m.typePositives.total =
            m.typePositives.blood +
            m.typePositives.pus +
            m.typePositives.sputum +
            m.typePositives.urine +
            m.typePositives.others;
          return m;
        });

        sendJson(res, {
          months: sortedMonths,
          monthlyData,
        });
      });
    } catch (e) {
      sendJson(res, { error: e.message }, 500);
    }
    return;
  }

  // API: Dynamic chart aggregated analytics
  if (path === "/api/chart-data" && req.method === "GET") {
    if (!currentDbFullPath)
      return sendJson(res, { error: "No database open" }, 400);
    try {
      const param = urlObj.searchParams.get("param") || "ORGANISM";
      const period = urlObj.searchParams.get("period") || "all";
      const startDate = urlObj.searchParams.get("startDate") || "";
      const endDate = urlObj.searchParams.get("endDate") || "";

      withDb((db) => {
        const cols = db.prepare("PRAGMA table_info(Isolates)").all().map((c) => c.name);
        const maxDateRow =
          !startDate && !endDate && period !== "all"
            ? db
                .prepare(
                  "SELECT MAX(SPEC_DATE) as m FROM Isolates WHERE SPEC_DATE IS NOT NULL AND SPEC_DATE != ''",
                )
                .get()
            : null;

        const q = buildChartDataQuery({
          param,
          period,
          startDate,
          endDate,
          maxDate: maxDateRow?.m || null,
          cols,
        });
        if (q.error) {
          return sendJson(res, { error: q.error }, 400);
        }
        if (q.empty) {
          return sendJson(res, { param: q.param, period: q.period, totalFiltered: 0, rows: [] });
        }

        const rows = db.prepare(q.querySql).all(...q.params);
        const totalFiltered = db.prepare(q.totalSql).get(...q.params).c;

        sendJson(res, {
          param: q.param,
          period: q.period,
          totalFiltered,
          rows,
        });
      });
    } catch (e) {
      sendJson(res, { error: e.message }, 500);
    }
    return;
  }

  if (path.startsWith("/api/isolate/") && req.method === "GET") {
    if (!currentDbFullPath)
      return sendJson(res, { error: "No database open" }, 400);
    try {
      const rowIdx = parseInt(path.split("/").pop());
      withDb((db) => {
        const row = db
          .prepare("SELECT * FROM Isolates WHERE ROW_IDX = ?")
          .get(rowIdx);
        if (!row) return sendJson(res, { error: "Not found" }, 404);
        sendJson(res, { row });
      });
    } catch (e) {
      sendJson(res, { error: e.message }, 500);
    }
    return;
  }

  if (path === "/api/bulk-fix" && req.method === "POST") {
    if (!currentDbFullPath)
      return sendJson(res, { error: "No database open" }, 400);
    const body = await readBody(req);
    const { operation } = JSON.parse(body);
    let sql = "";
    let description = "";

    if (operation === "upper_spec_num") {
      let hasSpec = false;
      withDb((db) => {
        const cols = db.prepare("PRAGMA table_info(Isolates)").all().map((c) => c.name.toUpperCase());
        hasSpec = cols.includes("SPEC_NUM");
      });
      if (!hasSpec) {
        return sendJson(res, { ok: true, description: "SPEC_NUM column not present", changes: 0 });
      }
      sql = "UPDATE Isolates SET SPEC_NUM = UPPER(SPEC_NUM) WHERE SPEC_NUM != UPPER(SPEC_NUM)";
      description = "SPEC_NUM → UPPERCASE";
    } else if (operation === "trim_all") {
      // Build the SET clause dynamically: include FULL_NAME only when it is
      // a plain stored column, not a GENERATED ALWAYS (virtual/stored) column.
      // PRAGMA table_xinfo exposes hidden=2 (virtual) or hidden=3 (stored generated).
      withDb((db) => {
        let trimFields = ["SPEC_NUM", "PATIENT_ID", "WARD", "DEPARTMENT"];
        const existingCols = db.prepare("PRAGMA table_info(Isolates)").all().map((c) => c.name);
        trimFields = trimFields.filter((f) => existingCols.includes(f));
        try {
          const xinfo = db.prepare("PRAGMA table_xinfo(Isolates)").all();
          const fullNameCol = xinfo.find((c) => c.name === "FULL_NAME");
          // hidden 0/1 = normal column; 2 = virtual generated; 3 = stored generated
          if (fullNameCol && (fullNameCol.hidden === 0 || fullNameCol.hidden === 1)) {
            trimFields.push("FULL_NAME");
          }
        } catch (_) {
          // Older SQLite without table_xinfo: skip FULL_NAME to be safe
        }
        if (!trimFields.length) {
          return sendJson(res, { ok: true, description: "No text fields to trim", changes: 0 });
        }
        lastSelfWriteTime = Date.now();
        const setClause = trimFields.map((f) => `${f} = TRIM(${f})`).join(", ");
        const result = db.prepare(`UPDATE Isolates SET ${setClause}`).run();
        sendJson(res, { ok: true, description: "Trim whitespace from text fields", changes: result.changes });
      });
      return;
    } else if (operation === "upper_patient_id") {
      let hasPt = false;
      withDb((db) => {
        const cols = db.prepare("PRAGMA table_info(Isolates)").all().map((c) => c.name.toUpperCase());
        hasPt = cols.includes("PATIENT_ID");
      });
      if (!hasPt) {
        return sendJson(res, { ok: true, description: "PATIENT_ID column not present", changes: 0 });
      }
      sql = "UPDATE Isolates SET PATIENT_ID = UPPER(PATIENT_ID) WHERE PATIENT_ID != UPPER(PATIENT_ID)";
      description = "PATIENT_ID → UPPERCASE";
    } else if (operation === "lower_organism") {
      let hasOrg = false;
      withDb((db) => {
        const cols = db.prepare("PRAGMA table_info(Isolates)").all().map((c) => c.name.toUpperCase());
        hasOrg = cols.includes("ORGANISM");
      });
      if (!hasOrg) {
        return sendJson(res, { ok: true, description: "ORGANISM column not present", changes: 0 });
      }
      sql = "UPDATE Isolates SET ORGANISM = LOWER(ORGANISM) WHERE ORGANISM != LOWER(ORGANISM)";
      description = "ORGANISM → lowercase";
    } else {
      return sendJson(res, { error: "Unknown operation" }, 400);
    }
    lastSelfWriteTime = Date.now();
    withDb((db) => {
      const result = db.prepare(sql).run();
      sendJson(res, { ok: true, description, changes: result.changes });
    });
    return;
  }

  if (path === "/api/custom-sql" && req.method === "POST") {
    if (!currentDbFullPath)
      return sendJson(res, { error: "No database open" }, 400);
    const body = await readBody(req);
    const { sql } = JSON.parse(body);
    if (!sql || sql.trim().length === 0)
      return sendJson(res, { error: "Empty SQL" }, 400);
    const info = classifySqlStatement(sql);
    if (!info.stripped)
      return sendJson(res, { error: "Empty SQL" }, 400);
    if (info.hasMultipleStatements)
      return sendJson(res, { error: "Only a single SQL statement is allowed per execution" }, 400);

    withDb((db) => {
      const stmt = db.prepare(sql);
      if (info.isReadOnly) {
        const rows = stmt.all();
        const truncated = rows.length > CUSTOM_SQL_ROW_LIMIT;
        const limited = truncated ? rows.slice(0, CUSTOM_SQL_ROW_LIMIT) : rows;
        const columns = limited.length > 0 ? Object.keys(limited[0]) : [];
        sendJson(res, {
          type: "select",
          rows: limited,
          columns,
          count: limited.length,
          truncated,
        });
      } else {
        lastSelfWriteTime = Date.now();
        const result = stmt.run();
        sendJson(res, { type: "update", changes: result.changes });
      }
    });
    return;
  }

  if (path === "/api/delete-duplicates" && req.method === "POST") {
    if (!currentDbFullPath)
      return sendJson(res, { error: "No database open" }, 400);
    const body = await readBody(req);
    const { spec_num, patient_id, mode } = JSON.parse(body);

    withDb((db) => {
      const cols = db.prepare("PRAGMA table_info(Isolates)").all().map((c) => c.name);
      const q = buildDeleteDuplicatesQuery({ cols, spec_num, patient_id, mode });
      if (q.noop) return sendJson(res, { ok: true, changes: 0 });
      lastSelfWriteTime = Date.now();
      const result = db.prepare(q.sql).run(...q.params);
      sendJson(res, { ok: true, changes: result.changes });
    });
    return;
  }

  // API: delete single row
  if (path === "/api/delete-row" && req.method === "POST") {
    if (!currentDbFullPath)
      return sendJson(res, { error: "No database open" }, 400);
    const body = await readBody(req);
    const { row_idx } = JSON.parse(body);
    const numIdx = parseInt(row_idx, 10);
    if (isNaN(numIdx))
      return sendJson(res, { error: "Invalid row_idx" }, 400);
    lastSelfWriteTime = Date.now();
    withDb((db) => {
      const result = db.prepare("DELETE FROM Isolates WHERE ROW_IDX = ?").run(numIdx);
      sendJson(res, { ok: true, changes: result.changes });
    });
    return;
  }

  // API: delete multiple rows (batch)
  if (path === "/api/delete-rows" && req.method === "POST") {
    if (!currentDbFullPath)
      return sendJson(res, { error: "No database open" }, 400);
    const body = await readBody(req);
    const { row_indices } = JSON.parse(body);
    if (!Array.isArray(row_indices) || !row_indices.length)
      return sendJson(res, { ok: true, changes: 0 });
    const numIndices = row_indices.map(n => parseInt(n, 10)).filter(n => !isNaN(n));
    if (!numIndices.length)
      return sendJson(res, { ok: true, changes: 0 });
    lastSelfWriteTime = Date.now();
    withDb((db) => {
      const placeholders = numIndices.map(() => "?").join(",");
      const result = db.prepare(`DELETE FROM Isolates WHERE ROW_IDX IN (${placeholders})`).run(...numIndices);
      sendJson(res, { ok: true, changes: result.changes });
    });
    return;
  }

  if (path === "/api/update-field" && req.method === "POST") {
    if (!currentDbFullPath)
      return sendJson(res, { error: "No database open" }, 400);
    const body = await readBody(req);
    const { row_idx, field, value } = JSON.parse(body);
    withDb((db) => {
      const tableCols = db.prepare("PRAGMA table_info(Isolates)").all().map((c) => c.name);
      const q = buildUpdateFieldQuery({ tableCols, rowIdx: row_idx, field, value });
      if (q.error) return sendJson(res, { error: q.error }, 400);
      lastSelfWriteTime = Date.now();
      const result = db.prepare(q.sql).run(...q.params);
      sendJson(res, { ok: true, changes: result.changes });
    });
    return;
  }

  // API: batch update multiple fields for an isolate row
  if (path === "/api/update-row" && req.method === "POST") {
    if (!currentDbFullPath)
      return sendJson(res, { error: "No database open" }, 400);
    const body = await readBody(req);
    const { row_idx, fields } = JSON.parse(body);
    withDb((db) => {
      const tableCols = db.prepare("PRAGMA table_info(Isolates)").all().map((c) => c.name);
      const q = buildUpdateRowQuery({ tableCols, rowIdx: row_idx, fields });
      if (q.error) return sendJson(res, { error: q.error }, 400);
      if (q.noop) return sendJson(res, { ok: true, changes: 0 });
      lastSelfWriteTime = Date.now();
      const result = db.prepare(q.sql).run(...q.params);
      sendJson(res, { ok: true, changes: result.changes });
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
}

function openBrowser(url) {
  if (process.env.WHONET_NO_BROWSER === "1") return;
  try {
    if (process.platform === "win32") {
      exec(`cmd.exe /c start "" "${url}"`, (err) => {
        if (err) {
          exec(`powershell.exe -Command "Start-Process '${url}'"`, () => { });
        }
      });
    } else if (process.platform === "darwin") {
      exec(`open "${url}"`, () => { });
    } else {
      exec(`xdg-open "${url}"`, () => { });
    }
  } catch (e) {
    console.error("Auto-open failed:", e.message);
  }
}

const isMainModule =
  Boolean(process.argv[1]) &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 7890;
const server = createServer(handleRequest);

export { handleRequest, server };

if (isMainModule) {
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.log(
        `\n\u{1F9EC} WHONET SQLite Viewer is already running on port ${PORT}!`,
      );
      console.log(`   Opening: http://localhost:${PORT}\n`);
      openBrowser(`http://localhost:${PORT}`);
      process.exit(0);
    } else {
      console.error("Server error:", err);
      process.exit(1);
    }
  });

  server.listen(PORT, "127.0.0.1", () => {
    const boundPort = server.address()?.port || PORT;
    console.log("\n\u{1F9EC} WHONET SQLite Viewer");
    console.log(`   Open: http://localhost:${boundPort}`);
    console.log("   Press Ctrl+C to stop\n");
    console.log(`   Discovered ${DB_FILES.length} SQLite database(s) in WHONET folder`);
    openBrowser(`http://localhost:${boundPort}`);
  });
}
