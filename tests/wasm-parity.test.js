import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import initSqlJs from 'sql.js';
import { naturalKey } from '../src/js/utils/natural-sort.js';
import {
  buildIsolatesQuery,
  buildDuplicatesQuery,
  buildChartDataQuery,
  buildUpdateRowQuery
} from '../src/js/db/query-core.js';

function createNodeFixture() {
  const db = new DatabaseSync(':memory:');
  db.function('NATURAL_KEY', { deterministic: true }, (v) => naturalKey(v));
  db.exec(`
    CREATE TABLE Isolates (
      ROW_IDX INTEGER PRIMARY KEY,
      PATIENT_ID TEXT,
      SPEC_NUM TEXT,
      SPEC_DATE TEXT,
      SPEC_TYPE TEXT,
      ORGANISM TEXT,
      FULL_NAME TEXT,
      SEX TEXT,
      AGE TEXT,
      WARD TEXT,
      DEPARTMENT TEXT
    );
  `);
  const rows = [
    [0, 'P1', 'S2', '2025-04-01', 'bl', 'eco', 'Alice', 'f', '30', 'ICU', 'Med'],
    [1, 'P1', 's10', '2025-04-02', 'ur', 'eco', 'Alice', 'f', '30', 'ICU', 'Med'],
    [2, 'P2', 'S2', '2025-04-03', 'sp', 'kpn', 'Bob', 'm', '55', 'OPD', 'Pulm'],
    [3, 'P3', 'S1', '2025-04-04', 'bl', 'sau', 'Cara', 'f', '70', 'Ward-1', 'Surg']
  ];
  const stmt = db.prepare(
    'INSERT INTO Isolates VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  for (const r of rows) stmt.run(...r);
  return db;
}

async function createWasmFixture(nodeDb) {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.create_function('NATURAL_KEY', (v) => naturalKey(v));
  db.run(`
    CREATE TABLE Isolates (
      ROW_IDX INTEGER PRIMARY KEY,
      PATIENT_ID TEXT,
      SPEC_NUM TEXT,
      SPEC_DATE TEXT,
      SPEC_TYPE TEXT,
      ORGANISM TEXT,
      FULL_NAME TEXT,
      SEX TEXT,
      AGE TEXT,
      WARD TEXT,
      DEPARTMENT TEXT
    );
  `);
  const rows = nodeDb.prepare('SELECT * FROM Isolates').all();
  for (const r of rows) {
    db.run(
      'INSERT INTO Isolates VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [r.ROW_IDX, r.PATIENT_ID, r.SPEC_NUM, r.SPEC_DATE, r.SPEC_TYPE, r.ORGANISM, r.FULL_NAME, r.SEX, r.AGE, r.WARD, r.DEPARTMENT]
    );
  }
  return db;
}

function wasmExecObjects(db, sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    if (params.length) stmt.bind(params);
    const out = [];
    while (stmt.step()) {
      out.push(stmt.getAsObject());
    }
    return out;
  } finally {
    stmt.free();
  }
}

test('Node SQLite and sql.js WASM produce identical results across shared query-core queries', async (t) => {
  const nodeDb = createNodeFixture();
  const wasmDb = await createWasmFixture(nodeDb);
  t.after(() => {
    nodeDb.close();
    wasmDb.close();
  });

  const cols = nodeDb.prepare('PRAGMA table_info(Isolates)').all().map(c => c.name);

  // 1. /api/isolates natural sort parity
  const isoQ = buildIsolatesQuery({ cols, sortCol: 'SPEC_NUM', sortDir: 'ASC', page: 1, pageSize: 25 });
  const nodeIso = nodeDb.prepare(isoQ.rowsSql).all(...isoQ.params);
  const wasmIso = wasmExecObjects(wasmDb, isoQ.rowsSql, isoQ.params);
  assert.deepEqual(wasmIso.map(r => r.ROW_IDX), [3, 2, 0, 1]); // S1, S2 (2 then 0 by ROW_IDX DESC), s10
  assert.deepEqual(wasmIso.map(r => r.ROW_IDX), nodeIso.map(r => r.ROW_IDX));

  // 2. /api/duplicates parity (sorted by SPEC_TYPE DESC)
  const dupQ = buildDuplicatesQuery({ cols, mode: 'spec', sortCol: 'SPEC_TYPE', sortDir: 'DESC' });
  const nodeDup = nodeDb.prepare(dupQ.rowsSql).all(...dupQ.params);
  const wasmDup = wasmExecObjects(wasmDb, dupQ.rowsSql, dupQ.params);
  assert.deepEqual(wasmDup.map(r => r.ROW_IDX), nodeDup.map(r => r.ROW_IDX));
  assert.equal(nodeDup.length, 2);

  // 3. /api/chart-data AGE_GROUP parity
  const chartQ = buildChartDataQuery({ param: 'AGE_GROUP', period: 'all', cols });
  const nodeChart = nodeDb.prepare(chartQ.querySql).all(...chartQ.params);
  const wasmChart = wasmExecObjects(wasmDb, chartQ.querySql, chartQ.params);
  assert.deepEqual(
    wasmChart.map(r => ({ label: r.label, count: r.count })),
    nodeChart.map(r => ({ label: r.label, count: r.count }))
  );

  // 4. row_idx === 0 update parity
  const updQ = buildUpdateRowQuery({ tableCols: cols, rowIdx: 0, fields: { WARD: 'PICU' } });
  nodeDb.prepare(updQ.sql).run(...updQ.params);
  wasmDb.run(updQ.sql, updQ.params);
  const nodeWard = nodeDb.prepare('SELECT WARD FROM Isolates WHERE ROW_IDX = 0').get().WARD;
  const wasmWard = wasmExecObjects(wasmDb, 'SELECT WARD FROM Isolates WHERE ROW_IDX = 0')[0].WARD;
  assert.equal(nodeWard, 'PICU');
  assert.equal(wasmWard, 'PICU');
});
