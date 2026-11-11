import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';

function invokeHandler(handleRequest, { method = 'GET', url = '/', headers = {}, body = null }) {
  return new Promise((resolve) => {
    const chunks = body === null
      ? []
      : [Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))];
    const req = Readable.from(chunks);
    req.method = method;
    req.url = url;
    req.headers = Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
    );

    const outChunks = [];
    let statusCode = 200;
    let resHeaders = {};
    const res = {
      headersSent: false,
      writeHead(status, hdrs = {}) {
        statusCode = status;
        resHeaders = Object.fromEntries(
          Object.entries(hdrs).map(([k, v]) => [k.toLowerCase(), v])
        );
        this.headersSent = true;
      },
      write(chunk) {
        outChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      },
      end(chunk) {
        if (chunk !== undefined && chunk !== null) {
          outChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        }
        const buf = Buffer.concat(outChunks);
        resolve({
          status: statusCode,
          headers: resHeaders,
          body: buf,
          text: () => buf.toString('utf8'),
          json: () => JSON.parse(buf.toString('utf8'))
        });
      }
    };

    handleRequest(req, res);
  });
}

test('server security, binary upload fidelity, row_idx === 0 update, and custom-sql limits', async (t) => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'whonet-srv-test-'));
  const tempData = join(tempRoot, 'Data');
  mkdirSync(tempData, { recursive: true });

  process.env.WHONET_DIR = tempData;
  process.env.WHONET_ROOT = tempRoot;
  process.env.WHONET_NO_WATCH = '1';
  process.env.WHONET_NO_BROWSER = '1';

  const { handleRequest } = await import('../server.js');
  t.after(async () => {
    // Release any active SQLite handle in server.js before deleting tempRoot on Windows
    await invokeHandler(handleRequest, { method: 'POST', url: '/api/close-database' });
    rmSync(tempRoot, { recursive: true, force: true });
  });

  // 1. CORS lockdown blocks untrusted third-party origins, allows localhost
  const evilPreflight = await invokeHandler(handleRequest, {
    method: 'OPTIONS',
    url: '/api/databases',
    headers: { origin: 'https://evil.example' }
  });
  assert.equal(evilPreflight.status, 403);

  const evilGet = await invokeHandler(handleRequest, {
    method: 'GET',
    url: '/api/databases',
    headers: { origin: 'https://evil.example' }
  });
  assert.equal(evilGet.status, 403);

  const localGet = await invokeHandler(handleRequest, {
    method: 'GET',
    url: '/api/databases',
    headers: { origin: 'http://localhost:7890' }
  });
  assert.equal(localGet.status, 200);
  assert.equal(localGet.headers['access-control-allow-origin'], 'http://localhost:7890');

  // 2. Static path containment blocks directory traversal & server.js exposure
  const leakRes = await invokeHandler(handleRequest, { method: 'GET', url: '/server.js' });
  assert.equal(leakRes.status, 404);
  const traversalRes = await invokeHandler(handleRequest, { method: 'GET', url: '/../package.json' });
  assert.equal(traversalRes.status, 404);
  const rootRes = await invokeHandler(handleRequest, { method: 'GET', url: '/' });
  assert.equal(rootRes.status, 200);
  assert.match(rootRes.headers['content-type'] || '', /text\/html/);

  // Deduplicated static assets resolve cleanly from public/ in Node server mode
  for (const staticUrl of [
    '/manifest.json',
    '/organisms.js',
    '/specimens.js',
    '/chart.umd.min.js',
    '/vendor/sql-wasm.wasm',
    '/sample-data/WHO-TST-2020-01.sqlite',
  ]) {
    const assetRes = await invokeHandler(handleRequest, { method: 'GET', url: staticUrl });
    assert.equal(assetRes.status, 200, `Expected 200 for ${staticUrl}`);
  }

  // 3. Create real binary SQLite fixture with ROW_IDX=0, standard normalized columns,
  //    and raw non-UTF-8 bytes in a BLOB column so UTF-8 string decoding would corrupt it.
  const fixturePath = join(tempRoot, 'fixture.sqlite');
  const db = new DatabaseSync(fixturePath);
  db.exec(`
    CREATE TABLE Isolates (
      ROW_IDX INTEGER PRIMARY KEY,
      PATIENT_ID TEXT,
      SPEC_NUM TEXT,
      FULL_NAME TEXT,
      SPEC_DATE TEXT,
      SPEC_TYPE TEXT,
      ORGANISM TEXT,
      WARD TEXT,
      DEPARTMENT TEXT,
      WARD_TYPE TEXT,
      RAW_BIN BLOB
    );
  `);
  const invalidUtf8Blob = Buffer.from([0x80, 0x9f, 0xfe, 0xff, 0x00, 0xc3, 0x28]);
  db.prepare('INSERT INTO Isolates VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(0, 'P1', 'sp001', 'Alice', '2025-05-10', 'bl', 'eco', 'ICU', 'Med', 'icu', invalidUtf8Blob);
  db.prepare('INSERT INTO Isolates VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(1, 'P2', 'SP001', 'Bob', '2025-05-11', 'ur', 'eco', 'OPD', 'Out', 'out', invalidUtf8Blob);
  db.close();

  const rawBytes = readFileSync(fixturePath);
  const uploadRes = await invokeHandler(handleRequest, {
    method: 'POST',
    url: '/api/upload-database?filename=test%20fixture.sqlite',
    body: rawBytes
  });
  const uploadData = uploadRes.json();
  assert.equal(uploadData.ok, true);
  assert.equal(uploadData.filename, 'test fixture.sqlite');
  assert.equal(uploadData.count, 2);

  // Verify exact byte-for-byte binary write without UTF-8 corruption
  const savedBytes = readFileSync(join(tempData, 'test fixture.sqlite'));
  assert.equal(Buffer.compare(rawBytes, savedBytes), 0);

  // 4. Reject arbitrary customPath loading in /api/open-database
  const customPathRes = await invokeHandler(handleRequest, {
    method: 'POST',
    url: '/api/open-database',
    body: { path: fixturePath }
  });
  assert.equal(customPathRes.status, 403);

  // 5. row_idx === 0 update succeeds & missing optional columns are safely ignored
  const updRes = await invokeHandler(handleRequest, {
    method: 'POST',
    url: '/api/update-row',
    body: { row_idx: 0, fields: { SPEC_NUM: 'SP-ZERO', COMMENT: 'nonexistent-col' } }
  });
  const updJson = updRes.json();
  assert.equal(updJson.ok, true);
  assert.equal(updJson.changes, 1);

  // 6. /api/duplicates exposes hasMixedCaseSpecNum cleanly
  const dupRes = await invokeHandler(handleRequest, {
    method: 'GET',
    url: '/api/duplicates?mode=spec'
  });
  const dupJson = dupRes.json();
  assert.equal(typeof dupJson.hasMixedCaseSpecNum, 'boolean');

  // 7. /api/custom-sql handles leading comments and rejects multi-statement SQL
  const sqlCommentRes = await invokeHandler(handleRequest, {
    method: 'POST',
    url: '/api/custom-sql',
    body: { sql: '-- diagnostic\n/* c */ SELECT SPEC_NUM FROM Isolates WHERE ROW_IDX = 0' }
  });
  const sqlCommentJson = sqlCommentRes.json();
  assert.equal(sqlCommentJson.type, 'select');
  assert.equal(sqlCommentJson.rows[0].SPEC_NUM, 'SP-ZERO');

  const multiSqlRes = await invokeHandler(handleRequest, {
    method: 'POST',
    url: '/api/custom-sql',
    body: { sql: 'SELECT 1; DELETE FROM Isolates' }
  });
  assert.equal(multiSqlRes.status, 400);
});
