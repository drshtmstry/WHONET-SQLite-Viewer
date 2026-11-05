/**
 * Builds static JSON resources for Resource Explorer from AMRIE resource definitions.
 * Includes complete AMRIE taxonomic hierarchy, panel-to-member mappings, and organism-specific resolution.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const candidateDirs = [
  'C:/Users/drshtmstry/Documents/GitHub/AMRIE/Interpretation Engine/Resources/',
  path.resolve(__dirname, '../../AMRIE/Interpretation Engine/Resources/')
];

let srcDir = candidateDirs.find(d => fs.existsSync(d));
if (!srcDir) {
  console.error('AMRIE Resources directory not found. Checked:', candidateDirs);
  process.exit(1);
}

const outDir = path.resolve(__dirname, '../public/resources');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// ── 1. Panel & Group Definitions (Clinical Taxonomy) ──
const panelDescriptions = {
  EBC: 'Enterobacterales',
  STA: 'Staphylococcus sp.',
  ENT: 'Enterococcus sp.',
  STR: 'Streptococcus sp.',
  'AC-': 'Acinetobacter sp.',
  ACI: 'Acinetobacter sp.',
  PSE: 'Pseudomonas sp.',
  'PS-': 'Pseudomonas sp.',
  NFR: 'Other non-Enterobacterales',
  BCS: 'Burkholderia cepacia complex',
  ANA: 'Anaerobic bacteria',
  'AN+': 'Gram-positive anaerobes',
  'AN-': 'Gram-negative anaerobes',
  SVI: 'Viridans group streptococci',
  SCN: 'Coagulase-negative staphylococci',
  'SC+': 'Coagulase-positive staphylococci',
  'HA-': 'Haemophilus sp.',
  HIN: 'Haemophilus influenzae',
  'NE-': 'Neisseria sp.',
  ALL: 'General Breakpoints',
  Gen: 'General Breakpoints',
  LAC: 'Lactobacillus sp.',
  LEU: 'Leuconostoc sp.',
  PED: 'Pediococcus sp.',
  PAS: 'Pasteurella sp.',
  CAR: 'Cardiobacterium sp.',
  EIK: 'Eikenella corrodens',
  KIN: 'Kingella sp.',
  CAM: 'Campylobacter sp.',
  COF: 'Campylobacter fetus',
  AER: 'Aeromonas sp.',
  CAN: 'Candida sp.',
  BFX: 'Bacteroides fragilis group',
  PFX: 'Prevotella bivia group',
  MTX: 'Mycobacterium tuberculosis complex',
  MAX: 'Mycobacterium avium complex',
  RGM: 'Rapidly growing mycobacteria',
  SAL: 'Salmonella sp.',
  'BR-': 'Brucella sp.',
  'BS-': 'Bacillus sp.',
  AGT: 'Aggregatibacter sp.',
  PLE: 'Plesiomonas shigelloides',
  GCT: 'Granulicatella / Abiotrophia'
};

// ── 2. Organisms lookup & Taxonomic Panel Mapping ──
const orgRaw = fs.readFileSync(path.join(srcDir, 'Organisms.txt'), 'utf8').trim().split('\n');
const orgLookup = {};
const memberToPanels = {};
const panelToMembers = {};

for (let i = 1; i < orgRaw.length; i++) {
  const parts = orgRaw[i].split('\t');
  const code = parts[0]?.trim();
  const name = parts[2]?.trim();
  const isAnaerobe = parts[6]?.trim() === 'X';
  const fam = parts[10]?.trim().toUpperCase();
  const genGrp = parts[11]?.trim().toUpperCase();
  const gen = parts[12]?.trim().toUpperCase();
  const spGrp = parts[13]?.trim().toUpperCase();
  const serGrp = parts[14]?.trim().toUpperCase();

  if (code) {
    const codeLower = code.toLowerCase();
    orgLookup[codeLower] = name || code;
    orgLookup[code] = name || code;

    const panels = [];
    [fam, gen, spGrp, serGrp, genGrp].forEach(p => {
      if (p && !panels.includes(p)) panels.push(p);
    });
    if (isAnaerobe && !panels.includes('ANA')) {
      panels.push('ANA');
    }

    if (panels.length) {
      memberToPanels[codeLower] = panels;
      panels.forEach(p => {
        if (!panelToMembers[p]) panelToMembers[p] = [];
        panelToMembers[p].push(codeLower);
      });
    }
  }
}

// Add panel entries to lookup
for (const [pCode, pDesc] of Object.entries(panelDescriptions)) {
  const label = `${pDesc} (Panel)`;
  orgLookup[pCode] = label;
  orgLookup[pCode.toLowerCase()] = label;
}

// ── 3. Antibiotics lookup ──
const abxRaw = fs.readFileSync(path.join(srcDir, 'Antibiotics.txt'), 'utf8').trim().split('\n');
const abxLookup = {};
for (let i = 1; i < abxRaw.length; i++) {
  const parts = abxRaw[i].split('\t');
  const code = parts[0]?.trim();
  const name = parts[6]?.trim();
  if (code && name && !abxLookup[code]) {
    abxLookup[code] = name;
  }
}

// ── 4. Expert Rules ──
const expRaw = fs.readFileSync(path.join(srcDir, 'ExpertInterpretationRules.txt'), 'utf8').trim().split('\n');
const expertRules = [];
for (let i = 1; i < expRaw.length; i++) {
  const c = expRaw[i].split('\t');
  const orgCode = c[2]?.trim() || '';
  const orgName = orgLookup[orgCode] || orgLookup[orgCode.toLowerCase()] || orgCode;
  expertRules.push({
    ruleCode: c[0]?.trim() || '',
    description: c[1]?.trim() || '',
    organismCode: orgCode,
    organismName: orgName,
    criteria: c[4]?.trim() || '',
    affectedAntibiotics: c[5]?.trim() || '',
    exceptions: c[6]?.trim() || ''
  });
}

// ── 5. Intrinsic Resistance Rules ──
const intRaw = fs.readFileSync(path.join(srcDir, 'ExpectedResistancePhenotypes.txt'), 'utf8').trim().split('\n');
const intrinsicRules = [];
for (let i = 1; i < intRaw.length; i++) {
  const c = intRaw[i].split('\t');
  const orgCode = c[2]?.trim() || '';
  const orgName = orgLookup[orgCode] || orgLookup[orgCode.toLowerCase()] || orgCode;
  const abxCode = c[6]?.trim() || '';
  intrinsicRules.push({
    guideline: c[0]?.trim() || '',
    organismCode: orgCode,
    organismName: orgName,
    abxCode: abxCode,
    abxName: abxLookup[abxCode] || abxCode,
    exceptions: c[8]?.trim() || '',
    comments: c[11]?.trim() || ''
  });
}

// ── 6. Breakpoints with Full Taxonomic Scope ──
const bpRaw = fs.readFileSync(path.join(srcDir, 'Breakpoints.txt'), 'utf8').trim().split('\n');
const breakpoints = [];
const yearsSet = new Set();
for (let i = 1; i < bpRaw.length; i++) {
  const c = bpRaw[i].split('\t');
  const yr = parseInt(c[1], 10) || 0;
  if (yr) yearsSet.add(yr);
  breakpoints.push([
    c[0]?.trim() || '',       // 0: Guidelines
    yr,                       // 1: Year
    c[2]?.trim() || '',       // 2: TestMethod
    c[3]?.trim() || '',       // 3: Potency
    c[4]?.trim() || '',       // 4: OrganismCode (e.g. EBC, eco, STA, sau)
    c[5]?.trim() || '',       // 5: OrganismCodeType (e.g. FAMILY_CODE, WHONET_ORG_CODE, GENUS_CODE)
    c[6]?.trim() || '',       // 6: BreakpointType
    c[8]?.trim() || '',       // 7: SiteOfInfection
    c[9]?.trim() || '',       // 8: ReferenceTable (e.g. Enterobacteriaceae, Table 2A)
    c[11]?.trim() || '',      // 9: AbxCode
    c[12]?.trim() || '',      // 10: WhonetTest
    parseFloat(c[13]) || 0,   // 11: R
    c[14]?.trim() || '',      // 12: I
    c[15]?.trim() || '',      // 13: SDD
    parseFloat(c[16]) || 0,   // 14: S
    parseFloat(c[17]) || 0,   // 15: EcvEcoff
    (c[21] || '').trim()      // 16: Comments
  ]);
}

const sortedYears = Array.from(yearsSet).sort((a,b) => b-a);

// Curated list of clinical panels
const clinicalPanels = [
  { code: 'EBC', name: 'Enterobacterales (Family Panel)', isPanel: true },
  { code: 'STA', name: 'Staphylococcus sp. (Genus Panel)', isPanel: true },
  { code: 'ENT', name: 'Enterococcus sp. (Genus Panel)', isPanel: true },
  { code: 'STR', name: 'Streptococcus sp. (Genus Panel)', isPanel: true },
  { code: 'PSE', name: 'Pseudomonas sp. (Genus Panel)', isPanel: true },
  { code: 'AC-', name: 'Acinetobacter sp. (Genus Panel)', isPanel: true },
  { code: 'HA-', name: 'Haemophilus sp. (Genus Panel)', isPanel: true },
  { code: 'NE-', name: 'Neisseria sp. (Genus Panel)', isPanel: true },
  { code: 'NFR', name: 'Other non-Enterobacterales (Panel)', isPanel: true },
  { code: 'BCS', name: 'Burkholderia cepacia complex (Panel)', isPanel: true },
  { code: 'SCN', name: 'Coagulase-negative staphylococci (Panel)', isPanel: true },
  { code: 'SVI', name: 'Viridans group streptococci (Panel)', isPanel: true },
  { code: 'ANA', name: 'Anaerobic bacteria (Panel)', isPanel: true }
];

// Extract all clinical organisms for dropdown
const bpOrgsSet = new Set(breakpoints.map(b => b[4].toLowerCase()));
const clinicalOrganismsMap = new Map();
for (let i = 1; i < orgRaw.length; i++) {
  const parts = orgRaw[i].split('\t');
  const code = parts[0]?.trim();
  const name = parts[2]?.trim();
  const common = parts[4]?.trim() === 'X';
  const codeLower = code?.toLowerCase();
  if (code && (common || bpOrgsSet.has(codeLower)) && !panelDescriptions[code.toUpperCase()]) {
    if (!clinicalOrganismsMap.has(codeLower)) {
      clinicalOrganismsMap.set(codeLower, { code, name: name || code, isPanel: false });
    }
  }
}
const clinicalOrganisms = Array.from(clinicalOrganismsMap.values()).sort((a,b) => a.name.localeCompare(b.name));

// Curated list of popular clinical panels and organisms for dropdown
const popularOrganisms = [
  { code: 'EBC', name: 'Enterobacterales (Family Panel)', isPanel: true },
  { code: 'eco', name: 'Escherichia coli (Panel + Species)', isPanel: false },
  { code: 'kpn', name: 'Klebsiella pneumoniae (Panel + Species)', isPanel: false },
  { code: 'ecl', name: 'Enterobacter cloacae (Panel + Species)', isPanel: false },
  { code: 'smar', name: 'Serratia marcescens (Panel + Species)', isPanel: false },
  { code: 'pmi', name: 'Proteus mirabilis (Panel + Species)', isPanel: false },
  { code: 'cfr', name: 'Citrobacter freundii (Panel + Species)', isPanel: false },
  { code: 'sal', name: 'Salmonella sp. (Panel + Species)', isPanel: false },
  { code: 'shi', name: 'Shigella sp. (Panel + Species)', isPanel: false },
  { code: 'STA', name: 'Staphylococci (Genus Panel)', isPanel: true },
  { code: 'sau', name: 'Staphylococcus aureus (Panel + Species)', isPanel: false },
  { code: 'sep', name: 'Staphylococcus epidermidis (Panel + Species)', isPanel: false },
  { code: 'ENT', name: 'Enterococci (Genus Panel)', isPanel: true },
  { code: 'efa', name: 'Enterococcus faecalis (Panel + Species)', isPanel: false },
  { code: 'efm', name: 'Enterococcus faecium (Panel + Species)', isPanel: false },
  { code: 'PSE', name: 'Pseudomonas sp. (Genus Panel)', isPanel: true },
  { code: 'pae', name: 'Pseudomonas aeruginosa (Panel + Species)', isPanel: false },
  { code: 'AC-', name: 'Acinetobacter sp. (Genus Panel)', isPanel: true },
  { code: 'aba', name: 'Acinetobacter baumannii (Panel + Species)', isPanel: false },
  { code: 'STR', name: 'Streptococci (Genus Panel)', isPanel: true },
  { code: 'spn', name: 'Streptococcus pneumoniae (Panel + Species)', isPanel: false },
  { code: 'spy', name: 'Streptococcus pyogenes (Panel + Species)', isPanel: false },
  { code: 'HA-', name: 'Haemophilus sp. (Genus Panel)', isPanel: true },
  { code: 'hin', name: 'Haemophilus influenzae (Panel + Species)', isPanel: false },
  { code: 'ANA', name: 'Anaerobic Bacteria (Panel)', isPanel: true },
  { code: 'BCS', name: 'Burkholderia cepacia complex (Panel)', isPanel: true },
  { code: 'SCN', name: 'CoNS - Coagulase-Negative Staphs (Panel)', isPanel: true },
  { code: 'SVI', name: 'Viridans Group Streptococci (Panel)', isPanel: true },
  { code: 'NFR', name: 'Other Non-Enterobacterales (Panel)', isPanel: true }
];

const metadata = {
  years: sortedYears,
  defaultYear: 2026,
  guidelines: ['CLSI', 'EUCAST', 'SFM'],
  testMethods: ['Disk', 'MIC'],
  breakpointTypes: ['Human', 'Animal', 'ECOFF'],
  popularOrganisms,
  clinicalPanels,
  clinicalOrganisms,
  panelDescriptions,
  memberToPanels,
  organisms: orgLookup,
  antibiotics: abxLookup
};

fs.writeFileSync(path.join(outDir, 'metadata.json'), JSON.stringify(metadata));
fs.writeFileSync(path.join(outDir, 'expert-rules.json'), JSON.stringify(expertRules));
fs.writeFileSync(path.join(outDir, 'intrinsic-rules.json'), JSON.stringify(intrinsicRules));
fs.writeFileSync(path.join(outDir, 'breakpoints.json'), JSON.stringify(breakpoints));

console.log('Successfully generated JSON resources in public/resources:');
console.log(' - metadata.json:', (fs.statSync(path.join(outDir, 'metadata.json')).size / 1024).toFixed(1), 'KB');
console.log(' - expert-rules.json:', expertRules.length, 'rules');
console.log(' - intrinsic-rules.json:', intrinsicRules.length, 'rules');
console.log(' - breakpoints.json:', breakpoints.length, 'rows,', (fs.statSync(path.join(outDir, 'breakpoints.json')).size / 1024 / 1024).toFixed(2), 'MB');
