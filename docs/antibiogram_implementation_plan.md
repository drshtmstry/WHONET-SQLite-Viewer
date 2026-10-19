# WHONET Antibiogram Implementation Plan (CLSI M39-A4 Compliant)

## 1. Executive Summary
This document establishes the architecture, algorithmic workflow, and user interface design for generating cumulative antibiograms strictly adhering to the **CLSI M39-A4** standard (*Analysis and Presentation of Cumulative Antimicrobial Susceptibility Test Data*), supporting **WHONET Laboratory Configurations**, and referencing the **WHONET-Development/AMRIE** (Antimicrobial Resistance Test Interpretation Engine) architecture.

---

## 2. Fundamental AST Architecture: Raw Measurements vs. Interpretation

WHONET SQLite data files (`IND-BMCRI-2024.sqlite`, `WHO-TST-2020-01.sqlite`) **do not store static interpretations (`R`, `I`, `S`)**. They store raw quantitative values:
- Disk diffusion zone sizes in mm (e.g., `AMP_ND10`, `CRO_ND30`, `FOX_ND30`).
- MIC dilution values (e.g., `VAN_NM`, `CIP_NM`).

In accordance with WHONET and AMRIE, interpretations are performed dynamically on-the-fly using:
1. **Laboratory Configuration Files (`LABIND.BMCRI`, `LABWHO.TST`)**:
   - Location: `C:\WHONET\LAB*.`
   - Defines laboratory metadata, active guidelines (e.g. `CLSI 2026`), active test panels, default breakpoints (`[Antibiotics]`), and organism-specific breakpoint overrides (`[Antibiotic Species-Specific Breakpoints]`).
2. **AMRIE Reference Rules & Files** (Referencing [WHONET-Development/AMRIE](https://github.com/WHONET-Development/AMRIE)):
   - **`Breakpoints.txt`**: Complete guideline breakpoint tables across years, methods (disk diffusion, MIC, E-test), sites of infection, and organism groups.
   - **`ExpectedResistancePhenotypes.txt`**: Intrinsic resistance definitions (bug-drug combinations that must report `R` without testing).
   - **`ExpertInterpretationRules.txt`**: Secondary deductive rules (e.g., inferring ampicillin/oxacillin/cefoxitin for beta-lactams, inducible clindamycin resistance D-zone test).

---

## 3. CLSI M39-A4 Core Principles & WHONET Options

### A. De-duplication Rules (One Isolate per Patient)
- **First Isolate Only (Default CLSI M39)**:
  - Include only the very first isolate of a given species per patient in the analysis window, irrespective of body site, specimen type, or phenotypic susceptibility.
- **First Isolate with Antibiotic Results**:
  - Useful when initial isolates lack susceptibility testing.
- **Time Interval (Episode Window)**:
  - Allow an isolate of the same species from the same patient if isolated $\ge N$ days (e.g. 30 days) since the previous isolate.
- **Resistance Phenotype Change**:
  - Allow repeat isolates if a major shift occurs (e.g., susceptible to resistant or vice versa).

### B. Statistical Thresholds
- **CLSI $\ge 30$ Isolates Rule**:
  - Antibiograms should only report species with $\ge 30$ tested isolates to ensure statistical confidence.
  - For $N < 30$, results should be flagged with an asterisk (`*`) or hidden based on user preference.

### C. Susceptibility Calculations & Intrinsic Resistance
- Report **% Susceptible (%S)** only:
  $$\%S = \frac{\text{Count of Susceptible (S)}}{\text{Total Isolates Tested for Drug}} \times 100$$
- Intermediate (%I) is **never** added to %S.
- **Intrinsic Resistance (`R`)**:
  - Combinations known to be intrinsically resistant (CLSI M100 / M39 Appendix J, AMRIE `ExpectedResistancePhenotypes.txt`) must be marked with `R` rather than misleading test percentages.
- **Special Subsets & Breakpoints**:
  - *Staphylococcus aureus*: Display overall *S. aureus* and the **MRSA** subset.
  - *Streptococcus pneumoniae*: Meningitis vs. Nonmeningitis criteria.
  - *Nitrofurantoin*: Restrict calculation strictly to urine isolates.

---

## 4. AMRIE-Compliant Interpretation Pipeline in WHONET-SQLite-Viewer

```
┌─────────────────────────────────┐      ┌──────────────────────────────────┐
│  Raw SQLite Table (ISOLATES)    │      │ Lab Config (C:\WHONET\LAB*.)    │
│  - Organism Code (e.g. 'sau')   │      │ - Guideline Year (e.g. 2026)     │
│  - Raw mm / MIC (e.g. FOX=22)   │      │ - Species-Specific Breakpoints   │
└────────────────┬────────────────┘      └────────────────┬─────────────────┘
                 │                                        │
                 ▼                                        ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                 AMRIE-Compatible Interpretation Engine                     │
│  1. Check ExpectedResistancePhenotypes (Intrinsic 'R')                   │
│  2. Match Species-Specific Breakpoint (Lab Config / Breakpoints.txt)      │
│  3. Fallback to General Breakpoint for Method & Potency                   │
│  4. Apply Expert Rules (Deductions & Warnings)                           │
│  5. Output Clinical Status: S, I, SDD, R                                 │
└─────────────────────────────────────┬─────────────────────────────────────┘
                                      │
                                      ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                   CLSI M39 Cumulative Antibiogram Matrix                  │
│  - First-isolate de-duplication applied                                   │
│  - Filtered by N >= 30 isolates threshold                                 │
│  - %S calculation & Intrinsic 'R' annotation                              │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Presentation Architecture

### A. Cumulative Antibiogram Tables
1. **CLSI Appendix E2 (By Drug Class)**:
   - Group antibiotics by class ($\beta$-lactams, Aminoglycosides, Fluoroquinolones, Macrolides, Carbapenems, etc.).
   - Separate tables for **Gram-Negative** and **Gram-Positive** organisms.
2. **CLSI Appendix E1 (Alphabetical)**:
   - Flat alphabetical list of antimicrobial agents.
3. **Table Features**:
   - Number of strains tested ($N$).
   - Conditional color formatting (high susceptibility green, intermediate warning, low resistance alert, distinctive badge for `R`).
   - Detailed tooltip with exact ratios ($S / \text{Tested}$).
   - Export to Excel (.xlsx), CSV, TSV, and formatted print preview.

### B. Visualizations & Trends (CLSI Appendix F)
1. **Longitudinal Susceptibility Trends (F1–F4)**:
   - Annual or quarterly trend line chart for key organism-antibiotic pairs (e.g. MRSA rates, CRE *K. pneumoniae*).
2. **Empiric Regimen Heatmap**:
   - Comprehensive matrix view comparing coverage across organisms.
3. **Location Stratification**:
   - Bar chart comparing %S between ICU, Inpatient (non-ICU), and Outpatient populations.

---

## 6. Technical Execution Phases
- **Phase 1: AMRIE Interpretation Engine & Config Reader**
  - Reader for WHONET `.BMCRI` / `.TST` configuration files.
  - Bundled CLSI breakpoints lookup matrix and intrinsic resistance tables (from `Breakpoints.txt` & `ExpectedResistancePhenotypes.txt`).
  - Unit logic mapping disk diffusion mm and MIC to `S`, `I`, `R`.
- **Phase 2: CLSI M39 De-duplication & Calculation Engine**
  - First-isolate deduplication algorithm with configurable episode windows (e.g. 365 days / 30 days).
  - %S aggregation with $N \ge 30$ threshold filtering.
- **Phase 3: Dual-Mode API / Client Engine**
  - Server-side execution in `server.js` for desktop/local installation.
  - Client-side execution in `wasm-emulator.js` for standalone browser/PWA usage.
- **Phase 4: Cumulative Antibiogram Table UI**
  - Tabular view (`Appendix E1` & `Appendix E2`) with clinical badge indicators and export capabilities.
- **Phase 5: Charts & Trend Visualizations**
  - Chart.js longitudinal trend lines and empiric therapy heatmaps.
