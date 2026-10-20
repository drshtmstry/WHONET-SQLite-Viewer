/**
 * Antibiogram & Antimicrobial Susceptibility Test (AST) Interpretation Engine
 * 
 * Attributions & Architecture:
 * The AST interpretation algorithms, clinical breakpoint resolution hierarchy (getApplicableBreakpoint),
 * taxonomic lookup order, and intrinsic resistance rules in this engine are adapted from and
 * reference the open-source AMRIE (Antimicrobial Resistance Test Interpretation Engine)
 * developed by the WHO Collaborating Centre for Surveillance of Antimicrobial Resistance:
 * https://github.com/WHONET-Development/AMRIE
 * 
 * Standards Compliance:
 * - CLSI M39-A4: Analysis and Presentation of Cumulative Antimicrobial Susceptibility Test Data
 * - CLSI M100 / EUCAST: Human Clinical Breakpoints & Expected Resistance Phenotypes
 */

import rulesData from './antibiogram-rules.json' with { type: 'json' };

const { abx, intrinsicMap, bpMatrix, orgNames = {} } = rulesData;

/**
 * Parse a WHONET laboratory configuration file (.BMCRI, .TST, etc.)
 * @param {string} configContent 
 * @returns {object} Parsed laboratory configuration
 */
export function parseLabConfig(configContent) {
  if (!configContent || typeof configContent !== 'string') return null;

  const lines = configContent.split(/\r?\n/);
  let currentSection = '';
  const config = {
    metadata: {},
    generalBreakpoints: {},
    speciesBreakpoints: {},
    wards: [],
    institutions: []
  };

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith(';')) continue;

    if (line.startsWith('[') && line.endsWith(']')) {
      currentSection = line.substring(1, line.length - 1).trim();
      continue;
    }

    if (currentSection === 'WHONET Configuration File') {
      const eqIdx = line.indexOf('=');
      if (eqIdx !== -1) {
        const key = line.substring(0, eqIdx).trim();
        const val = line.substring(eqIdx + 1).trim();
        config.metadata[key] = val;
      }
    } else if (currentSection === 'Antibiotics') {
      const parts = line.split(',');
      if (parts.length >= 3) {
        const testCode = parts[0].trim();
        const rVal = parseFloat(parts[2]?.trim());
        const iVal = parts[3]?.trim();
        const sVal = parseFloat(parts[4]?.trim());
        if (!isNaN(rVal) || !isNaN(sVal)) {
          config.generalBreakpoints[testCode] = {
            r: isNaN(rVal) ? null : rVal,
            i: iVal || null,
            s: isNaN(sVal) ? null : sVal
          };
        }
      }
    } else if (currentSection === 'Antibiotic Species-Specific Breakpoints') {
      const parts = line.split(',');
      if (parts.length >= 4) {
        const orgCode = parts[0].trim().toLowerCase();
        const testCode = parts[1].trim();
        const rVal = parseFloat(parts[2]?.trim());
        const sVal = parseFloat(parts[3]?.trim());
        if (!isNaN(rVal) || !isNaN(sVal)) {
          if (!config.speciesBreakpoints[testCode]) {
            config.speciesBreakpoints[testCode] = {};
          }
          config.speciesBreakpoints[testCode][orgCode] = {
            r: isNaN(rVal) ? null : rVal,
            s: isNaN(sVal) ? null : sVal
          };
        }
      }
    }
  }

  return config;
}

/**
 * Taxonomic Parent Group Mappings (CLSI M100 / EUCAST / WHONET)
 * Maps individual species codes to broad organism groups when breakpoints are defined at genus/family level
 * (e.g. E. coli 'eco' -> Enterobacterales 'ebc', S. aureus 'sau' -> Staphylococci 'sta').
 */
export const TAXON_PARENT_GROUPS = {
  // Enterobacterales (ebc)
  eco: ['ebc'], kpn: ['ebc'], kox: ['ebc'], kvi: ['ebc'], kle: ['ebc'],
  eae: ['ebc'], ecl: ['ebc'], ecx: ['ebc'],
  cfr: ['ebc'], cko: ['ebc'], cdi: ['ebc'], cbr: ['ebc'], cit: ['ebc'],
  smar: ['ebc'], ser: ['ebc'],
  pmi: ['ebc', 'pro'], pvu: ['ebc', 'pro'], pro: ['ebc'],
  mmo: ['ebc'], pre: ['ebc'], pst: ['ebc'], pve: ['ebc'],
  sal: ['ebc'], spt: ['ebc'], sty: ['ebc'],
  shi: ['ebc'], sdy: ['ebc'], sfl: ['ebc'], sso: ['ebc'],
  haf: ['ebc'], yen: ['ebc'], ypm: ['ebc'], yer: ['ebc'],
  pea: ['ebc'], plu: ['ebc'], edw: ['ebc'],

  // Staphylococci (sta)
  sau: ['sta', 'sc+'], sep: ['sta', 'scn'], sha: ['sta', 'scn'],
  shl: ['sta', 'scn'], sap: ['sta', 'scn'], slu: ['sta', 'scn'],
  scn: ['sta'], 'sc+': ['sta'], swa: ['sta', 'scn'], sca: ['sta', 'scn'],
  sxy: ['sta', 'scn'],

  // Enterococci (ent)
  efa: ['ent'], efm: ['ent'], eca: ['ent'], ega: ['ent'],
  edv: ['ent'], ehs: ['ent'], eav: ['ent'],

  // Acinetobacter (ac-, acb)
  aba: ['ac-', 'acb'], aca: ['ac-', 'acb'], alw: ['ac-', 'acb'],
  aha: ['ac-', 'acb'], ajs: ['ac-', 'acb'], ani: ['ac-', 'acb'],
  apt: ['ac-', 'acb'],

  // Pseudomonas (psd, pae)
  pae: ['psd'], ppu: ['psd'], pfl: ['psd'], pst: ['psd'],

  // Streptococci (str, stp)
  spn: ['str', 'stp'], spy: ['str', 'stp'], sag: ['str', 'stp'],
  sdg: ['str', 'stp'], sbo: ['str', 'stp'], smi: ['str', 'stp'],
  svi: ['str', 'stp'], san: ['str', 'stp'],

  // Haemophilus (ha-, hin)
  hin: ['ha-'], hpa: ['ha-', 'hin'], hhe: ['ha-', 'hin']
};

/**
 * Organism groups that have dedicated CLSI / EUCAST reference tables.
 * In accordance with CLSI M100 and WHONET AMRIE, these organisms MUST NEVER
 * fall back to 'general' breakpoints for antibiotics that are omitted, unapproved,
 * or discontinued (e.g. Gentamicin for Pseudomonas aeruginosa, Ampicillin for Klebsiella).
 */
export const DEDICATED_PATHOGEN_GROUPS = new Set([
  'ebc', 'sta', 'sc+', 'scn', 'ent', 'ac-', 'acb', 'psd', 'pae', 'str', 'stp', 'ha-', 'hin', 'bcs', 'sma', 'ne-'
]);

/**
 * AMRIE-compliant resolution of applicable clinical breakpoint.
 * Adheres strictly to CLSI M100 hierarchy and WHONET AMRIE FilterBreakpoints logic:
 * 1. Lab config species-specific override
 * 2. Official WHONET Resource species-specific (CLSI Human)
 * 3. Bundled Matrix species-specific
 * 4. Taxonomic parent group (e.g. eco -> ebc, sau -> sta, pae -> psd, aba -> ac-)
 * 5. General fallback ONLY for organisms without dedicated CLSI guideline tables
 *
 * @param {string} orgCode WHONET organism code (e.g. 'pae', 'eco', 'sau')
 * @param {string} testCol AST Column name (e.g. 'GEN_ND10', 'FOX_ND30')
 * @param {object} [customLabConfig] Active lab configuration
 * @returns {object|null} Applicable breakpoint { r, s, [year] } or null if none
 */
export function getApplicableBreakpoint(orgCode, testCol, customLabConfig = null) {
  if (!orgCode || !testCol) return null;
  const orgLower = orgCode.toLowerCase().trim();

  // 1. Direct Species-Specific Breakpoint:
  // Custom lab config override -> Official WHONET Resource -> Bundled Matrix
  if (customLabConfig?.speciesBreakpoints?.[testCol]?.[orgLower]) {
    return customLabConfig.speciesBreakpoints[testCol][orgLower];
  }
  if (customLabConfig?.resourceBreakpoints?.[testCol]?.[orgLower]) {
    return customLabConfig.resourceBreakpoints[testCol][orgLower];
  }
  if (bpMatrix[testCol]?.species?.[orgLower]) {
    return bpMatrix[testCol].species[orgLower];
  }

  // 2. Taxonomic Parent Groups (e.g. eco -> ebc, sau -> sta, pae -> psd, aba -> ac-)
  const parentGroups = TAXON_PARENT_GROUPS[orgLower];
  if (parentGroups && parentGroups.length > 0) {
    for (const groupCode of parentGroups) {
      if (customLabConfig?.speciesBreakpoints?.[testCol]?.[groupCode]) {
        return customLabConfig.speciesBreakpoints[testCol][groupCode];
      }
      if (customLabConfig?.resourceBreakpoints?.[testCol]?.[groupCode]) {
        return customLabConfig.resourceBreakpoints[testCol][groupCode];
      }
      if (bpMatrix[testCol]?.species?.[groupCode]) {
        return bpMatrix[testCol].species[groupCode];
      }
    }
  }

  // 3. AMRIE Rule: Organisms with dedicated CLSI reference tables (P. aeruginosa, Enterobacterales,
  // Staphylococci, Enterococci, Acinetobacter, etc.) MUST NEVER fall back to 'general'
  // breakpoints for drugs omitted or discontinued by CLSI (e.g. Gentamicin in P. aeruginosa).
  const isDedicatedPathogen = !!parentGroups || DEDICATED_PATHOGEN_GROUPS.has(orgLower);
  if (isDedicatedPathogen) {
    return null;
  }

  // 4. Fallback to General Breakpoints ONLY for non-table / miscellaneous organisms
  if (customLabConfig?.resourceBreakpoints?.[testCol]?.general) {
    return customLabConfig.resourceBreakpoints[testCol].general;
  }
  if (customLabConfig?.generalBreakpoints?.[testCol]) {
    return customLabConfig.generalBreakpoints[testCol];
  }
  if (bpMatrix[testCol]?.general) {
    return bpMatrix[testCol].general;
  }

  return null;
}

/**
 * Test whether an AST measurement value is blank, empty, or not tested
 * @param {any} val
 * @returns {boolean}
 */
export function isBlankAstValue(val) {
  if (val === null || val === undefined) return true;
  const str = String(val).trim();
  if (str === '' || str === '-' || str === '.' || str === 'ND' || str === 'NT' || str === 'NA' || str === 'null' || str === 'undefined') return true;
  return false;
}

/**
 * Interpret a raw AST measurement (zone size mm or MIC)
 * @param {string} orgCode WHONET organism code (e.g. 'sau', 'eco', 'kpn')
 * @param {string} testCol AST Column name (e.g. 'FOX_ND30', 'AMP_ND10', 'VAN_NM')
 * @param {number|string} rawValue Raw measurement
 * @param {object} [customLabConfig] Optional active lab configuration
 * @returns {'S'|'I'|'R'|null} Clinical interpretation
 */
export function interpretAstValue(orgCode, testCol, rawValue, customLabConfig = null) {
  if (isBlankAstValue(rawValue)) return null;

  const abxCode = testCol.split('_')[0];
  const orgLower = (orgCode || '').toLowerCase().trim();

  // 1. AMRIE Rule: Check Intrinsic Resistance first (ExpectedResistancePhenotypes)
  const resourceIntrinsic = customLabConfig?.resourceIntrinsicMap;
  if (resourceIntrinsic && resourceIntrinsic[orgLower]?.includes(abxCode)) {
    return 'R';
  }
  if (orgLower && intrinsicMap[orgLower] && intrinsicMap[orgLower].includes(abxCode)) {
    return 'R';
  }

  // Check for qualitative test result (e.g. 'S', 'I', 'R')
  const rawStr = String(rawValue).trim().toUpperCase();
  if (rawStr === 'S' || rawStr === 'SUS') return 'S';
  if (rawStr === 'R' || rawStr === 'RES') return 'R';
  if (rawStr === 'I' || rawStr === 'INT') return 'I';

  const numVal = parseFloat(rawStr.replace(/[<>=]/g, '').trim());
  if (isNaN(numVal)) return null;

  // Determine if MIC or Disk Diffusion
  const isMic = testCol.endsWith('_NM') || testCol.endsWith('_NE') || testCol.endsWith('_EM') || testCol.endsWith('_EE');

  // 2. Resolve Applicable Breakpoint via AMRIE logic
  const bp = getApplicableBreakpoint(orgLower, testCol, customLabConfig);
  if (!bp) return null;

  if (isMic) {
    if (bp.s !== null && numVal <= bp.s) return 'S';
    if (bp.r !== null && numVal >= bp.r) return 'R';
    return 'I';
  } else {
    if (bp.s !== null && numVal >= bp.s) return 'S';
    if (bp.r !== null && numVal <= bp.r) return 'R';
    return 'I';
  }
}

/**
 * Check if an isolate row contains at least one non-empty AST measurement
 * @param {object} row 
 * @returns {boolean}
 */
export function hasAstResults(row) {
  if (!row || typeof row !== 'object') return false;
  for (const [col, val] of Object.entries(row)) {
    if (/(_ND\d+|_NM|_NE\d+|_ED\d+|_EE\d+)$/.test(col) && !isBlankAstValue(val)) {
      return true;
    }
  }
  return false;
}

/**
 * Calculate AST interpretation score for isolate ranking
 * @param {object} row
 * @param {'R'|'S'} bias 'R' ranks resistance higher (R > I > S); 'S' ranks susceptibility higher (S > I > R)
 * @param {object} [customLabConfig]
 * @returns {number}
 */
export function getAstScore(row, bias = 'R', customLabConfig = null) {
  let score = 0;
  const orgCode = (row.ORGANISM || '').trim().toLowerCase();
  for (const [col, val] of Object.entries(row)) {
    if (/(_ND\d+|_NM|_NE\d+|_ED\d+|_EE\d+)$/.test(col) && !isBlankAstValue(val)) {
      const interp = interpretAstValue(orgCode, col, val, customLabConfig);
      if (bias === 'R') {
        if (interp === 'R') score += 3;
        else if (interp === 'I') score += 2;
        else if (interp === 'S') score += 1;
      } else {
        if (interp === 'S') score += 3;
        else if (interp === 'I') score += 2;
        else if (interp === 'R') score += 1;
      }
    }
  }
  return score;
}

/**
 * WHONET standard: organism codes starting with 'x' designate negative cultures,
 * no growth, normal flora, or non-pathogen screening results (e.g. 'xxx' = No growth,
 * 'xpa' = No pathogen isolated, 'xxp' = No parasites seen, 'xnf' = Normal flora).
 * These must be excluded from cumulative antibiogram analysis.
 * @param {string} orgCode
 * @returns {boolean}
 */
export function isNegativeOrganismResult(orgCode) {
  if (!orgCode || typeof orgCode !== 'string') return true;
  const clean = orgCode.trim().toLowerCase();
  if (!clean) return true;
  return clean.startsWith('x');
}

/**
 * Apply WHONET / CLSI M39 Isolate Deduplication Rules
 * @param {Array<object>} records Raw database isolate records
 * @param {object} [options]
 * @param {'patient_first'|'isolate'|'patient_first_ast'|'patient_most_resistant'|'patient_most_susceptible'|'episode'} [options.mode='patient_first']
 * @param {number} [options.episodeDays=30] Number of days since previous isolate for episode mode
 * @param {object} [options.customLabConfig] Optional active lab configuration
 * @returns {Array<object>} Deduplicated isolates
 */
export function deduplicateFirstIsolates(records, options = {}) {
  if (!Array.isArray(records)) return [];

  const mode = options.mode || 'patient_first';
  const episodeDays = Number(options.episodeDays) > 0 ? Number(options.episodeDays) : 30;
  const customLabConfig = options.customLabConfig || null;

  // Filter out negative results ('xxx', 'xpa', etc.), empty organism, and isolates without AST results (all blank)
  const validRecords = records.filter(r => !isNegativeOrganismResult(r.ORGANISM) && hasAstResults(r));

  // 1. By isolate: No deduplication — include all non-negative isolate records with AST results
  if (mode === 'isolate') {
    return validRecords;
  }

  // Chronological sort by specimen collection date or data entry date
  const sorted = [...validRecords].sort((a, b) => {
    const da = a.SPEC_DATE || a.DATE_DATA || '';
    const db = b.SPEC_DATE || b.DATE_DATA || '';
    return da.localeCompare(db);
  });

  // 2. By patient: First isolate only (Standard CLSI M39-A4 Recommendation)
  if (mode === 'patient_first') {
    const seen = new Set();
    const result = [];
    for (const rec of sorted) {
      const patId = (rec.PATIENT_ID || '').trim().toLowerCase();
      const org = (rec.ORGANISM || '').trim().toLowerCase();
      if (!patId || !org || isNegativeOrganismResult(org)) {
        continue;
      }
      const key = `${patId}|${org}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(rec);
      }
    }
    return result;
  }

  // 3. By patient: First isolate with antibiotic susceptibility results
  if (mode === 'patient_first_ast') {
    const seenWithAst = new Set();
    const fallbackMap = new Map();
    const result = [];

    for (const rec of sorted) {
      const patId = (rec.PATIENT_ID || '').trim().toLowerCase();
      const org = (rec.ORGANISM || '').trim().toLowerCase();
      if (!patId || !org) {
        result.push(rec);
        continue;
      }
      const key = `${patId}|${org}`;
      if (hasAstResults(rec)) {
        if (!seenWithAst.has(key)) {
          seenWithAst.add(key);
          result.push(rec);
        }
      } else if (!fallbackMap.has(key)) {
        fallbackMap.set(key, rec);
      }
    }

    // For patients where none of the isolates had AST results, keep their first isolate as fallback
    for (const [key, fallbackRec] of fallbackMap.entries()) {
      if (!seenWithAst.has(key)) {
        result.push(fallbackRec);
      }
    }
    return result;
  }

  // 4. By time interval / episode window (e.g. 30 days since previous isolation)
  if (mode === 'episode') {
    const lastDateMap = new Map();
    const result = [];

    for (const rec of sorted) {
      const patId = (rec.PATIENT_ID || '').trim().toLowerCase();
      const org = (rec.ORGANISM || '').trim().toLowerCase();
      if (!patId || !org) {
        result.push(rec);
        continue;
      }
      const key = `${patId}|${org}`;
      const dStr = rec.SPEC_DATE || rec.DATE_DATA || '';
      const recDate = dStr ? new Date(dStr.slice(0, 10)).getTime() : null;

      if (!lastDateMap.has(key)) {
        lastDateMap.set(key, recDate || 0);
        result.push(rec);
      } else {
        const lastDate = lastDateMap.get(key);
        if (recDate && lastDate) {
          const diffDays = (recDate - lastDate) / (1000 * 60 * 60 * 24);
          if (diffDays >= episodeDays) {
            lastDateMap.set(key, recDate);
            result.push(rec);
          }
        }
      }
    }
    return result;
  }

  // 5. By patient: Most resistant or most susceptible result for each species
  if (mode === 'patient_most_resistant' || mode === 'patient_most_susceptible') {
    const bias = mode === 'patient_most_resistant' ? 'R' : 'S';
    const groups = new Map();
    const anonymousIsolates = [];

    for (const rec of sorted) {
      const patId = (rec.PATIENT_ID || '').trim().toLowerCase();
      const org = (rec.ORGANISM || '').trim().toLowerCase();
      if (!patId || !org) {
        anonymousIsolates.push(rec);
        continue;
      }
      const key = `${patId}|${org}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(rec);
    }

    const result = [...anonymousIsolates];
    for (const [, list] of groups.entries()) {
      if (list.length === 1) {
        result.push(list[0]);
      } else {
        let bestRec = list[0];
        let bestScore = getAstScore(bestRec, bias, customLabConfig);
        for (let i = 1; i < list.length; i++) {
          const score = getAstScore(list[i], bias, customLabConfig);
          if (score > bestScore) {
            bestScore = score;
            bestRec = list[i];
          }
        }
        result.push(bestRec);
      }
    }
    return result;
  }

  return sorted;
}

/**
 * Antibiotics with clinical indications restricted exclusively to the urinary tract (CLSI M39 / M100).
 * In cumulative antibiograms, susceptibility % for these agents must be calculated strictly from urine isolates.
 */
export const URINE_SPECIFIC_ANTIBIOTICS = new Set([
  'NIT', // Nitrofurantoin
  'NFT', // Nitrofurantoin
  'NOR', // Norfloxacin
  'NAL', // Nalidixic acid
  'CIN', // Cinoxacin
  'MET', // Methenamine
  'FOS'  // Fosfomycin (oral uncomplicated UTI indication in CLSI)
]);

/**
 * WHO AWaRe Antibiotic Classification (Access, Watch, Reserve, Other)
 * Based on the WHO AWaRe 2023 / 2024 classification of antibiotics for
 * antimicrobial stewardship and surveillance.
 */
export const WHO_AWARE_MAP = {
  // ── ACCESS GROUP ──
  // Penicillins & Beta-lactamase Inhibitor Combinations
  AMP: 'Access', AMX: 'Access', AMC: 'Access', SAM: 'Access',
  PEN: 'Access', PHN: 'Access', CLX: 'Access', OXA: 'Access',
  DIC: 'Access', FLX: 'Access', NAF: 'Access', MET: 'Access',
  CRB: 'Access', APX: 'Access',

  // Aminoglycosides
  AMK: 'Access', GEN: 'Access', GEH: 'Access', KAN: 'Access',
  NET: 'Access', TOB: 'Access', SPT: 'Access', STR: 'Access',
  NEO: 'Access',

  // 1st & Selected 2nd Generation Cephalosporins
  CZO: 'Access', LEX: 'Access', CFR: 'Access', CXM: 'Access',
  RAD: 'Access', HAP: 'Access', CEF: 'Access', CEC: 'Access',
  CFD: 'Access',

  // Phenicols & Lincosamides
  CHL: 'Access', THA: 'Access', CLI: 'Access', LIN: 'Access',

  // Tetracyclines
  DOX: 'Access', TCY: 'Access', OTC: 'Access', CTC: 'Access',

  // Folate Pathway Inhibitors
  SXT: 'Access', COT: 'Access', TMP: 'Access', SMX: 'Access',
  STX: 'Access', SOX: 'Access', SDZ: 'Access', BDP: 'Access',

  // Nitrofurans & Imidazoles
  NIT: 'Access', NFT: 'Access', FZD: 'Access', NFZ: 'Access',
  MTZ: 'Access',

  // ── WATCH GROUP ──
  // 3rd & 4th Generation Cephalosporins
  CRO: 'Watch', CTX: 'Watch', CAZ: 'Watch', FEP: 'Watch',
  CFM: 'Watch', CPD: 'Watch', CFP: 'Watch', CSL: 'Watch',
  CTT: 'Watch', FOX: 'Watch', CPO: 'Watch', ZOX: 'Watch',
  CDR: 'Watch', DN: 'Watch', DIT: 'Watch', CTB: 'Watch',
  CMZ: 'Watch', FMX: 'Watch', MOX: 'Watch',

  // Broad-Spectrum / Antipseudomonal Penicillins
  TZP: 'Watch', PIP: 'Watch', TIM: 'Watch', TIC: 'Watch',
  AZL: 'Watch', MEZ: 'Watch',

  // Carbapenems
  MEM: 'Watch', IPM: 'Watch', ETP: 'Watch', DOR: 'Watch',
  BIA: 'Watch', PAN: 'Watch',

  // Fluoroquinolones & Quinolones
  CIP: 'Watch', LVX: 'Watch', MXF: 'Watch', OFX: 'Watch',
  NOR: 'Watch', NAL: 'Watch', GAT: 'Watch', GEM: 'Watch',
  LOM: 'Watch', SPX: 'Watch', ENX: 'Watch', PEF: 'Watch',
  PRU: 'Watch', CIN: 'Watch',

  // Macrolides & Ketolides
  AZM: 'Watch', CLR: 'Watch', ERY: 'Watch', ROX: 'Watch',
  SPI: 'Watch', TEL: 'Watch',

  // Glycopeptides & Monobactams
  VAN: 'Watch', TEC: 'Watch', ATM: 'Watch', CAR: 'Watch',

  // Other Watch Agents
  FOS: 'Watch', RIF: 'Watch', MNO: 'Watch', FUS: 'Watch',
  PRI: 'Watch',

  // ── RESERVE GROUP ──
  // Polymyxins
  COL: 'Reserve', CST: 'Reserve', PMB: 'Reserve', POL: 'Reserve',

  // Glycylcyclines & Novel Tetracyclines
  TGC: 'Reserve', ERV: 'Reserve', OMC: 'Reserve',

  // Oxazolidinones & Lipopeptides
  LNZ: 'Reserve', TZD: 'Reserve', DAP: 'Reserve',

  // Novel BL-BLI Combinations & Siderophores
  CZA: 'Reserve', CTZ: 'Reserve', MEV: 'Reserve', IMR: 'Reserve',
  AZA: 'Reserve', FDC: 'Reserve',

  // Novel Aminoglycosides & Pleuromutilins
  PLZ: 'Reserve', LFM: 'Reserve', QUD: 'Reserve'
};

/**
 * Resolve WHO AWaRe classification category for a given WHONET antibiotic code
 * @param {string} code Antibiotic code (e.g. 'AMK', 'MEM', 'COL')
 * @returns {'Access'|'Watch'|'Reserve'|'Other'}
 */
export function getAwareCategory(code) {
  if (!code) return 'Other';
  const clean = String(code).trim().toUpperCase();
  return WHO_AWARE_MAP[clean] || 'Other';
}

/**
 * Check if a specimen code designates a urine specimen in WHONET
 * @param {string|null|undefined} specType 
 * @returns {boolean}
 */
export function isUrineSpecimen(specType) {
  if (!specType || typeof specType !== 'string') return false;
  const clean = specType.trim().toLowerCase();
  // Standard WHONET urine codes: 'ur' (Urine), 'ub' (Bladder), 'uc' (Catheter), 'cv' (Clean-voided),
  // 'fv' (First-voided), 'uk' (Kidney), 'uo' (Nephrostomy), 'uz' (Non-catheterized), 'ua' (Suprapubic), 'uu' (Unknown urine)
  if (['ur', 'ub', 'uc', 'cv', 'fv', 'uk', 'uo', 'uz', 'ua', 'uu'].includes(clean)) return true;
  if (clean.startsWith('ur')) return true;
  return false;
}

/**
 * Generate Cumulative Antibiogram Summary conforming to CLSI M39-A4
 * @param {Array<object>} isolates First isolates
 * @param {object} options Options: minIsolates (default 30), customLabConfig
 * @returns {object} Antibiogram report with organisms, antibiotics and %S cells
 */
export function calculateCumulativeAntibiogram(isolates, options = {}) {
  const minIsolates = options.minIsolates !== undefined ? options.minIsolates : 30;
  const customLabConfig = options.customLabConfig || null;

  const testColsSet = new Set();
  const orgMap = {};

  for (const row of isolates) {
    const orgCode = (row.ORGANISM || '').trim().toLowerCase();
    if (!orgCode || isNegativeOrganismResult(orgCode)) continue;
    if (!hasAstResults(row)) continue;

    if (!orgMap[orgCode]) {
      const resolvedName = orgNames[orgCode] ||
        (typeof window !== 'undefined' && window.whonetOrganisms && window.whonetOrganisms[orgCode]) ||
        orgCode.toUpperCase();

      orgMap[orgCode] = {
        orgCode,
        orgName: resolvedName,
        totalCount: 0,
        tested: {}
      };
    }
    orgMap[orgCode].totalCount++;

    const rowIsUrine = isUrineSpecimen(row.SPEC_TYPE);

    // Track tested antibiotics for this isolate to prevent double-counting across disk & MIC
    const abxEntriesThisRow = {};

    for (const [col, val] of Object.entries(row)) {
      if (/(_ND\d+|_NM|_NE\d+|_ED\d+|_EE\d+)$/.test(col) && !isBlankAstValue(val)) {
        const abxCode = col.split('_')[0].toUpperCase();

        // CLSI M39 Section 5.3: Urinary tract agents (e.g., Nitrofurantoin, Norfloxacin)
        // must ONLY be calculated from urinary isolates!
        if (URINE_SPECIFIC_ANTIBIOTICS.has(abxCode) && !rowIsUrine) {
          continue;
        }

        const interp = interpretAstValue(orgCode, col, val, customLabConfig);
        if (interp) {
          testColsSet.add(col);
          const isMic = col.endsWith('_NM') || col.endsWith('_NE') || col.endsWith('_EM') || col.endsWith('_EE');
          // Prefer MIC over Disk if both present in the same isolate
          if (!abxEntriesThisRow[abxCode] || isMic) {
            abxEntriesThisRow[abxCode] = { interp, col };
          }
        }
      }
    }

    // Record at most ONE test result per antibiotic per isolate
    for (const [abxCode, entry] of Object.entries(abxEntriesThisRow)) {
      if (!orgMap[orgCode].tested[abxCode]) {
        orgMap[orgCode].tested[abxCode] = { total: 0, S: 0, I: 0, R: 0, intrinsic: false };
      }
      orgMap[orgCode].tested[abxCode].total++;
      orgMap[orgCode].tested[abxCode][entry.interp]++;
    }
  }

  // Annotate intrinsic resistance ONLY for drugs that were actually tested (total > 0).
  // Untested drugs (blank value) must never be counted or marked as resistant.
  const combinedIntrinsic = { ...intrinsicMap, ...(customLabConfig?.resourceIntrinsicMap || {}) };
  for (const orgCode of Object.keys(orgMap)) {
    if (combinedIntrinsic[orgCode]) {
      for (const drug of combinedIntrinsic[orgCode]) {
        if (orgMap[orgCode].tested[drug] && orgMap[orgCode].tested[drug].total > 0) {
          orgMap[orgCode].tested[drug].intrinsic = true;
        }
      }
    }
  }

  const organisms = Object.values(orgMap)
    .filter(org => {
      if (isNegativeOrganismResult(org.orgCode)) return false;
      return Object.values(org.tested).some(stats => stats.total > 0);
    })
    .map(org => {
    const meetsThreshold = org.totalCount >= minIsolates;
    const drugStats = {};

    for (const [drug, stats] of Object.entries(org.tested)) {
      if (!stats || stats.total === 0) {
        drugStats[drug] = null;
      } else if (stats.intrinsic) {
        drugStats[drug] = {
          pctS: 0,
          pctR: 100,
          pctI: 0,
          isIntrinsic: true,
          displayS: 'R',
          displayR: '100% (R)',
          testedCount: stats.total,
          sCount: stats.S,
          rCount: stats.R,
          iCount: stats.I
        };
      } else {
        const pctS = Math.round((stats.S / stats.total) * 100);
        const pctR = Math.round((stats.R / stats.total) * 100);
        const pctI = Math.round((stats.I / stats.total) * 100);
        drugStats[drug] = {
          pctS,
          pctR,
          pctI,
          isIntrinsic: false,
          displayS: `${pctS}%`,
          displayR: `${pctR}%`,
          testedCount: stats.total,
          sCount: stats.S,
          rCount: stats.R,
          iCount: stats.I
        };
      }
    }

    return {
      orgCode: org.orgCode,
      orgName: org.orgName,
      totalCount: org.totalCount,
      meetsThreshold,
      drugStats
    };
  });

  organisms.sort((a, b) => a.orgName.localeCompare(b.orgName));

  const activeAbxCodes = new Set();
  organisms.forEach(o => {
    Object.entries(o.drugStats).forEach(([d, stats]) => {
      if (stats && stats.testedCount > 0) {
        activeAbxCodes.add(d);
      }
    });
  });

  const antibiotics = Array.from(activeAbxCodes).map(code => ({
    code,
    name: abx[code]?.name || code,
    class: abx[code]?.class || 'Other',
    profClass: abx[code]?.profClass || '',
    aware: getAwareCategory(code),
    isUrineOnly: URINE_SPECIFIC_ANTIBIOTICS.has(code)
  })).sort((a, b) => a.name.localeCompare(b.name));

  const trends = calculateAmrTrends(isolates, options);
  const locations = calculateLocationStratification(isolates, options);

  return {
    organisms,
    antibiotics,
    trends,
    locations,
    totalFirstIsolates: isolates.length,
    minIsolatesThreshold: minIsolates,
    dedupMode: options.mode || 'patient_first',
    episodeDays: options.episodeDays || 30
  };
}

/**
 * Calculate Longitudinal AMR Trends (CLSI M39 Appendix F)
 * Analyzes monthly and quarterly rates for key resistant phenotypes:
 * - MRSA (Methicillin-resistant S. aureus)
 * - CRE (Carbapenem-resistant Enterobacterales)
 * - ESBL (Extended-spectrum beta-lactamase E. coli / K. pneumoniae)
 * - CRAB (Carbapenem-resistant A. baumannii)
 * - CRPA (Carbapenem-resistant P. aeruginosa)
 * - VRE (Vancomycin-resistant Enterococcus)
 * - FQ_GN (Fluoroquinolone-resistant Gram-negatives)
 *
 * @param {Array<object>} isolates Deduplicated first-isolates
 * @param {object} [options]
 * @returns {object} Monthly and quarterly aggregated trend metrics
 */
export function calculateAmrTrends(isolates, options = {}) {
  const customLabConfig = options.customLabConfig || null;

  const monthMap = new Map();

  const ENTEROBACTERALES = new Set(['eco', 'kpn', 'kox', 'ecl', 'eca', 'eae', 'ccl', 'cfr', 'pmi', 'pvu', 'mor', 'sma', 'ebc']);
  const CARBAPENEMS = new Set(['MEM', 'IPM', 'ETP', 'DOR']);
  const CEPH_34 = new Set(['CRO', 'CTX', 'CAZ', 'FEP']);

  for (const row of isolates) {
    const orgCode = (row.ORGANISM || '').trim().toLowerCase();
    if (!orgCode || isNegativeOrganismResult(orgCode)) continue;

    const rawDate = String(row.SPEC_DATE || row.DATE_DATA || '').trim();
    if (!rawDate || rawDate.length < 7) continue;
    const monthKey = rawDate.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(monthKey)) continue;

    if (!monthMap.has(monthKey)) {
      monthMap.set(monthKey, {
        month: monthKey,
        mrsa: { total: 0, R: 0, S: 0, I: 0 },
        cre: { total: 0, R: 0, S: 0, I: 0 },
        esbl: { total: 0, R: 0, S: 0, I: 0 },
        crab: { total: 0, R: 0, S: 0, I: 0 },
        crpa: { total: 0, R: 0, S: 0, I: 0 },
        vre: { total: 0, R: 0, S: 0, I: 0 },
        fq_gn: { total: 0, R: 0, S: 0, I: 0 },
        locations: {
          icu: { total: 0, resistant: 0 },
          inpatient: { total: 0, resistant: 0 },
          outpatient: { total: 0, resistant: 0 }
        },
        pairs: {}
      });
    }

    const mData = monthMap.get(monthKey);
    const wardLower = (row.WARD || '').toLowerCase();
    const wardTypeLower = (row.WARD_TYPE || '').toLowerCase();
    const isIcu = wardTypeLower === 'icu' || wardLower.includes('icu') || wardLower.includes('intensive') || wardLower.includes('ccu');
    const isOutpatient = wardTypeLower === 'out' || wardLower.includes('opd') || wardLower.includes('out') || wardLower.includes('clinic');
    const locKey = isIcu ? 'icu' : (isOutpatient ? 'outpatient' : 'inpatient');

    const rowIsUrine = isUrineSpecimen(row.SPEC_TYPE);

    const abxInterps = {};
    for (const [col, val] of Object.entries(row)) {
      if (/(_ND\d+|_NM|_NE\d+|_ED\d+|_EE\d+)$/.test(col) && !isBlankAstValue(val)) {
        const abxCode = col.split('_')[0].toUpperCase();
        if (URINE_SPECIFIC_ANTIBIOTICS.has(abxCode) && !rowIsUrine) continue;

        const interp = interpretAstValue(orgCode, col, val, customLabConfig);
        if (interp) {
          const isMic = col.endsWith('_NM') || col.endsWith('_NE') || col.endsWith('_EM') || col.endsWith('_EE');
          if (!abxInterps[abxCode] || isMic) {
            abxInterps[abxCode] = interp;
          }
        }
      }
    }

    // 1. MRSA: Staphylococcus aureus ('sau') vs Cefoxitin ('FOX') or Oxacillin ('OXA')
    if (orgCode === 'sau') {
      const foxInterp = abxInterps['FOX'] || abxInterps['OXA'];
      if (foxInterp) {
        mData.mrsa.total++;
        mData.mrsa[foxInterp]++;
        mData.locations[locKey].total++;
        if (foxInterp === 'R') mData.locations[locKey].resistant++;
      }
    }

    // 2. CRE: Enterobacterales vs Carbapenems (MEM, IPM, ETP, DOR)
    if (ENTEROBACTERALES.has(orgCode)) {
      let testedCarbapenem = false;
      let isResistant = false;
      let hasInterm = false;
      for (const c of CARBAPENEMS) {
        if (abxInterps[c]) {
          testedCarbapenem = true;
          if (abxInterps[c] === 'R') isResistant = true;
          else if (abxInterps[c] === 'I') hasInterm = true;
        }
      }
      if (testedCarbapenem) {
        mData.cre.total++;
        if (isResistant) mData.cre.R++;
        else if (hasInterm) mData.cre.I++;
        else mData.cre.S++;

        mData.locations[locKey].total++;
        if (isResistant) mData.locations[locKey].resistant++;
      }
    }

    // 3. ESBL: E. coli ('eco') & K. pneumoniae ('kpn') vs 3rd/4th gen Cephalosporins (CRO, CTX, CAZ, FEP)
    if (orgCode === 'eco' || orgCode === 'kpn') {
      let testedCeph = false;
      let isResistant = false;
      let hasInterm = false;
      for (const c of CEPH_34) {
        if (abxInterps[c]) {
          testedCeph = true;
          if (abxInterps[c] === 'R') isResistant = true;
          else if (abxInterps[c] === 'I') hasInterm = true;
        }
      }
      if (testedCeph) {
        mData.esbl.total++;
        if (isResistant) mData.esbl.R++;
        else if (hasInterm) mData.esbl.I++;
        else mData.esbl.S++;
      }
    }

    // 4. CRAB: Acinetobacter baumannii ('aba') vs Carbapenems
    if (orgCode === 'aba' || orgCode === 'ac-') {
      const memInterp = abxInterps['MEM'] || abxInterps['IPM'];
      if (memInterp) {
        mData.crab.total++;
        mData.crab[memInterp]++;
      }
    }

    // 5. CRPA: Pseudomonas aeruginosa ('pae') vs Carbapenems
    if (orgCode === 'pae') {
      const memInterp = abxInterps['MEM'] || abxInterps['IPM'];
      if (memInterp) {
        mData.crpa.total++;
        mData.crpa[memInterp]++;
      }
    }

    // 6. VRE: Enterococcus ('efa', 'efm', 'enc') vs Vancomycin ('VAN')
    if (orgCode === 'efa' || orgCode === 'efm' || orgCode === 'enc') {
      const vanInterp = abxInterps['VAN'];
      if (vanInterp) {
        mData.vre.total++;
        mData.vre[vanInterp]++;
      }
    }

    // 7. FQ_GN: Gram-negatives vs Fluoroquinolones (CIP, LVX)
    if (ENTEROBACTERALES.has(orgCode) || orgCode === 'aba' || orgCode === 'pae') {
      const fqInterp = abxInterps['CIP'] || abxInterps['LVX'];
      if (fqInterp) {
        mData.fq_gn.total++;
        mData.fq_gn[fqInterp]++;
      }
    }

    // 8. Individual Bug-Drug Pairs
    for (const [abxCode, interp] of Object.entries(abxInterps)) {
      const pairKey = `${orgCode}:${abxCode}`;
      if (!mData.pairs[pairKey]) {
        mData.pairs[pairKey] = { total: 0, R: 0, S: 0, I: 0 };
      }
      mData.pairs[pairKey].total++;
      mData.pairs[pairKey][interp]++;
    }
  }

  const sortedMonths = Array.from(monthMap.keys()).sort();

  const monthlyList = sortedMonths.map(mKey => {
    const d = monthMap.get(mKey);
    const computePct = (st) => {
      if (!st || st.total === 0) return { pctR: null, pctS: null, pctI: null, total: 0, R: 0, S: 0, I: 0 };
      return {
        total: st.total,
        R: st.R,
        S: st.S,
        I: st.I,
        pctR: Math.round((st.R / st.total) * 100),
        pctS: Math.round((st.S / st.total) * 100),
        pctI: Math.round((st.I / st.total) * 100)
      };
    };

    return {
      month: mKey,
      mrsa: computePct(d.mrsa),
      cre: computePct(d.cre),
      esbl: computePct(d.esbl),
      crab: computePct(d.crab),
      crpa: computePct(d.crpa),
      vre: computePct(d.vre),
      fq_gn: computePct(d.fq_gn),
      locations: {
        icu: d.locations.icu.total > 0 ? Math.round((d.locations.icu.resistant / d.locations.icu.total) * 100) : null,
        icuTotal: d.locations.icu.total,
        inpatient: d.locations.inpatient.total > 0 ? Math.round((d.locations.inpatient.resistant / d.locations.inpatient.total) * 100) : null,
        inpatientTotal: d.locations.inpatient.total,
        outpatient: d.locations.outpatient.total > 0 ? Math.round((d.locations.outpatient.resistant / d.locations.outpatient.total) * 100) : null,
        outpatientTotal: d.locations.outpatient.total
      },
      pairs: d.pairs
    };
  });

  return {
    months: sortedMonths,
    monthly: monthlyList
  };
}

/**
 * Calculate Care Location Susceptibility Stratification (CLSI M39-A4 Section 6.4)
 * Stratifies antimicrobial susceptibility and resistance profiles by care environment:
 * - ICU (Intensive Care Units)
 * - Inpatient (Non-ICU inpatient wards)
 * - Outpatient (Ambulatory care / OPD)
 *
 * @param {Array<object>} isolates Deduplicated first-isolates
 * @param {object} [options]
 * @returns {object} Location stratification breakdown by organism and antibiotic
 */
export function calculateLocationStratification(isolates, options = {}) {
  const customLabConfig = options.customLabConfig || null;
  const combinedIntrinsic = { ...intrinsicMap, ...(customLabConfig?.resourceIntrinsicMap || {}) };

  const byOrg = {};
  let icuTotal = 0;
  let inpatientTotal = 0;
  let outpatientTotal = 0;

  for (const row of isolates) {
    const orgCode = (row.ORGANISM || '').trim().toLowerCase();
    if (!orgCode || isNegativeOrganismResult(orgCode)) continue;
    if (!hasAstResults(row)) continue;

    const wardLower = (row.WARD || '').toLowerCase();
    const wardTypeLower = (row.WARD_TYPE || '').toLowerCase();
    const isIcu = wardTypeLower === 'icu' || wardLower.includes('icu') || wardLower.includes('intensive') || wardLower.includes('ccu');
    const isOutpatient = wardTypeLower === 'out' || wardLower.includes('opd') || wardLower.includes('out') || wardLower.includes('clinic');
    const locKey = isIcu ? 'icu' : (isOutpatient ? 'outpatient' : 'inpatient');

    if (locKey === 'icu') icuTotal++;
    else if (locKey === 'outpatient') outpatientTotal++;
    else inpatientTotal++;

    if (!byOrg[orgCode]) {
      const resolvedName = orgNames[orgCode] ||
        (typeof window !== 'undefined' && window.whonetOrganisms && window.whonetOrganisms[orgCode]) ||
        orgCode.toUpperCase();

      byOrg[orgCode] = {
        orgCode,
        orgName: resolvedName,
        totalCount: 0,
        icuCount: 0,
        inpatientCount: 0,
        outpatientCount: 0,
        tested: {
          icu: {},
          inpatient: {},
          outpatient: {}
        }
      };
    }

    const orgEntry = byOrg[orgCode];
    orgEntry.totalCount++;
    if (locKey === 'icu') orgEntry.icuCount++;
    else if (locKey === 'outpatient') orgEntry.outpatientCount++;
    else orgEntry.inpatientCount++;

    const rowIsUrine = isUrineSpecimen(row.SPEC_TYPE);
    const abxEntriesThisRow = {};

    for (const [col, val] of Object.entries(row)) {
      if (/(_ND\d+|_NM|_NE\d+|_ED\d+|_EE\d+)$/.test(col) && !isBlankAstValue(val)) {
        const abxCode = col.split('_')[0].toUpperCase();
        if (URINE_SPECIFIC_ANTIBIOTICS.has(abxCode) && !rowIsUrine) continue;

        const interp = interpretAstValue(orgCode, col, val, customLabConfig);
        if (interp) {
          const isMic = col.endsWith('_NM') || col.endsWith('_NE') || col.endsWith('_EM') || col.endsWith('_EE');
          if (!abxEntriesThisRow[abxCode] || isMic) {
            abxEntriesThisRow[abxCode] = interp;
          }
        }
      }
    }

    const locTested = orgEntry.tested[locKey];
    for (const [abxCode, interp] of Object.entries(abxEntriesThisRow)) {
      if (!locTested[abxCode]) {
        locTested[abxCode] = { total: 0, S: 0, I: 0, R: 0, intrinsic: false };
      }
      locTested[abxCode].total++;
      locTested[abxCode][interp]++;
    }
  }

  // Annotate intrinsic resistance
  for (const [orgCode, orgEntry] of Object.entries(byOrg)) {
    if (combinedIntrinsic[orgCode]) {
      for (const drug of combinedIntrinsic[orgCode]) {
        for (const locKey of ['icu', 'inpatient', 'outpatient']) {
          if (orgEntry.tested[locKey][drug] && orgEntry.tested[locKey][drug].total > 0) {
            orgEntry.tested[locKey][drug].intrinsic = true;
          }
        }
      }
    }
  }

  // Build processed organism objects
  const orgList = Object.values(byOrg).map(org => {
    const allAbx = new Set([
      ...Object.keys(org.tested.icu),
      ...Object.keys(org.tested.inpatient),
      ...Object.keys(org.tested.outpatient)
    ]);

    const drugs = {};

    for (const abxCode of allAbx) {
      const getLocStats = (locKey) => {
        const st = org.tested[locKey][abxCode];
        if (!st || st.total === 0) {
          return { total: 0, S: 0, I: 0, R: 0, pctS: null, pctR: null, pctI: null, isIntrinsic: false };
        }
        if (st.intrinsic) {
          return {
            total: st.total,
            S: 0,
            I: 0,
            R: st.total,
            pctS: 0,
            pctR: 100,
            pctI: 0,
            isIntrinsic: true
          };
        }
        return {
          total: st.total,
          S: st.S,
          I: st.I,
          R: st.R,
          pctS: Math.round((st.S / st.total) * 100),
          pctR: Math.round((st.R / st.total) * 100),
          pctI: Math.round((st.I / st.total) * 100),
          isIntrinsic: false
        };
      };

      const icuStats = getLocStats('icu');
      const inpatStats = getLocStats('inpatient');
      const outpatStats = getLocStats('outpatient');

      // Calculate disparity (Delta)
      // Comparison priority: ICU vs Outpatient; if no outpatient, ICU vs Inpatient
      let deltaR = null;
      let deltaS = null;
      if (icuStats.pctR !== null && outpatStats.pctR !== null) {
        deltaR = icuStats.pctR - outpatStats.pctR;
      } else if (icuStats.pctR !== null && inpatStats.pctR !== null) {
        deltaR = icuStats.pctR - inpatStats.pctR;
      }

      if (icuStats.pctS !== null && outpatStats.pctS !== null) {
        deltaS = outpatStats.pctS - icuStats.pctS;
      } else if (icuStats.pctS !== null && inpatStats.pctS !== null) {
        deltaS = inpatStats.pctS - icuStats.pctS;
      }

      drugs[abxCode] = {
        code: abxCode,
        name: abx[abxCode]?.name || abxCode,
        class: abx[abxCode]?.class || 'Other',
        aware: getAwareCategory(abxCode),
        isUrineOnly: URINE_SPECIFIC_ANTIBIOTICS.has(abxCode),
        icu: icuStats,
        inpatient: inpatStats,
        outpatient: outpatStats,
        deltaR,
        deltaS
      };
    }

    return {
      orgCode: org.orgCode,
      orgName: org.orgName,
      totalCount: org.totalCount,
      icuCount: org.icuCount,
      inpatientCount: org.inpatientCount,
      outpatientCount: org.outpatientCount,
      drugs
    };
  });

  orgList.sort((a, b) => b.totalCount - a.totalCount || a.orgName.localeCompare(b.orgName));

  return {
    summary: {
      icuTotal,
      inpatientTotal,
      outpatientTotal,
      totalIsolates: isolates.length
    },
    byOrg: Object.fromEntries(orgList.map(o => [o.orgCode, o])),
    orgList
  };
}
