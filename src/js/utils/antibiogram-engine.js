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

  // 2. Resolve Breakpoint: Custom Lab Config Species-Specific -> Custom Lab General -> Bundled Matrix
  let bp = null;

  if (customLabConfig?.speciesBreakpoints?.[testCol]?.[orgLower]) {
    bp = customLabConfig.speciesBreakpoints[testCol][orgLower];
  } else if (customLabConfig?.generalBreakpoints?.[testCol]) {
    bp = customLabConfig.generalBreakpoints[testCol];
  } else if (bpMatrix[testCol]?.species?.[orgLower]) {
    bp = bpMatrix[testCol].species[orgLower];
  } else {
    // Check taxonomic parent groups (e.g. eco -> ebc, sau -> sta, aba -> ac-)
    const parentGroups = TAXON_PARENT_GROUPS[orgLower];
    if (parentGroups) {
      for (const groupCode of parentGroups) {
        if (customLabConfig?.speciesBreakpoints?.[testCol]?.[groupCode]) {
          bp = customLabConfig.speciesBreakpoints[testCol][groupCode];
          break;
        }
        if (bpMatrix[testCol]?.species?.[groupCode]) {
          bp = bpMatrix[testCol].species[groupCode];
          break;
        }
      }
    }
    if (!bp && bpMatrix[testCol]?.general) {
      bp = bpMatrix[testCol].general;
    }
  }

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
  for (const orgCode of Object.keys(orgMap)) {
    if (intrinsicMap[orgCode]) {
      for (const drug of intrinsicMap[orgCode]) {
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
    isUrineOnly: URINE_SPECIFIC_ANTIBIOTICS.has(code)
  })).sort((a, b) => a.name.localeCompare(b.name));

  return {
    organisms,
    antibiotics,
    totalFirstIsolates: isolates.length,
    minIsolatesThreshold: minIsolates,
    dedupMode: options.mode || 'patient_first',
    episodeDays: options.episodeDays || 30
  };
}
