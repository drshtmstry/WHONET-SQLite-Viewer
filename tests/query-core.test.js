import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifySqlStatement,
  buildIsolatesQuery,
  buildDuplicatesQuery,
  buildChartDataQuery,
  buildDeleteDuplicatesQuery,
  buildUpdateFieldQuery,
  buildUpdateRowQuery
} from '../src/js/db/query-core.js';

test('classifySqlStatement strips leading comments and flags multi-statement payloads', () => {
  const c1 = classifySqlStatement('-- header comment\n/* block */ SELECT * FROM Isolates');
  assert.equal(c1.leadingKeyword, 'SELECT');
  assert.equal(c1.isReadOnly, true);
  assert.equal(c1.hasMultipleStatements, false);

  const c2 = classifySqlStatement('/* read */ WITH x AS (SELECT 1) SELECT * FROM x;');
  assert.equal(c2.leadingKeyword, 'WITH');
  assert.equal(c2.isReadOnly, true);
  assert.equal(c2.hasMultipleStatements, false);

  const c3 = classifySqlStatement('PRAGMA table_info(Isolates)');
  assert.equal(c3.isReadOnly, true);

  const c4 = classifySqlStatement('PRAGMA journal_mode = WAL');
  assert.equal(c4.isReadOnly, false);

  const c5 = classifySqlStatement('SELECT 1; DELETE FROM Isolates');
  assert.equal(c5.hasMultipleStatements, true);

  const c6 = classifySqlStatement("SELECT 'a;b' AS text_col FROM Isolates;");
  assert.equal(c6.hasMultipleStatements, false);
  assert.equal(c6.isReadOnly, true);
});

test('buildChartDataQuery validates parameter whitelist strictly', () => {
  const bad = buildChartDataQuery({ param: 'ORGANISM FROM Isolates --' });
  assert.ok(bad.error);

  const good = buildChartDataQuery({ param: 'AGE_GROUP', period: 'all' });
  assert.equal(good.error, undefined);
  assert.equal(good.param, 'AGE_GROUP');
  assert.match(good.querySql, /CASE/);
});

test('buildUpdateRowQuery and buildUpdateFieldQuery allow row_idx === 0 and filter missing columns', () => {
  const tableCols = ['ROW_IDX', 'SPEC_NUM', 'ORGANISM'];

  const qZero = buildUpdateRowQuery({
    tableCols,
    rowIdx: 0,
    fields: { SPEC_NUM: 'S-100', ORGANISM: 'eco', COMMENT: 'missing-col', EVIL_COL: 'x' }
  });
  assert.equal(qZero.error, undefined);
  assert.equal(qZero.sql, 'UPDATE Isolates SET SPEC_NUM = ?, ORGANISM = ? WHERE ROW_IDX = ?');
  assert.deepEqual(qZero.params, ['S-100', 'eco', 0]);

  const qMissingField = buildUpdateFieldQuery({
    tableCols,
    rowIdx: 0,
    field: 'SEX',
    value: 'f'
  });
  assert.match(qMissingField.error, /does not exist/);

  const qDisallowed = buildUpdateFieldQuery({
    tableCols: [...tableCols, 'CIP_NM'],
    rowIdx: 1,
    field: 'CIP_NM',
    value: '0.5'
  });
  assert.equal(qDisallowed.error, 'Field not editable');
});

test('buildDeleteDuplicatesQuery uses bound parameters instead of string interpolation', () => {
  const q = buildDeleteDuplicatesQuery({
    cols: ['ROW_IDX', 'PATIENT_ID', 'SPEC_NUM'],
    patient_id: "O'Brien's ID"
  });
  assert.doesNotMatch(q.sql, /O'Brien/);
  assert.deepEqual(q.params, ["O'Brien's ID", "O'Brien's ID"]);
});

test('buildIsolatesQuery and buildDuplicatesQuery enforce safe sort columns and generate mixedCaseSql', () => {
  const isoQ = buildIsolatesQuery({
    cols: ['ROW_IDX', 'SPEC_NUM', 'ORGANISM'],
    sortCol: 'BAD_INJECTION',
    sortDir: 'ASC; DROP TABLE Isolates',
    search: 'abc'
  });
  assert.equal(isoQ.sortCol, 'ROW_IDX');
  assert.equal(isoQ.sortDir, 'DESC');
  assert.deepEqual(isoQ.params, ['%ABC%']);

  const dupQ = buildDuplicatesQuery({
    cols: ['ROW_IDX', 'SPEC_NUM', 'PATIENT_ID'],
    mode: 'spec',
    sortCol: 'SPEC_NUM',
    sortDir: 'DESC'
  });
  assert.ok(dupQ.mixedCaseSql);
  assert.match(dupQ.rowsSql, /NATURAL_KEY\(SPEC_NUM\) DESC/);
});
