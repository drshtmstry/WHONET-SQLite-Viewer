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
 * Interpret a raw AST measurement (zone size mm or MIC)
 * @param {string} orgCode WHONET organism code (e.g. 'sau', 'eco', 'kpn')
 * @param {string} testCol AST Column name (e.g. 'FOX_ND30', 'AMP_ND10', 'VAN_NM')
 * @param {number|string} rawValue Raw measurement
 * @param {object} [customLabConfig] Optional active lab configuration
 * @returns {'S'|'I'|'R'|null} Clinical interpretation
 */
export function interpretAstValue(orgCode, testCol, rawValue, customLabConfig = null) {
  if (rawValue === null || rawValue === undefined || rawValue === '') return null;

  const numVal = parseFloat(String(rawValue).replace(/[<>=]/g, '').trim());
  if (isNaN(numVal)) return null;

  const abxCode = testCol.split('_')[0];
  const orgLower = (orgCode || '').toLowerCase().trim();

  // 1. AMRIE Rule: Check Intrinsic Resistance first (ExpectedResistancePhenotypes)
  if (orgLower && intrinsicMap[orgLower] && intrinsicMap[orgLower].includes(abxCode)) {
    return 'R';
  }

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
  } else if (bpMatrix[testCol]?.general) {
    bp = bpMatrix[testCol].general;
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
 * Apply CLSI M39 First-Isolate Deduplication
 * @param {Array<object>} records Raw database isolate records
 * @returns {Array<object>} Deduplicated first isolates
 */
export function deduplicateFirstIsolates(records) {
  if (!Array.isArray(records)) return [];

  const sorted = [...records].sort((a, b) => {
    const da = a.SPEC_DATE || a.DATE_DATA || '';
    const db = b.SPEC_DATE || b.DATE_DATA || '';
    return da.localeCompare(db);
  });

  const seen = new Set();
  const firstIsolates = [];

  for (const rec of sorted) {
    const patId = (rec.PATIENT_ID || '').trim().toLowerCase();
    const org = (rec.ORGANISM || '').trim().toLowerCase();

    if (!patId || !org) {
      firstIsolates.push(rec);
      continue;
    }

    const key = `${patId}|${org}`;
    if (!seen.has(key)) {
      seen.add(key);
      firstIsolates.push(rec);
    }
  }

  return firstIsolates;
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
    if (!orgCode) continue;

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

    for (const [col, val] of Object.entries(row)) {
      if (/(_ND\d+|_NM|_NE\d+|_ED\d+|_EE\d+)$/.test(col) && val !== null && val !== '') {
        testColsSet.add(col);
        const interp = interpretAstValue(orgCode, col, val, customLabConfig);
        if (interp) {
          const abxCode = col.split('_')[0];
          if (!orgMap[orgCode].tested[abxCode]) {
            orgMap[orgCode].tested[abxCode] = { total: 0, S: 0, I: 0, R: 0, intrinsic: false };
          }
          orgMap[orgCode].tested[abxCode].total++;
          orgMap[orgCode].tested[abxCode][interp]++;
        }
      }
    }
  }

  // Annotate intrinsic resistance
  for (const orgCode of Object.keys(orgMap)) {
    if (intrinsicMap[orgCode]) {
      for (const drug of intrinsicMap[orgCode]) {
        if (!orgMap[orgCode].tested[drug]) {
          orgMap[orgCode].tested[drug] = { total: 0, S: 0, I: 0, R: 0, intrinsic: true };
        } else {
          orgMap[orgCode].tested[drug].intrinsic = true;
        }
      }
    }
  }

  const organisms = Object.values(orgMap).map(org => {
    const meetsThreshold = org.totalCount >= minIsolates;
    const drugStats = {};

    for (const [drug, stats] of Object.entries(org.tested)) {
      if (stats.intrinsic) {
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
      } else if (stats.total > 0) {
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
      } else {
        drugStats[drug] = null;
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
  organisms.forEach(o => Object.keys(o.drugStats).forEach(d => activeAbxCodes.add(d)));

  const antibiotics = Array.from(activeAbxCodes).map(code => ({
    code,
    name: abx[code]?.name || code,
    class: abx[code]?.class || 'Other',
    profClass: abx[code]?.profClass || ''
  })).sort((a, b) => a.name.localeCompare(b.name));

  return {
    organisms,
    antibiotics,
    totalFirstIsolates: isolates.length,
    minIsolatesThreshold: minIsolates
  };
}
