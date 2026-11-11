import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TAXON_PARENT_GROUPS,
  interpretAstValue,
  deduplicateFirstIsolates,
  calculateCumulativeAntibiogram,
  calculateAmrTrends
} from '../src/js/utils/antibiogram-engine.js';

test('TAXON_PARENT_GROUPS maps Providencia stuartii (pst) to Enterobacterales without Pseudomonas overwrite', () => {
  assert.deepEqual(TAXON_PARENT_GROUPS.pst, ['ebc']);
  assert.deepEqual(TAXON_PARENT_GROUPS.psz, ['psd']);
  assert.deepEqual(TAXON_PARENT_GROUPS['ps-'], ['psd']);
});

test('interpretAstValue interprets potency-suffixed E-test MIC columns (_NE32, _EE16) using MIC logic and uppercases test code', () => {
  const labConfig = {
    speciesBreakpoints: {
      CIP_NE10: {
        eco: { s: 0.25, r: 1, guideline: 'CLSI', year: '2026', testType: 'mic' }
      },
      CIP_EE16: {
        eco: { s: 0.25, r: 1, guideline: 'EUCAST', year: '2026', testType: 'mic' }
      },
      CIP_ND5: {
        eco: { s: 26, r: 21, guideline: 'CLSI', year: '2026', testType: 'disk' }
      }
    }
  };

  // MIC <= 0.25 is S, >= 1 is R, intermediate between
  assert.equal(interpretAstValue('eco', 'CIP_NE10', '0.125', labConfig), 'S');
  assert.equal(interpretAstValue('eco', 'CIP_NE10', '0.5', labConfig), 'I');
  assert.equal(interpretAstValue('eco', 'CIP_NE10', '2', labConfig), 'R');

  // _EE16 potency-suffixed E-test also uses MIC logic
  assert.equal(interpretAstValue('eco', 'CIP_EE16', '0.25', labConfig), 'S');
  assert.equal(interpretAstValue('eco', 'CIP_EE16', '4', labConfig), 'R');

  // Lowercase intrinsic resistance column name still matches uppercase intrinsic map
  // P. aeruginosa ('pae') is intrinsically resistant to Ampicillin ('AMP')
  assert.equal(interpretAstValue('pae', 'amp_nm', '0.5', labConfig), 'R');

  // Disk diffusion remains zone >= s => S
  assert.equal(interpretAstValue('eco', 'CIP_ND5', '28', labConfig), 'S');
  assert.equal(interpretAstValue('eco', 'CIP_ND5', '18', labConfig), 'R');
});

test('deduplicateFirstIsolates preserves non-AST fallback in patient_first_ast and keeps anonymous isolates in patient_first', () => {
  const isolates = [
    // Patient 1: only isolate WITHOUT AST -> fallbackMap must preserve it in patient_first_ast
    { ROW_IDX: 1, PATIENT_ID: 'P1', ORGANISM: 'eco', SPEC_DATE: '2025-01-01' },
    // Patient 2: day 1 without AST, day 2 with AST -> patient_first_ast picks day 2
    { ROW_IDX: 2, PATIENT_ID: 'P2', ORGANISM: 'eco', SPEC_DATE: '2025-01-01' },
    { ROW_IDX: 3, PATIENT_ID: 'P2', ORGANISM: 'eco', SPEC_DATE: '2025-01-02', AMP_ND10: '20' },
    // Anonymous isolate WITH AST -> kept consistently in patient_first
    { ROW_IDX: 4, PATIENT_ID: '', ORGANISM: 'eco', SPEC_DATE: '2025-01-03', AMP_ND10: '18' }
  ];

  const firstAst = deduplicateFirstIsolates(isolates, { mode: 'patient_first_ast' });
  assert.deepEqual(
    firstAst.map(r => r.ROW_IDX).sort((a, b) => a - b),
    [1, 3, 4]
  );

  const firstAll = deduplicateFirstIsolates(isolates, { mode: 'patient_first' });
  assert.deepEqual(
    firstAll.map(r => r.ROW_IDX).sort((a, b) => a - b),
    [3, 4]
  );
});

test('calculateAmrTrends & calculateCumulativeAntibiogram track per-indicator byLoc accurately without cross-contamination', () => {
  const isolates = [
    // ICU MRSA (resistant FOX)
    { ROW_IDX: 1, ORGANISM: 'sau', SPEC_DATE: '2025-05-02', WARD: 'ICU-1', WARD_TYPE: 'icu', FOX_ND30: '15' },
    // ICU ESBL E. coli (susceptible CRO -> NOT resistant)
    { ROW_IDX: 2, ORGANISM: 'eco', SPEC_DATE: '2025-05-03', WARD: 'ICU-1', WARD_TYPE: 'icu', CRO_NM: '0.5' },
    // Outpatient ESBL E. coli (resistant CRO -> ESBL R = 100% in outpatient)
    { ROW_IDX: 3, ORGANISM: 'eco', SPEC_DATE: '2025-05-05', WARD: 'OPD', WARD_TYPE: 'out', CRO_NM: '32' },
    // Inpatient VRE E. faecium (resistant VAN)
    { ROW_IDX: 4, ORGANISM: 'efm', SPEC_DATE: '2025-05-08', WARD: 'Ward-A', WARD_TYPE: 'in', VAN_NM: '32' }
  ];

  const labConfig = {
    speciesBreakpoints: {
      FOX_ND30: { sau: { s: 22, r: 21, testType: 'disk' } },
      CRO_NM: { eco: { s: 1, r: 4, testType: 'mic' } },
      VAN_NM: { efm: { s: 4, r: 32, testType: 'mic' } }
    }
  };

  const report = calculateCumulativeAntibiogram(isolates, { minIsolates: 1, customLabConfig: labConfig });
  const may = report.trends.monthly[0];
  assert.equal(may.month, '2025-05');

  // MRSA ICU: 1/1 R = 100%, Outpatient: 0/0 = null
  assert.equal(may.mrsa.byLoc.icu.total, 1);
  assert.equal(may.mrsa.byLoc.icu.pctR, 100);
  assert.equal(may.mrsa.byLoc.outpatient.total, 0);

  // ESBL ICU: 1 isolate Susceptible => 0% R (previously wrongly got MRSA's 100% R!)
  assert.equal(may.esbl.byLoc.icu.total, 1);
  assert.equal(may.esbl.byLoc.icu.pctR, 0);
  assert.equal(may.esbl.byLoc.icu.pctS, 100);
  assert.equal(may.esbl.byLoc.outpatient.total, 1);
  assert.equal(may.esbl.byLoc.outpatient.pctR, 100);

  // VRE Inpatient: 1/1 R = 100%, ICU: 0
  assert.equal(may.vre.byLoc.inpatient.total, 1);
  assert.equal(may.vre.byLoc.inpatient.pctR, 100);
  assert.equal(may.vre.byLoc.icu.total, 0);

  // Custom bug-drug pair also tracks byLoc accurately
  assert.equal(may.pairs['eco:CRO'].byLoc.icu.pctS, 100);
  assert.equal(may.pairs['eco:CRO'].byLoc.outpatient.pctR, 100);

  // Standalone calculateAmrTrends produces matching output
  const standaloneTrends = calculateAmrTrends(isolates, { customLabConfig: labConfig });
  assert.deepEqual(standaloneTrends.monthly[0].esbl, may.esbl);
});
