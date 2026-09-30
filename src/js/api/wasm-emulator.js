/**
 * In-Browser WASM SQLite API Emulator
 * Emulates backend HTTP API endpoints directly against sql.js in-memory database
 * for 100% offline and standalone web usage.
 */
import { state } from '../state/store.js';
import { wasmSelect, wasmRun, normaliseSchema } from '../db/wasm.js';

// Single source of truth for editable fields (mirrors server.js EDITABLE_FIELDS)
const EDITABLE_FIELDS = [
  'SPEC_NUM', 'PATIENT_ID', 'SPEC_DATE', 'SPEC_TYPE', 'ORGANISM',
  'FULL_NAME', 'SEX', 'AGE', 'WARD', 'DEPARTMENT', 'INSTITUT',
  'DATE_ADMIS', 'DATE_DATA', 'COMMENT', 'ESBL', 'CARBAPENEM',
  'MRSA', 'URINECOUNT', 'SEROTYPE', 'BETA_LACT', 'INDUC_CLI'
];

const WASM_CUSTOM_SQL_ROW_LIMIT = 10000;

export function handleWasmApi(path, options = {}) {
  try {
    normaliseSchema();
    const url = new URL(path, 'http://dummy');
    const pathname = url.pathname;
    const body = options.body ? (typeof options.body === 'string' ? JSON.parse(options.body) : options.body) : {};

    if (pathname === '/api/stats') {
      const cols = wasmSelect("PRAGMA table_info(Isolates)").map(c => c.name.toUpperCase());
      const hasSpecNum = cols.includes('SPEC_NUM');
      const hasPatientId = cols.includes('PATIENT_ID');

      const total = wasmSelect('SELECT COUNT(*) as c FROM Isolates')[0]?.c || 0;
      const dupRows = hasSpecNum ? (wasmSelect(`
        SELECT COUNT(*) as c FROM Isolates WHERE SPEC_NUM IS NOT NULL AND SPEC_NUM != '' AND UPPER(SPEC_NUM) IN (
          SELECT UPPER(SPEC_NUM) FROM Isolates WHERE SPEC_NUM IS NOT NULL AND SPEC_NUM != '' GROUP BY UPPER(SPEC_NUM) HAVING COUNT(*) > 1
        )
      `)[0]?.c || 0) : 0;
      const dupGroups = hasSpecNum ? (wasmSelect(`
        SELECT COUNT(DISTINCT UPPER(SPEC_NUM)) as c FROM Isolates WHERE SPEC_NUM IS NOT NULL AND SPEC_NUM != '' GROUP BY UPPER(SPEC_NUM) HAVING COUNT(*) > 1
      `).length || 0) : 0;

      const dupPtRows = hasPatientId ? (wasmSelect(`
        SELECT COUNT(*) as c FROM Isolates WHERE PATIENT_ID IS NOT NULL AND PATIENT_ID != '' AND UPPER(PATIENT_ID) IN (
          SELECT UPPER(PATIENT_ID) FROM Isolates WHERE PATIENT_ID IS NOT NULL AND PATIENT_ID != '' GROUP BY UPPER(PATIENT_ID) HAVING COUNT(*) > 1
        )
      `)[0]?.c || 0) : 0;
      const dupPtGroups = hasPatientId ? (wasmSelect(`
        SELECT COUNT(DISTINCT UPPER(PATIENT_ID)) as c FROM Isolates WHERE PATIENT_ID IS NOT NULL AND PATIENT_ID != '' GROUP BY UPPER(PATIENT_ID) HAVING COUNT(*) > 1
      `).length || 0) : 0;

      const organisms = cols.includes('ORGANISM')
        ? wasmSelect("SELECT DISTINCT ORGANISM FROM Isolates WHERE ORGANISM IS NOT NULL AND ORGANISM != '' ORDER BY ORGANISM").map(r => r.ORGANISM)
        : [];
      const wards = cols.includes('WARD')
        ? wasmSelect("SELECT DISTINCT WARD FROM Isolates WHERE WARD IS NOT NULL AND WARD != '' ORDER BY WARD").map(r => r.WARD)
        : [];
      const months = cols.includes('SPEC_DATE')
        ? wasmSelect("SELECT DISTINCT SUBSTR(SPEC_DATE, 1, 7) as ym FROM Isolates WHERE SPEC_DATE IS NOT NULL AND LENGTH(SPEC_DATE) >= 7 AND SUBSTR(SPEC_DATE, 1, 7) GLOB '[1-2][0-9][0-9][0-9]-[0-1][0-9]' AND SUBSTR(SPEC_DATE, 6, 2) BETWEEN '01' AND '12' ORDER BY ym DESC").map(r => r.ym)
        : [];

      return { total, dupRows, dupGroups, dupPtRows, dupPtGroups, organisms, wards, months };
    }

    if (pathname === '/api/schema') {
      const tables = wasmSelect("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").map(t => t.name);
      const columns = {};
      for (const t of tables) {
        try {
          columns[t] = wasmSelect(`PRAGMA table_info("${t.replace(/"/g, '""')}")`).map(c => c.name);
        } catch (_) {
          columns[t] = [];
        }
      }
      return { tables, columns };
    }

    if (pathname === '/api/isolates') {
      const page = parseInt(url.searchParams.get('page') || '1', 10);
      const pageSize = parseInt(url.searchParams.get('pageSize') || '25', 10);
      const search = (url.searchParams.get('search') || '').trim();
      const organism = (url.searchParams.get('organism') || '').trim();
      const ward = (url.searchParams.get('ward') || '').trim();
      const month = (url.searchParams.get('month') || '').trim();
      const offset = (page - 1) * pageSize;

      const ALLOWED_ISOLATE_COLS = {
        ROW_IDX: 'ROW_IDX',
        SPEC_NUM: 'SPEC_NUM',
        SPEC_DATE: 'SPEC_DATE',
        SPEC_TYPE: 'SPEC_TYPE',
        ORGANISM: 'ORGANISM',
        FULL_NAME: 'FULL_NAME',
        SEX: 'SEX',
        AGE: 'AGE',
        WARD: 'WARD',
        DEPARTMENT: 'DEPARTMENT',
        ESBL: 'ESBL',
        CARBAPENEM: 'CARBAPENEM',
        MRSA: 'MRSA'
      };
      const rawSortCol = (url.searchParams.get('sortCol') || 'ROW_IDX').toUpperCase();
      const sortCol = ALLOWED_ISOLATE_COLS[rawSortCol] || 'ROW_IDX';
      const rawSortDir = (url.searchParams.get('sortDir') || 'DESC').toUpperCase();
      const sortDir = rawSortDir === 'ASC' ? 'ASC' : 'DESC';

      const orderClause = sortCol === 'ROW_IDX'
        ? `ORDER BY ROW_IDX ${sortDir}`
        : `ORDER BY CASE WHEN ${sortCol} IS NULL OR ${sortCol} = '' THEN 1 ELSE 0 END, NATURAL_KEY(${sortCol}) ${sortDir}, ROW_IDX DESC`;

      const cols = wasmSelect("PRAGMA table_info(Isolates)").map(c => c.name);
      const upperCols = cols.map(c => c.toUpperCase());
      const colExpr = (name, fallback = "NULL") => cols.includes(name) ? name : `${fallback} AS ${name}`;

      let whereClauses = [];
      let params = [];
      if (search) {
        const searchParts = [];
        if (upperCols.includes('SPEC_NUM')) searchParts.push('UPPER(SPEC_NUM) LIKE ?');
        if (upperCols.includes('PATIENT_ID')) searchParts.push('UPPER(PATIENT_ID) LIKE ?');
        if (upperCols.includes('FULL_NAME')) searchParts.push('UPPER(FULL_NAME) LIKE ?');
        if (searchParts.length) {
          whereClauses.push(`(${searchParts.join(' OR ')})`);
          const s = `%${search.toUpperCase()}%`;
          for (let i = 0; i < searchParts.length; i++) params.push(s);
        }
      }
      if (organism && upperCols.includes('ORGANISM')) {
        whereClauses.push("ORGANISM = ?");
        params.push(organism);
      }
      if (ward && upperCols.includes('WARD')) {
        whereClauses.push("WARD = ?");
        params.push(ward);
      }
      if (month && upperCols.includes('SPEC_DATE')) {
        whereClauses.push("SUBSTR(SPEC_DATE, 1, 7) = ?");
        params.push(month);
      }
      const whereSql = whereClauses.length ? 'WHERE ' + whereClauses.join(' AND ') : '';

      const countSql = `SELECT COUNT(*) as c FROM Isolates ${whereSql}`;
      const totalCount = wasmSelect(countSql, params)[0]?.c || 0;

      const rowsSql = `
        SELECT ${colExpr('ROW_IDX', 'rowid')},
               ${colExpr('PATIENT_ID', "''")},
               ${colExpr('SPEC_NUM', "''")},
               ${colExpr('SPEC_DATE', "''")},
               ${colExpr('SPEC_TYPE', "''")},
               ${colExpr('ORGANISM', "''")},
               ${colExpr('FULL_NAME', "''")},
               ${colExpr('SEX', "''")},
               ${colExpr('AGE', "''")},
               ${colExpr('WARD', "''")},
               ${colExpr('DEPARTMENT', "''")},
               ${colExpr('ESBL')},
               ${colExpr('CARBAPENEM')},
               ${colExpr('MRSA')}
        FROM Isolates
        ${whereSql}
        ${orderClause}
        LIMIT ${pageSize} OFFSET ${offset}
      `;
      const rows = wasmSelect(rowsSql, params);
      return { rows, totalCount, page, pageSize, sortCol, sortDir };
    }

    if (pathname === '/api/duplicates') {
      const page = parseInt(url.searchParams.get('page') || '1', 10);
      const pageSize = parseInt(url.searchParams.get('pageSize') || '50', 10);
      const mode = (url.searchParams.get('mode') || 'spec').toLowerCase();
      const search = (url.searchParams.get('search') || '').trim();
      const offset = (page - 1) * pageSize;

      const dupCols = wasmSelect("PRAGMA table_info(Isolates)").map(c => c.name);
      const upperCols = dupCols.map(c => c.toUpperCase());
      const hasSpecNum = upperCols.includes('SPEC_NUM');
      const hasPatientId = upperCols.includes('PATIENT_ID');
      const hasFullName = upperCols.includes('FULL_NAME');
      const hasRowIdx = upperCols.includes('ROW_IDX');
      const rowIdxExpr = hasRowIdx ? 'ROW_IDX' : 'rowid';

      const groupCol = mode === 'patient'
        ? (hasPatientId ? 'UPPER(PATIENT_ID)' : "''")
        : (hasSpecNum ? 'UPPER(SPEC_NUM)' : "''");
      const notEmptyCond = mode === 'patient'
        ? (hasPatientId ? "PATIENT_ID IS NOT NULL AND PATIENT_ID != ''" : "0")
        : (hasSpecNum ? "SPEC_NUM IS NOT NULL AND SPEC_NUM != ''" : "0");

      let searchCond = '';
      let params = [];
      if (search) {
        if (hasFullName) {
          searchCond = `AND (${groupCol} LIKE ? OR UPPER(FULL_NAME) LIKE ?)`;
          params.push(`%${search.toUpperCase()}%`, `%${search.toUpperCase()}%`);
        } else {
          searchCond = `AND (${groupCol} LIKE ?)`;
          params.push(`%${search.toUpperCase()}%`);
        }
      }

      const ALLOWED_DUP_COLS = {
        ROW_IDX: rowIdxExpr,
        MATCHED: groupCol,
        OTHER: mode === 'patient'
          ? (hasSpecNum ? 'UPPER(SPEC_NUM)' : "''")
          : (hasPatientId ? 'UPPER(PATIENT_ID)' : "''"),
        SPEC_NUM: hasSpecNum ? 'SPEC_NUM' : "''",
        PATIENT_ID: hasPatientId ? 'PATIENT_ID' : "''",
        FULL_NAME: hasFullName ? 'FULL_NAME' : "''",
        SPEC_DATE: upperCols.includes('SPEC_DATE') ? 'SPEC_DATE' : "''",
        SPEC_TYPE: upperCols.includes('SPEC_TYPE') ? 'SPEC_TYPE' : "''",
        ORGANISM: upperCols.includes('ORGANISM') ? 'ORGANISM' : "''",
        SEX: upperCols.includes('SEX') ? 'SEX' : "''",
        AGE: upperCols.includes('AGE') ? 'AGE' : "''",
        WARD: upperCols.includes('WARD') ? 'WARD' : "''"
      };
      const rawDupSort = url.searchParams.get('sortCol')?.toUpperCase();
      const dupSortExpr = ALLOWED_DUP_COLS[rawDupSort] || null;
      const rawDupDir = (url.searchParams.get('sortDir') || 'ASC').toUpperCase();
      const dupSortDir = rawDupDir === 'DESC' ? 'DESC' : 'ASC';

      let orderClause = `ORDER BY NATURAL_KEY(${groupCol}), row_num`;
      if (dupSortExpr) {
        if (rawDupSort === 'MATCHED') {
          orderClause = `ORDER BY NATURAL_KEY(${groupCol}) ${dupSortDir}, row_num`;
        } else {
          const clusterAgg = dupSortDir === 'DESC' ? 'MAX' : 'MIN';
          const clusterValExpr = `${clusterAgg}(NATURAL_KEY(${dupSortExpr})) OVER (PARTITION BY ${groupCol})`;
          orderClause = `ORDER BY 
            CASE WHEN ${clusterValExpr} IS NULL OR ${clusterValExpr} = '' THEN 1 ELSE 0 END,
            ${clusterValExpr} ${dupSortDir},
            NATURAL_KEY(${groupCol}),
            CASE WHEN ${dupSortExpr} IS NULL OR ${dupSortExpr} = '' THEN 1 ELSE 0 END,
            NATURAL_KEY(${dupSortExpr}) ${dupSortDir},
            row_num`;
        }
      }

      const dupColExpr = (name, fallback = "NULL") => dupCols.includes(name) ? name : `${fallback} AS ${name}`;

      const dupSql = `
        WITH RankedIsolates AS (
          SELECT *,
                 ROW_NUMBER() OVER (PARTITION BY ${groupCol} ORDER BY ${rowIdxExpr}) AS row_num,
                 COUNT(*) OVER (PARTITION BY ${groupCol}) AS total_duplicates
          FROM Isolates
          WHERE ${notEmptyCond}
        )
        SELECT ${dupColExpr('ROW_IDX', 'rowid')},
               ${dupColExpr('PATIENT_ID', "''")},
               ${dupColExpr('SPEC_DATE', "''")},
               ${dupColExpr('SPEC_NUM', "''")},
               ${dupColExpr('SPEC_TYPE', "''")},
               ${dupColExpr('ORGANISM', "''")},
               ${dupColExpr('FULL_NAME', "''")},
               ${dupColExpr('SEX', "''")},
               ${dupColExpr('AGE', "''")},
               ${dupColExpr('WARD', "''")},
               ${dupColExpr('DEPARTMENT', "''")},
               row_num, total_duplicates
        FROM RankedIsolates
        WHERE total_duplicates > 1 ${searchCond}
        ${orderClause}
        LIMIT ${pageSize} OFFSET ${offset}
      `;
      const rows = wasmSelect(dupSql, params);

      const countSql = `
        SELECT COUNT(*) as c FROM (
          SELECT ${rowIdxExpr}, COUNT(*) OVER (PARTITION BY ${groupCol}) AS total_duplicates
          FROM Isolates
          WHERE ${notEmptyCond}
        ) WHERE total_duplicates > 1 ${searchCond}
      `;
      const totalCount = wasmSelect(countSql, params)[0]?.c || 0;
      return { rows, totalCount, page, pageSize, mode };
    }

    if (pathname.startsWith('/api/isolate/')) {
      const rowIdx = parseInt(pathname.split('/').pop(), 10);
      const rows = wasmSelect('SELECT * FROM Isolates WHERE ROW_IDX = ?', [rowIdx]);
      if (!rows.length) return { error: 'Not found' };
      return { row: rows[0] };
    }

    if (pathname === '/api/delete-row') {
      const { row_idx } = body;
      const numIdx = parseInt(row_idx, 10);
      if (isNaN(numIdx)) return { error: 'Invalid row_idx' };
      const res = wasmRun('DELETE FROM Isolates WHERE ROW_IDX = ?', [numIdx]);
      return { ok: true, changes: res.changes };
    }

    if (pathname === '/api/delete-rows') {
      const { row_indices } = body;
      if (!Array.isArray(row_indices) || !row_indices.length) {
        return { ok: true, changes: 0 };
      }
      const numIndices = row_indices.map(n => parseInt(n, 10)).filter(n => !isNaN(n));
      if (!numIndices.length) return { ok: true, changes: 0 };
      const placeholders = numIndices.map(() => '?').join(',');
      const res = wasmRun(`DELETE FROM Isolates WHERE ROW_IDX IN (${placeholders})`, numIndices);
      return { ok: true, changes: res.changes };
    }

    if (pathname === '/api/delete-duplicates') {
      const { spec_num, patient_id, mode } = body;
      const dupCols = wasmSelect("PRAGMA table_info(Isolates)").map(c => c.name.toUpperCase());
      const hasSpecNum = dupCols.includes('SPEC_NUM');
      const hasPatientId = dupCols.includes('PATIENT_ID');
      const hasRowIdx = dupCols.includes('ROW_IDX');
      const rowIdxCol = hasRowIdx ? 'ROW_IDX' : 'rowid';

      let sql = '';
      if (mode === 'patient' && hasPatientId) {
        sql = `DELETE FROM Isolates WHERE PATIENT_ID IS NOT NULL AND PATIENT_ID != '' AND ${rowIdxCol} NOT IN (
          SELECT MIN(${rowIdxCol}) FROM Isolates WHERE PATIENT_ID IS NOT NULL AND PATIENT_ID != '' GROUP BY UPPER(PATIENT_ID)
        )`;
      } else if (patient_id && hasPatientId) {
        const safe = patient_id.replace(/'/g, "''");
        sql = `DELETE FROM Isolates WHERE ${rowIdxCol} NOT IN (
          SELECT MIN(${rowIdxCol}) FROM Isolates WHERE UPPER(PATIENT_ID) = UPPER('${safe}')
        ) AND UPPER(PATIENT_ID) = UPPER('${safe}')`;
      } else if (spec_num && hasSpecNum) {
        const safe = spec_num.replace(/'/g, "''");
        sql = `DELETE FROM Isolates WHERE ${rowIdxCol} NOT IN (
          SELECT MIN(${rowIdxCol}) FROM Isolates WHERE UPPER(SPEC_NUM) = UPPER('${safe}')
        ) AND UPPER(SPEC_NUM) = UPPER('${safe}')`;
      } else if (hasSpecNum) {
        sql = `DELETE FROM Isolates WHERE SPEC_NUM IS NOT NULL AND SPEC_NUM != '' AND ${rowIdxCol} NOT IN (
          SELECT MIN(${rowIdxCol}) FROM Isolates WHERE SPEC_NUM IS NOT NULL AND SPEC_NUM != '' GROUP BY UPPER(SPEC_NUM)
        )`;
      } else {
        return { ok: true, changes: 0 };
      }
      const res = wasmRun(sql);
      return { ok: true, changes: res.changes };
    }

    if (pathname === '/api/bulk-fix') {
      const { operation } = body;
      const cols = wasmSelect("PRAGMA table_info(Isolates)").map(c => c.name.toUpperCase());
      let sql = '';
      let description = '';
      if (operation === 'upper_spec_num') {
        if (!cols.includes('SPEC_NUM')) {
          return { ok: true, description: 'SPEC_NUM column not present', changes: 0 };
        }
        sql = "UPDATE Isolates SET SPEC_NUM = UPPER(SPEC_NUM) WHERE SPEC_NUM != UPPER(SPEC_NUM)";
        description = 'SPEC_NUM → UPPERCASE';
      } else if (operation === 'trim_all') {
        // Include FULL_NAME only when it is a plain stored column.
        // PRAGMA table_xinfo: hidden 0/1 = normal; 2 = virtual generated; 3 = stored generated.
        let trimFields = ['SPEC_NUM', 'PATIENT_ID', 'WARD', 'DEPARTMENT'];
        const existingCols = wasmSelect('PRAGMA table_info(Isolates)').map(c => c.name);
        trimFields = trimFields.filter(f => existingCols.includes(f));
        try {
          const xinfo = wasmSelect('PRAGMA table_xinfo(Isolates)');
          const fullNameCol = xinfo.find((c) => c.name === 'FULL_NAME');
          if (fullNameCol && (fullNameCol.hidden === 0 || fullNameCol.hidden === 1)) {
            trimFields.push('FULL_NAME');
          }
        } catch (_) {
          // Older sql.js without table_xinfo: skip FULL_NAME to be safe
        }
        if (!trimFields.length) return { ok: true, changes: 0 };
        const setClause = trimFields.map((f) => `${f} = TRIM(${f})`).join(', ');
        const res = wasmRun(`UPDATE Isolates SET ${setClause}`);
        return { ok: true, description: 'Trim whitespace from text fields', changes: res.changes };
      } else if (operation === 'upper_patient_id') {
        if (!cols.includes('PATIENT_ID')) {
          return { ok: true, description: 'PATIENT_ID column not present', changes: 0 };
        }
        sql = "UPDATE Isolates SET PATIENT_ID = UPPER(PATIENT_ID) WHERE PATIENT_ID != UPPER(PATIENT_ID)";
        description = 'PATIENT_ID → UPPERCASE';
      } else if (operation === 'lower_organism') {
        if (!cols.includes('ORGANISM')) {
          return { ok: true, description: 'ORGANISM column not present', changes: 0 };
        }
        sql = "UPDATE Isolates SET ORGANISM = LOWER(ORGANISM) WHERE ORGANISM != LOWER(ORGANISM)";
        description = 'ORGANISM → lowercase';
      } else {
        return { error: 'Unknown operation' };
      }
      const res = wasmRun(sql);
      return { ok: true, description, changes: res.changes };
    }

    if (pathname === '/api/update-field') {
      const { row_idx, field, value } = body;
      if (!EDITABLE_FIELDS.includes(field)) return { error: 'Field not editable' };
      const res = wasmRun(`UPDATE Isolates SET ${field} = ? WHERE ROW_IDX = ?`, [value, row_idx]);
      return { ok: true, changes: res.changes };
    }

    if (pathname === '/api/update-row') {
      const { row_idx, fields } = body;
      if (!row_idx || !fields) return { error: 'Missing row_idx or fields' };
      const updates = [];
      const params = [];
      for (const [key, val] of Object.entries(fields)) {
        if (EDITABLE_FIELDS.includes(key)) {
          updates.push(`${key} = ?`);
          params.push(val);
        }
      }
      if (!updates.length) return { ok: true, changes: 0 };
      params.push(row_idx);
      const res = wasmRun(`UPDATE Isolates SET ${updates.join(', ')} WHERE ROW_IDX = ?`, params);
      return { ok: true, changes: res.changes };
    }

    if (pathname === '/api/custom-sql') {
      const { sql } = body;
      if (!sql || !sql.trim()) return { error: 'Empty SQL' };
      const trimmed = sql.trim().toUpperCase();
      if (trimmed.startsWith('SELECT') || trimmed.startsWith('WITH')) {
        const rows = wasmSelect(sql);
        const truncated = rows.length >= WASM_CUSTOM_SQL_ROW_LIMIT;
        const limited = truncated ? rows.slice(0, WASM_CUSTOM_SQL_ROW_LIMIT) : rows;
        const columns = limited.length > 0 ? Object.keys(limited[0]) : [];
        return { type: 'select', rows: limited, columns, count: limited.length, truncated };
      } else {
        const res = wasmRun(sql);
        return { type: 'update', changes: res.changes };
      }
    }

    if (pathname === '/api/monthly-amr') {
      const cols = wasmSelect("PRAGMA table_info(Isolates)").map(c => c.name);
      const colExpr = (name, fallback = "NULL") => cols.includes(name) ? name : `${fallback} AS ${name}`;
      const hasDate = cols.includes('SPEC_DATE');
      const rows = hasDate ? wasmSelect(`
        SELECT ${colExpr('ROW_IDX', 'rowid')},
               ${colExpr('SPEC_NUM', "''")},
               ${colExpr('SPEC_DATE', "''")},
               ${colExpr('SPEC_TYPE', "''")},
               ${colExpr('WARD_TYPE', "''")},
               ${colExpr('WARD', "''")},
               ${colExpr('DEPARTMENT', "''")},
               ${colExpr('ORGANISM', "''")}
        FROM Isolates
        WHERE SPEC_DATE IS NOT NULL AND LENGTH(SPEC_DATE) >= 7
      `) : [];

      const monthMap = {};
      const bloodNoGrowth = ['xxx', 'xpa', 'nor', 'scn', ''];
      const othersNoGrowth = ['xxx', 'xpa', 'xep', 'xsg', 'nor', 'ora', 'vag', ''];

      for (const r of rows) {
        const ym = (r.SPEC_DATE || '').substring(0, 7);
        if (!/^\d{4}-\d{2}$/.test(ym)) continue;

        if (!monthMap[ym]) {
          monthMap[ym] = {
            month: ym,
            totalRows: 0,
            srcSamples: { opd: 0, ipd: 0, icu: 0, others: 0, total: 0 },
            srcPositives: { opd: 0, ipd: 0, icu: 0, others: 0, total: 0 },
            typeSamples: { blood: 0, pus: 0, sputum: 0, urine: 0, others: 0, total: 0 },
            typePositives: { blood: 0, pus: 0, sputum: 0, urine: 0, others: 0, total: 0 }
          };
        }

        const m = monthMap[ym];
        m.totalRows++;

        const wt = (r.WARD_TYPE || '').toLowerCase();
        const st = (r.SPEC_TYPE || '').toLowerCase();
        const org = (r.ORGANISM || '').toLowerCase().trim();

        const isPos = st === 'bl'
          ? !bloodNoGrowth.includes(org)
          : !othersNoGrowth.includes(org);

        if (wt === 'out') {
          m.srcSamples.opd++;
          if (isPos) m.srcPositives.opd++;
        } else if (wt === 'in') {
          m.srcSamples.ipd++;
          if (isPos) m.srcPositives.ipd++;
        } else if (wt === 'icu') {
          m.srcSamples.icu++;
          if (isPos) m.srcPositives.icu++;
        } else {
          m.srcSamples.others++;
          if (isPos) m.srcPositives.others++;
        }

        if (st === 'bl') {
          m.typeSamples.blood++;
          if (isPos) m.typePositives.blood++;
        } else if (st === 'ps') {
          m.typeSamples.pus++;
          if (isPos) m.typePositives.pus++;
        } else if (st === 'sp') {
          m.typeSamples.sputum++;
          if (isPos) m.typePositives.sputum++;
        } else if (st === 'ur') {
          m.typeSamples.urine++;
          if (isPos) m.typePositives.urine++;
        } else {
          m.typeSamples.others++;
          if (isPos) m.typePositives.others++;
        }
      }

      const sortedMonths = Object.keys(monthMap).sort((a, b) => a.localeCompare(b));
      const monthlyData = sortedMonths.map(ym => {
        const m = monthMap[ym];
        m.srcSamples.total = m.srcSamples.opd + m.srcSamples.ipd + m.srcSamples.icu + m.srcSamples.others;
        m.srcPositives.total = m.srcPositives.opd + m.srcPositives.ipd + m.srcPositives.icu + m.srcPositives.others;
        m.typeSamples.total = m.typeSamples.blood + m.typeSamples.pus + m.typeSamples.sputum + m.typeSamples.urine + m.typeSamples.others;
        m.typePositives.total = m.typePositives.blood + m.typePositives.pus + m.typePositives.sputum + m.typePositives.urine + m.typePositives.others;
        return m;
      });

      return { months: sortedMonths, monthlyData };
    }

    if (pathname === '/api/chart-data') {
      const param = (url.searchParams.get('param') || 'ORGANISM').toUpperCase();
      const period = url.searchParams.get('period') || 'all';
      const startDate = url.searchParams.get('startDate') || '';
      const endDate = url.searchParams.get('endDate') || '';

      const whereClauses = [];
      const params = [];

      if (startDate) {
        whereClauses.push("SPEC_DATE >= ?");
        params.push(startDate);
      }
      if (endDate) {
        whereClauses.push("SPEC_DATE <= ?");
        params.push(endDate);
      }

      if (!startDate && !endDate && period !== 'all') {
        const maxDateRow = wasmSelect("SELECT MAX(SPEC_DATE) as m FROM Isolates WHERE SPEC_DATE IS NOT NULL AND SPEC_DATE != ''")[0];
        if (maxDateRow && maxDateRow.m) {
          const maxD = new Date(maxDateRow.m.substring(0, 10));
          if (!isNaN(maxD.getTime())) {
            let monthsBack = 3;
            if (period === '6m') monthsBack = 6;
            if (period === '12m') monthsBack = 12;
            const cutoff = new Date(maxD);
            cutoff.setMonth(cutoff.getMonth() - monthsBack);
            const cutoffStr = cutoff.toISOString().substring(0, 10);
            whereClauses.push("SPEC_DATE >= ?");
            params.push(cutoffStr);
          }
        }
      }

      let selectExpr = param;
      if (param === 'AGE_GROUP') {
        selectExpr = `
          CASE
            WHEN CAST(AGE AS INTEGER) < 1 THEN '<1 yr'
            WHEN CAST(AGE AS INTEGER) BETWEEN 1 AND 12 THEN '1-12 yrs'
            WHEN CAST(AGE AS INTEGER) BETWEEN 13 AND 25 THEN '13-25 yrs'
            WHEN CAST(AGE AS INTEGER) BETWEEN 26 AND 45 THEN '26-45 yrs'
            WHEN CAST(AGE AS INTEGER) BETWEEN 46 AND 65 THEN '46-65 yrs'
            WHEN CAST(AGE AS INTEGER) > 65 THEN '>65 yrs'
            ELSE 'Unknown'
          END
        `;
      }

      const whereSql = whereClauses.length
        ? `WHERE ${selectExpr} IS NOT NULL AND ${selectExpr} != '' AND ` + whereClauses.join(' AND ')
        : `WHERE ${selectExpr} IS NOT NULL AND ${selectExpr} != ''`;

      const querySql = `
        SELECT ${selectExpr} as label, COUNT(*) as count
        FROM Isolates
        ${whereSql}
        GROUP BY label
        ORDER BY count DESC
        LIMIT 15
      `;

      const rows = wasmSelect(querySql, params);
      const totalFiltered = wasmSelect(`SELECT COUNT(*) as c FROM Isolates ${whereClauses.length ? 'WHERE ' + whereClauses.join(' AND ') : ''}`, params)[0]?.c || 0;

      return {
        param,
        period,
        totalFiltered,
        rows
      };
    }

    return { error: `Unhandled WASM route: ${pathname}` };
  } catch (err) {
    return { error: `WASM Execution error: ${err.message}` };
  }
}
