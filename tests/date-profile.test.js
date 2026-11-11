import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  analyzeDateProfile,
  suggestSurveillancePeriods,
  resolveSurveillancePeriod,
  buildBadDatesInspectSql,
} from '../src/js/utils/date-profile.js';
import {
  buildDateProfileQueries,
  buildAntibiogramDateExclusionQuery,
} from '../src/js/db/query-core.js';

const REF_DATE = new Date('2026-11-11T00:00:00Z');

test('clean single-year dataset recommends Annual and populates H1/H2 + Q1-Q4', () => {
  const monthRows = Array.from({ length: 12 }, (_, idx) => {
    const mo = String(idx + 1).padStart(2, '0');
    return {
      ym: `2025-${mo}`,
      count: 100,
      minDate: `2025-${mo}-01`,
      maxDate: `2025-${mo}-28`,
    };
  });

  const dp = analyzeDateProfile(
    { totalRows: 1200, missingCount: 0, malformedCount: 0, monthRows },
    REF_DATE,
  );

  assert.equal(dp.primaryYear, '2025');
  assert.equal(dp.isCleanSingleYear, true);
  assert.equal(dp.warnings.length, 0);
  assert.equal(dp.maxValidDate, '2025-12-28');

  const sp = suggestSurveillancePeriods(dp);
  assert.equal(sp.recommendedPreset, 'annual:2025');

  const keys = sp.presets.map((p) => p.key);
  assert.ok(keys.includes('all'));
  assert.ok(keys.includes('annual:2025'));
  assert.ok(keys.includes('h1:2025'));
  assert.ok(keys.includes('h2:2025'));
  assert.ok(keys.includes('q1:2025'));
  assert.ok(keys.includes('q2:2025'));
  assert.ok(keys.includes('q3:2025'));
  assert.ok(keys.includes('q4:2025'));

  const resolvedH1 = resolveSurveillancePeriod('h1:2025', dp);
  assert.deepEqual(
    { start: resolvedH1.start, end: resolvedH1.end },
    { start: '2025-01-01', end: '2025-06-30' },
  );
  const resolvedH2 = resolveSurveillancePeriod('h2:2025', dp);
  assert.deepEqual(
    { start: resolvedH2.start, end: resolvedH2.end },
    { start: '2025-07-01', end: '2025-12-31' },
  );
});

test('single-year dataset with mistyped dates and stray prior-year rows emits warnings without skewing maxValidDate', () => {
  const monthRows = [
    { ym: '2025-01', count: 120, minDate: '2025-01-02', maxDate: '2025-01-31' },
    { ym: '2025-06', count: 140, minDate: '2025-06-01', maxDate: '2025-06-30' },
    { ym: '2025-11', count: 140, minDate: '2025-11-01', maxDate: '2025-11-29' },
    { ym: '2024-12', count: 4, minDate: '2024-12-30', maxDate: '2024-12-31' },
    { ym: '2099-05', count: 1, minDate: '2099-05-01', maxDate: '2099-05-01' },
    { ym: '1900-01', count: 2, minDate: '1900-01-01', maxDate: '1900-01-01' },
  ];

  const dp = analyzeDateProfile(
    { totalRows: 412, missingCount: 3, malformedCount: 2, monthRows },
    REF_DATE,
  );

  assert.equal(dp.primaryYear, '2025');
  assert.equal(dp.maxValidDate, '2025-11-29'); // Not skewed by 2099-05-01
  assert.equal(dp.futureDateCount, 1);
  assert.equal(dp.ancientDateCount, 2);
  assert.equal(dp.hasStrayOtherYears, true);

  const codes = dp.warnings.map((w) => w.code);
  assert.ok(codes.includes('missing_or_malformed'));
  assert.ok(codes.includes('implausible_dates'));
  assert.ok(codes.includes('stray_other_years'));

  const inspectSql = buildBadDatesInspectSql(dp, ['ROW_IDX', 'SPEC_NUM', 'SPEC_DATE', 'ORGANISM']);
  assert.match(inspectSql, /SUBSTR\(TRIM\(COALESCE\(SPEC_DATE, ''\)\), 1, 4\) != '2025'/);
  assert.match(inspectSql, /> '2026-11-18'/);
});

test('half-year H1 dataset auto-suggests H1 and omits empty H2/Q3/Q4', () => {
  const monthRows = [
    { ym: '2025-01', count: 80 },
    { ym: '2025-02', count: 85 },
    { ym: '2025-03', count: 90 },
    { ym: '2025-04', count: 88 },
    { ym: '2025-05', count: 92 },
    { ym: '2025-06', count: 95 },
  ];

  const dp = analyzeDateProfile({ totalRows: 530, monthRows }, REF_DATE);
  const sp = suggestSurveillancePeriods(dp);

  assert.equal(sp.recommendedPreset, 'h1:2025');
  const keys = sp.presets.map((p) => p.key);
  assert.ok(keys.includes('h1:2025'));
  assert.ok(keys.includes('q1:2025'));
  assert.ok(keys.includes('q2:2025'));
  assert.equal(keys.includes('h2:2025'), false);
  assert.equal(keys.includes('q3:2025'), false);
  assert.equal(keys.includes('q4:2025'), false);
});

test('single-quarter dataset auto-suggests matching quarter preset', () => {
  const monthRows = [
    { ym: '2025-07', count: 60 },
    { ym: '2025-08', count: 65 },
    { ym: '2025-09', count: 70 },
  ];

  const dp = analyzeDateProfile({ totalRows: 195, monthRows }, REF_DATE);
  const sp = suggestSurveillancePeriods(dp);

  assert.equal(sp.recommendedPreset, 'q3:2025');
});

test('multi-year file flags info notice and generates separate per-year presets', () => {
  const monthRows = [
    { ym: '2025-02', count: 220 },
    { ym: '2025-08', count: 240 },
    { ym: '2024-03', count: 200 },
    { ym: '2024-09', count: 210 },
  ];

  const dp = analyzeDateProfile({ totalRows: 870, monthRows }, REF_DATE);
  assert.equal(dp.isMultiYearFile, true);
  assert.equal(dp.warnings.some((w) => w.code === 'multi_year_file' && w.severity === 'info'), true);

  const sp = suggestSurveillancePeriods(dp);
  const keys = sp.presets.map((p) => p.key);
  assert.ok(keys.includes('annual:2025'));
  assert.ok(keys.includes('annual:2024'));
});

test('buildDateProfileQueries & buildAntibiogramDateExclusionQuery execute cleanly in SQLite', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE Isolates (
      ROW_IDX INTEGER PRIMARY KEY,
      SPEC_NUM TEXT,
      SPEC_DATE TEXT,
      ORGANISM TEXT
    );
    INSERT INTO Isolates (ROW_IDX, SPEC_NUM, SPEC_DATE, ORGANISM) VALUES
      (1, 'S1', '2025-01-15', 'eco'),
      (2, 'S2', '2025-08-20', 'kpn'),
      (3, 'S3', '2025-02-30', 'sau'), -- invalid calendar day
      (4, 'S4', '', 'pae'),           -- missing date
      (5, 'S5', '2099-05-01', 'efa'), -- future typo
      (6, 'S6', '2024-12-31', 'eco'); -- prior year stray
  `);

  const cols = db.prepare('PRAGMA table_info(Isolates)').all().map((c) => c.name);
  const q = buildDateProfileQueries(cols, REF_DATE);

  const audit = db.prepare(q.auditSql).get();
  const monthRows = db.prepare(q.monthCountsSql).all();
  const anomalySamples = db.prepare(q.anomalySamplesSql).all(...q.anomalyParams);

  const dp = analyzeDateProfile(
    {
      totalRows: audit.totalRows,
      missingCount: audit.missingCount,
      malformedCount: audit.malformedCount,
      monthRows,
      anomalySamples,
    },
    REF_DATE,
  );

  assert.equal(dp.totalRows, 6);
  assert.equal(dp.missingCount, 1);
  assert.equal(dp.malformedCount, 1);
  assert.equal(dp.futureDateCount, 1);
  assert.equal(dp.primaryYear, '2025');
  assert.ok(dp.anomalySamples.length >= 2);

  // Verify date exclusion telemetry when scoped to 2025
  const exclQ = buildAntibiogramDateExclusionQuery({
    cols,
    nonDateWhereClause: "WHERE LOWER(COALESCE(ORGANISM, '')) NOT LIKE 'x%' AND COALESCE(ORGANISM, '') != ''",
    nonDateParams: [],
    startDate: '2025-01-01',
    endDate: '2025-12-31',
  });
  const exclRow = db.prepare(exclQ.sql).get(...exclQ.params);
  assert.equal(exclRow.excludedUndated, 2); // empty + 2025-02-30
  assert.equal(exclRow.excludedOutsideRange, 2); // 2099-05-01 + 2024-12-31

  // Verify Inspect Bad Dates SQL executes cleanly against the same table
  // Rows 3 (2025-02-30), 4 (blank), and 5 (2099-05-01) are invalid/future;
  // Row 6 (2024-12-31) is 33% of plausible rows so treated as a second year rather than stray noise.
  const inspectSql = buildBadDatesInspectSql(dp, cols);
  const badRows = db.prepare(inspectSql).all();
  assert.deepEqual(badRows.map((r) => r.ROW_IDX), [5, 4, 3]);

  db.close();
});
