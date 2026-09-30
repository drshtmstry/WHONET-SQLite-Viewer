# WHONET SQLite Viewer - Modular Architecture & Schema Reference

Comprehensive architectural guide and modular schema reference for developers maintaining or extending WHONET SQLite Viewer.

---

## 1. System Architecture Overview

WHONET SQLite Viewer utilizes a **hybrid execution model** designed to function in two operational modes with zero code duplication:

1. **Local SQLite Server (Node.js)**: Runs locally with `npm start` (`node --watch server.js`) on `http://localhost:7890`. Direct file I/O to `C:\WHONET\Data` via Node's native `DatabaseSync` (`node:sqlite`). Zero security dialogs or browser sandbox restrictions.
2. **In-Browser Engine (Client-side)**: Runs statically on [whonet-sqlite-viewer.vercel.app](https://whonet-sqlite-viewer.vercel.app/) using `sql.js` in the browser. Supports installation as a desktop/mobile PWA with a zero-cache service worker (`public/sw.js`) for instant deployment rollouts. Uses the **File System Access API** with IndexedDB persistent handles to read and save changes directly to local `.sqlite` files on disk without cloud transmission.

```
                  ┌────────────────────────────────────────────────────────┐
                  │                 Browser Client / PWA                   │
                  │   (Vanilla JS ES Modules + Native CSS Tokens)          │
                  └───────────┬────────────────────────────────┬───────────┘
                              │                                │
                 [state.isWasmMode === false]     [state.isWasmMode === true]
                              ▼                                ▼
                  ┌──────────────────────┐         ┌───────────────────────┐
                  │ Local SQLite Server  │         │   In-Browser Engine   │
                  │ (Node.js Backend)    │         │     (Client-side)     │
                  │                      │         │                       │
                  │  - DatabaseSync      │         │  - wasm-emulator.js   │
                  │  - NATURAL_KEY UDF   │         │  - NATURAL_KEY UDF    │
                  │  - Live-Reload SSE   │         │  - File System Access │
                  └───────────┬──────────┘         │  - Zero-Cache SW PWA  │
                              │                    └───────────┬───────────┘
                              ▼                                │
                  ┌──────────────────────┐                     ▼
                  │ Disk (C:\WHONET\Data)│         ┌───────────────────────┐
                  └──────────────────────┘         │ Disk (Direct Handle)  │
                                                   └───────────────────────┘
```

---

## 2. Directory Schema & File Layout

The codebase separates static public assets, frontend modules, and backend execution:

```
├── public/                     # Static root & PWA assets (copied to /dist on build)
│   ├── manifest.json           # Web App Manifest for PWA installation
│   ├── sw.js                   # Zero-cache Service Worker (instant update delivery)
│   ├── favicon.ico / .png      # WHONET official icons
│   ├── apple-touch-icon.png    # iOS / Safari mobile icon
│   └── vendor/                 # sql.js WASM binaries (sql-wasm.js, sql-wasm.wasm)
│
├── src/                        # Application source code
│   ├── index.html              # HTML5 UI shell, navigation & modals
│   ├── styles.css              # Clinical design system, dark/light themes, mobile layouts
│   ├── organisms.js            # WHONET organism dictionary mapping
│   ├── sample-data/            # Bundled WHO sample SQLite databases
│   └── js/                     # Native ES Module architecture
│       ├── main.js             # Application entry point & backward-compat window bridge
│       │
│       ├── state/
│       │   └── store.js        # Reactive state, observers & runtime badges
│       │
│       ├── api/
│       │   ├── client.js       # Unified hybrid API dispatcher (`api()`)
│       │   └── wasm-emulator.js# Client-side route emulator for offline WASM execution
│       │
│       ├── db/
│       │   ├── wasm.js         # sql.js loader, schema normalization & export
│       │   └── filesystem.js   # File System Access API, IndexedDB folder persistence
│       │
│       ├── ui/
│       │   ├── table.js        # renderSortHeader(), renderPagination()
│       │   ├── toast.js        # Toast alerts with semantic icons
│       │   └── modal.js        # Detail view, edit form, and confirm dialogs
│       │
│       ├── utils/
│       │   ├── natural-sort.js # naturalKey() & naturalCompare() algorithms
│       │   ├── formatters.js   # Date formatters (locale), formatAgeSex(), HTML sanitization, debouncing
│       │   └── organisms.js    # Organism badge rendering & full name lookup
│       │
│       └── pages/
│           ├── dashboard.js    # KPI cards & Chart.js dynamic visual analytics
│           ├── isolates.js     # Isolates table, multi-parameter search & sort
│           ├── duplicates.js   # Cluster grouping, duplicate modes & batch delete
│           ├── monthly-amr.js  # Surveillance reporting matrix & CSV/TSV exports
│           ├── sql-workspace.js# SQL query console & contextual autocomplete
│           └── fixes.js        # Bulk data cleansing operations
│
├── server.js                   # Local Node.js server (native node:sqlite & auto-sync)
├── start.bat                   # Windows 1-click launcher for lab machines
├── vite.config.js              # Vite configuration for production builds (/dist)
├── vercel.json                 # Vercel deployment routing & static build config
└── package.json                # Project dependencies & operational scripts
```

---

## 3. Module Responsibilities & Contracts

| Module                   | Core Exports                                                    | Primary Responsibility                                                                                          |
| ------------------------ | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `state/store.js`         | `state`, `subscribe`, `markModified`, `setRuntimeBadge`         | Single source of truth for active database, pagination, filters, and modified flags.                            |
| `api/client.js`          | `api(path, options)`, `API_BASE`                                | Dispatches requests to `wasm-emulator.js` if in browser WASM mode, or `fetch()` if connected to Node server.    |
| `api/wasm-emulator.js`   | `handleWasmApi(path, options)`                                  | Emulates backend endpoints (`/api/stats`, `/api/isolates`, `/api/duplicates`, etc.) inside browser WASM memory. |
| `db/wasm.js`             | `getSqlJs`, `wasmSelect`, `wasmRun`, `saveToFileHandle`         | Direct execution interface to the WebAssembly SQLite instance; registers custom SQLite functions.               |
| `db/filesystem.js`       | `chooseWhonetFolder`, `restoreWhonetFolder`, `scanWhonetFolder` | Handles directory picker permissions and preserves access handles across browser sessions via IndexedDB.        |
| `ui/table.js`            | `renderSortHeader`, `renderPagination`                          | Generates accessible, sortable `<th>` headers with dynamic arrow icons and unified pagination controls.         |
| `ui/modal.js`            | `viewDetail`, `openEditModal`, `confirmDeleteRow`               | Modal dialog controllers, inline cell editor, and deletion confirmation guards.                                 |
| `utils/natural-sort.js`  | `naturalKey`, `naturalCompare`                                  | Natural alphanumeric ordering engine that pads numeric segments to 12 digits.                                   |
| `utils/formatters.js`    | `fmtDate`, `formatAgeSex`, `escapeHtml`, `debounce`             | Formats dates per user locale, formats merged `Age/Sex` (`19/f`), sanitizes HTML, and debounces calls.          |
| `pages/dashboard.js`     | `loadStats`, `updateDashboardCharts`, `switchDb`                | Renders executive summary counters and responsive Chart.js visual distribution graphs.                          |
| `pages/isolates.js`      | `loadIsolates`, `sortIsolates`, `renderIsolatesTable`           | All Isolates table controller with natural column sorting and live search filters.                              |
| `pages/duplicates.js`    | `loadDuplicates`, `sortDuplicates`, `setDupMode`                | Deduplication interface supporting Specimen # vs Patient ID clustering and multi-row selection.                 |
| `pages/monthly-amr.js`   | `loadMonthlyAmrData`, `renderAmrTable`, `exportAmrCsv`          | Gujarat SAPCAR-G AMR Surveillance data (OPD/IPD/ICU vs Specimen Types) with TSV/CSV export.                     |
| `pages/sql-workspace.js` | `runSQL`, `sortSqlTable`, `initSqlAutocomplete`                 | Arbitrary SQL query execution engine with intelligent caret-based keyword/column autocomplete.                  |
| `pages/fixes.js`         | `bulkFix`, `fixCasingAndRefresh`                                | Sanitizes data (e.g. UPPERCASE specimen normalization, whitespace cleanup).                                     |

---

## 4. WHONET Database Schema Reference

The tool interacts primarily with the `Isolates` table inside WHONET SQLite databases:

```sql
CREATE TABLE Isolates (
  ROW_IDX       INTEGER PRIMARY KEY,
  SPEC_NUM      TEXT,          -- Specimen number (e.g. CSR-1, 2026/01/10)
  PATIENT_ID    TEXT,          -- Patient identifier / Hospital MRN
  FULL_NAME     TEXT,          -- Patient Name (or computed virtual column)
  SPEC_DATE     TEXT,          -- Collection date (YYYY-MM-DD)
  SPEC_TYPE     TEXT,          -- Sample type (bl=blood, ur=urine, ps=pus, sp=sputum, cs=csf, st=stool)
  ORGANISM      TEXT,          -- WHONET organism code (e.g. eco, sau, kpn, pae)
  SEX           TEXT,          -- m=male, f=female, u=unknown
  AGE           TEXT,          -- Numerical age or age format
  AGE_GROUP     TEXT,          -- Age cohort category
  WARD          TEXT,          -- Ward name / clinic identifier
  WARD_TYPE     TEXT,          -- in=inpatient, out=outpatient, icu=intensive care
  DEPARTMENT    TEXT,          -- Hospital department
  INSTITUT      TEXT,          -- Hospital or health facility code
  DATE_ADMIS    TEXT,          -- Hospital admission date
  DATE_DATA     TEXT,          -- Data entry date
  COMMENT       TEXT,          -- Clinical / laboratory remarks
  ESBL          TEXT,          -- + or -
  CARBAPENEM    TEXT,          -- + or -
  MRSA          TEXT,          -- + or -
  URINECOUNT    TEXT,          -- Colony forming units (CFU/mL)
  SEROTYPE      TEXT,          -- Organism serotype
  BETA_LACT     TEXT,          -- Beta-lactamase production flag
  INDUC_CLI     TEXT           -- Inducible Clindamycin resistance
  -- Followed by antimicrobial ND / MIC test result columns:
  -- AMP_ND10, AMC_ND30, CRO_ND30, MEM_ND10, CIP_ND5, VAN_ND30, etc.
);
```

---

## 5. Universal Natural Sort Engine (`NATURAL_KEY`)

### Problem

ASCII sorting arranges string characters sequentially, causing `CSR-10` and `CSR-151` to precede `CSR-2`.

### Normalization Algorithm

Any continuous block of digits is padded to a 12-digit zero-prefixed string:

$$\text{"CSR-1"} \longrightarrow \text{"csr-000000000001"}$$
$$\text{"CSR-151"} \longrightarrow \text{"csr-000000000151"}$$
$$\text{"CSR-2"} \longrightarrow \text{"csr-000000000002"}$$

### Implementation:

- **Node.js**: Registered via `db.function('NATURAL_KEY', fn)` in `server.js`.
- **WASM Browser**: Registered via `db.create_function('NATURAL_KEY', fn)` in `src/js/db/wasm.js`.
- **Client JS Sorting**: Performed with `naturalCompare(a, b)` using `localeCompare(..., { numeric: true })` in `src/js/utils/natural-sort.js`.
