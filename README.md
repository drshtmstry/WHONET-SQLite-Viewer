<p align="center">
  <img src="public/logo.png" alt="WHONET SQLite Viewer Logo" width="128" />
</p>

# WHONET SQLite Viewer

<p>High-performance, open-source utility for inspecting, deduplicating, sorting, and analyzing WHONET SQLite databases.</p>
<p><a href="https://whonet-sqlite-viewer.vercel.app/"><strong>whonet-sqlite-viewer.vercel.app</strong></a></p>

---

> [!IMPORTANT]
> All data is processed **locally** — nothing is uploaded to any cloud server.
> Verify all generated figures before submitting to any surveillance body.

## Features

- **CLSI M39 Cumulative Antibiogram** — Clinical Laboratory Standards Institute (CLSI M39-A4) compliant cumulative antibiogram engine:
  - **1st-Isolate Deduplication**: Automatically includes only the initial isolate of a given species per patient in the surveillance period, eliminating diagnostic bias.
  - **Statistical Cutoff Alert (<30 isolates)**: Flags small sample sizes per CLSI recommendations with an intuitive toggle to show/hide organisms with insufficient isolates.
  - **Drug Class Grouping & Alphabetical Sorting**: Switch instantly between hierarchical grouping by drug classes (Penicillins, Cephalosporins, Carbapenems, Fluoroquinolones, Aminoglycosides, Glycopeptides, Polymyxins, etc. per CLSI Appendix E2) and standard alphabetical listing (CLSI Appendix E1).
  - **% Susceptible (%S) vs % Resistant (%R) Views**: Toggle between susceptibility rates for empiric therapy guidance and resistance rates for infection control.
  - **Specimen Type Filtering**: Filter by specific specimen categories (Urine, Blood, Respiratory, Pus/Wounds, Sterile Fluids, Stool, etc.) with automatic translation of WHONET specimen codes.
  - **Export & Clipboard Integration**: One-click Copy TSV for immediate pasting into Excel/Word, and instant CSV download for clinical audits.
- **Specimen & Organism Dictionary Translation** — Resolves cryptic WHONET 2-to-4 letter specimen codes (e.g. `ur`, `bl`, `sp`, `csf`) into standard clinical descriptions across 180+ specimen mappings, and provides full scientific binomial names from WHONET organism taxonomies.
- **Deduplication** — Identify and resolve duplicate isolates clustered by `SPEC_NUM` (Specimen #) or `PATIENT_ID` with batch selection and deletion.
- **Natural Column Sorting** — Interactive click-to-sort headers with intelligent alphanumeric ordering for specimen numbers (e.g. `CSR-1`, `CSR-2`, `CSR-10`, `CSR-151`, `-1/-2`, `-A/-B` suffixes) across Isolates, Duplicates, Antibiograms, and SQL Workspace.
- **Customizable Clinical Tables** — Patient Full Name display, combined `Age/Sex` formatting (`19/f`), locale-aware dates, compact action icons, and user-configurable resistance phenotype columns (ESBL, Carbapenem, MRSA) with browser persistence.
- **Monthly AMR Surveillance Report (SAPCAR-G)** — Standard Gujarat State Action Plan for Containment of Antimicrobial Resistance (SAPCAR-G) Culture & Sensitivity (C&S) reporting data (OPD / IPD / ICU × specimen types) with instant TSV clipboard copy and CSV export.
- **Interactive Visual Analytics** — Real-time Chart.js distribution charts (Organisms, Specimen Types, Wards, Age Groups, Gender, AMR Phenotypes) with dynamic date range filtering and single/dual view toggles.
- **Unified Persistent Navigation** — Persistent active database file pill with quick Refresh and Close database controls in the top header, accessible from any view on desktop and mobile.
- **In-Place Record Corrections** — Clean, inline field editing and full-record correction modals with immediate database sync.
- **Bulk Data Cleansing** — One-click uppercase specimen normalization and whitespace sanitation.
- **Intelligent SQL Console** — Built-in query editor with schema-aware autocomplete, keyboard shortcuts, and instant result table sorting.
- **Dual Runtime Architecture** — Runs either completely client-side in the browser via the In-Browser Engine (`sql.js`), or locally via Node.js native `DatabaseSync` (`node:sqlite`).

---

## Usage

### Web / PWA App (In-Browser Engine (Client-side))

Open **[whonet-sqlite-viewer.vercel.app](https://whonet-sqlite-viewer.vercel.app/)** in Chrome or Edge (or click the browser address bar icon to install as a desktop/mobile app):

- **Direct Folder Access**: Connect your local data folder once (`C:\WHONET\Data`) → the browser remembers the link and saves changes straight to disk.
- **Preloaded Sample Data**: Test immediately with bundled sample databases (`WHO-TST-2020-01.sqlite`, etc.).
- **100% Private On-Device Processing**: The database engine runs directly inside your browser; zero patient data is uploaded to any cloud server.

### Local SQLite Server (Node.js) Mode

1. Install [Node.js LTS](https://nodejs.org/) (v22+ recommended)
2. Run `start.bat` or use the command line:
   ```bash
   npm start              # run local Node server on http://localhost:7890 (with auto-restart)
   ```
3. Browser automatically opens at `http://localhost:7890`.
4. Reads `.sqlite` files directly from `C:\WHONET\Data`. Mutations save straight to disk with on-demand connection locking.

### Web / PWA Mode (Vercel)

For client-side Vite testing and building:

```bash
npm run web:dev        # launch in-browser WASM dev server
npm run web:build      # compile production bundle for Vercel (/dist)
npm run web:preview    # preview production build locally
```

---

## Project Structure & Modular Schema

The codebase is organized into a dual-runtime architecture supporting both local desktop execution and cloud-deployed PWA builds:

```
├── docs/
│   └── modular-schema.md   # Architectural specification & schema guide
├── public/                 # Static assets & PWA files
│   ├── manifest.json       # Web App Manifest for PWA installation
│   ├── sw.js               # Zero-cache Service Worker for instant updates
│   ├── favicon.ico / .png  # Official WHONET icons & touch assets
│   └── vendor/             # sql.js WebAssembly engine & binaries
├── src/                    # Application source code
│   ├── index.html          # Application UI layout & modals
│   ├── styles.css          # Design system, themes & responsive layouts
│   ├── organisms.js        # WHONET organism dictionary
│   ├── sample-data/        # Bundled sample SQLite databases
│   └── js/                 # Modular ES Module architecture
│       ├── main.js         # ES Module entry point & global event bridge
│       ├── state/store.js  # Reactive application state
│       ├── api/            # Local Node REST dispatcher & live-reload client
│       ├── db/             # WebAssembly database & File System Access API
│       ├── ui/             # Table rendering, modals, and toasts
│       ├── utils/          # Antibiogram engine, natural sort, specimens & formatters
│       │   ├── antibiogram-engine.js  # CLSI M39 deduplication & %S/%R matrix calculation
│       │   ├── antibiogram-rules.json # CLSI Appendix E antibiotic class groupings
│       │   ├── specimens.js           # 180+ specimen code to clinical name mappings
│       │   ├── natural-sort.js        # Alphanumeric specimen # sorting algorithm
│       │   ├── formatters.js          # Locale dates, Age/Sex merged formatting & escaping
│       │   └── organisms.js           # Taxonomical badge rendering & scientific names
│       └── pages/          # Dashboard, Isolates, Antibiogram, Duplicates, AMR, SQL, Fixes
│           ├── dashboard.js   # Summary KPIs & Chart.js visual analytics
│           ├── isolates.js    # All Isolates table & column configurations
│           ├── antibiogram.js # CLSI M39 cumulative antibiogram view & exports
│           ├── duplicates.js  # Isolate clustering & batch deduplication
│           ├── monthly-amr.js # Gujarat SAPCAR-G monthly surveillance matrix
│           ├── sql-workspace.js # Interactive SQL query runner with autocomplete
│           └── fixes.js       # Bulk specimen normalization & whitespace trim
├── server.js               # Local Node.js server (native node:sqlite & auto-sync)
├── start.bat               # Windows 1-click launcher for lab machines
├── vite.config.js          # Vite configuration for production builds
├── vercel.json             # Vercel deployment routing & static build config
└── package.json            # Project dependencies & operational scripts
```

For complete technical specifications, module contracts, and database table diagrams, refer to **[docs/modular-schema.md](docs/modular-schema.md)**.

---

## Disclaimer

**WHONET** is the intellectual property of the WHO Collaborating Centre for Surveillance of Antimicrobial Resistance (Brigham and Women's Hospital). [whonet.org](https://whonet.org)

This project is an independent open-source utility by [Dr. Darshit Mistry](https://drshtmstry.github.io/) and is not affiliated with, endorsed by, or sponsored by WHONET.
