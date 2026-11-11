/**
 * Shared Pure-ESM SQL Query Builders & Input Validators
 * Used by both Node server (server.js) and In-Browser WASM Emulator (wasm-emulator.js).
 */

export const CUSTOM_SQL_ROW_LIMIT = 10000;

export const EDITABLE_FIELDS = [
  'SPEC_NUM', 'PATIENT_ID', 'SPEC_DATE', 'SPEC_TYPE', 'ORGANISM',
  'FULL_NAME', 'SEX', 'AGE', 'WARD', 'DEPARTMENT', 'INSTITUT',
  'DATE_ADMIS', 'DATE_DATA', 'COMMENT', 'ESBL', 'CARBAPENEM',
  'MRSA', 'URINECOUNT', 'SEROTYPE', 'BETA_LACT', 'INDUC_CLI'
];

export const EDITABLE_FIELDS_SET = new Set(EDITABLE_FIELDS);

export const ALLOWED_ISOLATE_SORT_COLS = {
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

export const ALLOWED_CHART_PARAMS = new Set([
  'ORGANISM',
  'SPEC_TYPE',
  'WARD',
  'WARD_TYPE',
  'DEPARTMENT',
  'SEX',
  'AGE_GROUP',
  'ESBL',
  'CARBAPENEM',
  'MRSA'
]);

/**
 * Parses a row index value while cleanly allowing row_idx === 0.
 * @param {*} raw
 * @returns {number|null}
 */
export function parseRowIdx(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * Strips leading whitespace and SQL comments (-- line, /* block * /) from SQL text
 * and classifies whether it is a read-only query.
 * Also detects multiple statements separated by semicolons outside strings/comments.
 * @param {string} sql
 * @returns {{ stripped: string, leadingKeyword: string, isReadOnly: boolean, hasMultipleStatements: boolean }}
 */
export function classifySqlStatement(sql) {
  const src = String(sql || '');
  let i = 0;
  const len = src.length;

  // Skip leading whitespace & comments to find the first keyword
  while (i < len) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    if (ch === '-' && src[i + 1] === '-') {
      i += 2;
      while (i < len && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < len && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    break;
  }

  const stripped = src.slice(i).trim();
  const match = stripped.match(/^([A-Za-z]+)/);
  const leadingKeyword = match ? match[1].toUpperCase() : '';

  // Detect multiple statements outside quotes & comments
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;
  let statementCount = 0;
  let currentHasToken = false;

  for (let p = 0; p < src.length; p++) {
    const c = src[p];
    const next = src[p + 1];

    if (inLineComment) {
      if (c === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (c === '*' && next === '/') {
        inBlockComment = false;
        p++;
      }
      continue;
    }
    if (inSingle) {
      if (c === "'" && next === "'") {
        p++;
      } else if (c === "'") {
        inSingle = false;
      }
      currentHasToken = true;
      continue;
    }
    if (inDouble) {
      if (c === '"' && next === '"') {
        p++;
      } else if (c === '"') {
        inDouble = false;
      }
      currentHasToken = true;
      continue;
    }

    if (c === '-' && next === '-') {
      inLineComment = true;
      p++;
      continue;
    }
    if (c === '/' && next === '*') {
      inBlockComment = true;
      p++;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      currentHasToken = true;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      currentHasToken = true;
      continue;
    }
    if (c === ';') {
      if (currentHasToken) {
        statementCount++;
        currentHasToken = false;
      }
      continue;
    }
    if (!/\s/.test(c)) {
      currentHasToken = true;
    }
  }
  if (currentHasToken) statementCount++;

  let isReadOnly = false;
  if (leadingKeyword === 'SELECT' || leadingKeyword === 'WITH' || leadingKeyword === 'EXPLAIN') {
    isReadOnly = true;
  } else if (leadingKeyword === 'PRAGMA') {
    // Only treat non-mutating PRAGMA (no assignment `=`) as read-only
    isReadOnly = !/^PRAGMA\s+[A-Za-z0-9_."]+\s*=/i.test(stripped);
  }

  return {
    stripped,
    leadingKeyword,
    isReadOnly,
    hasMultipleStatements: statementCount > 1
  };
}

/**
 * Builds parameterized SQL statements for /api/isolates.
 */
export function buildIsolatesQuery({
  cols = [],
  page = 1,
  pageSize = 25,
  search = '',
  organism = '',
  ward = '',
  month = '',
  specimen = '',
  sortCol = 'ROW_IDX',
  sortDir = 'DESC'
}) {
  const safePage = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  const safePageSize = Number.isFinite(pageSize) && pageSize >= 1 ? Math.min(Math.floor(pageSize), 500) : 25;
  const offset = (safePage - 1) * safePageSize;

  const normalizedSortCol = ALLOWED_ISOLATE_SORT_COLS[String(sortCol || 'ROW_IDX').toUpperCase()] || 'ROW_IDX';
  const normalizedSortDir = String(sortDir || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const upperCols = cols.map((c) => c.toUpperCase());
  const hasRowIdx = upperCols.includes('ROW_IDX');
  const rowIdxCol = hasRowIdx ? 'ROW_IDX' : 'rowid';
  const colExpr = (name, fallback = 'NULL') => (cols.includes(name) ? name : `${fallback} AS ${name}`);

  const orderTarget = normalizedSortCol === 'ROW_IDX' ? rowIdxCol : normalizedSortCol;
  const orderClause =
    normalizedSortCol === 'ROW_IDX'
      ? `ORDER BY ${rowIdxCol} ${normalizedSortDir}`
      : upperCols.includes(normalizedSortCol)
        ? `ORDER BY CASE WHEN ${orderTarget} IS NULL OR ${orderTarget} = '' THEN 1 ELSE 0 END, NATURAL_KEY(${orderTarget}) ${normalizedSortDir}, ${rowIdxCol} DESC`
        : `ORDER BY ${rowIdxCol} ${normalizedSortDir}`;

  const whereClauses = [];
  const params = [];
  const trimmedSearch = String(search || '').trim();
  const trimmedOrg = String(organism || '').trim();
  const trimmedWard = String(ward || '').trim();
  const trimmedMonth = String(month || '').trim();
  const trimmedSpecimen = String(specimen || '').trim();

  if (trimmedSearch) {
    const searchParts = [];
    if (upperCols.includes('SPEC_NUM')) searchParts.push('UPPER(SPEC_NUM) LIKE ?');
    if (upperCols.includes('PATIENT_ID')) searchParts.push('UPPER(PATIENT_ID) LIKE ?');
    if (upperCols.includes('FULL_NAME')) searchParts.push('UPPER(FULL_NAME) LIKE ?');
    if (searchParts.length) {
      whereClauses.push(`(${searchParts.join(' OR ')})`);
      const s = `%${trimmedSearch.toUpperCase()}%`;
      for (let i = 0; i < searchParts.length; i++) params.push(s);
    }
  }
  if (trimmedOrg && upperCols.includes('ORGANISM')) {
    whereClauses.push('ORGANISM = ?');
    params.push(trimmedOrg);
  }
  if (trimmedWard && upperCols.includes('WARD')) {
    whereClauses.push('WARD = ?');
    params.push(trimmedWard);
  }
  if (trimmedMonth && upperCols.includes('SPEC_DATE')) {
    whereClauses.push('SUBSTR(SPEC_DATE, 1, 7) = ?');
    params.push(trimmedMonth);
  }
  if (trimmedSpecimen && upperCols.includes('SPEC_TYPE')) {
    whereClauses.push('LOWER(SPEC_TYPE) = LOWER(?)');
    params.push(trimmedSpecimen);
  }

  const whereSql = whereClauses.length ? 'WHERE ' + whereClauses.join(' AND ') : '';

  const countSql = `SELECT COUNT(*) as c FROM Isolates ${whereSql}`;
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
    LIMIT ${safePageSize} OFFSET ${offset}
  `;

  return {
    rowsSql,
    countSql,
    params,
    page: safePage,
    pageSize: safePageSize,
    sortCol: normalizedSortCol,
    sortDir: normalizedSortDir
  };
}

/**
 * Builds parameterized SQL statements for /api/duplicates (matching server & WASM identically).
 */
export function buildDuplicatesQuery({
  cols = [],
  page = 1,
  pageSize = 50,
  mode = 'spec',
  search = '',
  sortCol = '',
  sortDir = 'ASC'
}) {
  const safePage = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  const safePageSize = Number.isFinite(pageSize) && pageSize >= 1 ? Math.min(Math.floor(pageSize), 500) : 50;
  const offset = (safePage - 1) * safePageSize;
  const normalizedMode = String(mode || 'spec').toLowerCase() === 'patient' ? 'patient' : 'spec';

  const upperCols = cols.map((c) => c.toUpperCase());
  const hasSpecNum = upperCols.includes('SPEC_NUM');
  const hasPatientId = upperCols.includes('PATIENT_ID');
  const hasFullName = upperCols.includes('FULL_NAME');
  const hasRowIdx = upperCols.includes('ROW_IDX');
  const rowIdxExpr = hasRowIdx ? 'ROW_IDX' : 'rowid';

  const groupCol =
    normalizedMode === 'patient'
      ? (hasPatientId ? 'UPPER(PATIENT_ID)' : "''")
      : (hasSpecNum ? 'UPPER(SPEC_NUM)' : "''");
  const notEmptyCond =
    normalizedMode === 'patient'
      ? (hasPatientId ? "PATIENT_ID IS NOT NULL AND PATIENT_ID != ''" : '0')
      : (hasSpecNum ? "SPEC_NUM IS NOT NULL AND SPEC_NUM != ''" : '0');

  let searchCond = '';
  const params = [];
  const trimmedSearch = String(search || '').trim();
  if (trimmedSearch) {
    const s = `%${trimmedSearch.toUpperCase()}%`;
    if (hasFullName) {
      searchCond = `AND (${groupCol} LIKE ? OR UPPER(FULL_NAME) LIKE ?)`;
      params.push(s, s);
    } else {
      searchCond = `AND (${groupCol} LIKE ?)`;
      params.push(s);
    }
  }

  const ALLOWED_DUP_COLS = {
    ROW_IDX: rowIdxExpr,
    MATCHED: groupCol,
    OTHER:
      normalizedMode === 'patient'
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

  const rawDupSort = sortCol ? String(sortCol).toUpperCase() : '';
  const dupSortExpr = ALLOWED_DUP_COLS[rawDupSort] || null;
  const dupSortDir = String(sortDir || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

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

  const colExpr = (name, fallback = 'NULL') => (cols.includes(name) ? name : `${fallback} AS ${name}`);

  const rowsSql = `
    WITH RankedIsolates AS (
      SELECT *,
             ROW_NUMBER() OVER (PARTITION BY ${groupCol} ORDER BY ${rowIdxExpr}) AS row_num,
             COUNT(*) OVER (PARTITION BY ${groupCol}) AS total_duplicates
      FROM Isolates
      WHERE ${notEmptyCond}
    )
    SELECT ${colExpr('ROW_IDX', 'rowid')},
           ${colExpr('PATIENT_ID', "''")},
           ${colExpr('SPEC_DATE', "''")},
           ${colExpr('SPEC_NUM', "''")},
           ${colExpr('SPEC_TYPE', "''")},
           ${colExpr('ORGANISM', "''")},
           ${colExpr('FULL_NAME', "''")},
           ${colExpr('SEX', "''")},
           ${colExpr('AGE', "''")},
           ${colExpr('WARD', "''")},
           ${colExpr('DEPARTMENT', "''")},
           row_num, total_duplicates
    FROM RankedIsolates
    WHERE total_duplicates > 1 ${searchCond}
    ${orderClause}
    LIMIT ${safePageSize} OFFSET ${offset}
  `;

  const countSql = `
    SELECT COUNT(*) as c FROM (
      SELECT ${rowIdxExpr}, COUNT(*) OVER (PARTITION BY ${groupCol}) AS total_duplicates
      FROM Isolates
      WHERE ${notEmptyCond}
    ) WHERE total_duplicates > 1 ${searchCond}
  `;

  const mixedCaseSql = hasSpecNum
    ? "SELECT COUNT(*) as c FROM Isolates WHERE SPEC_NUM IS NOT NULL AND SPEC_NUM != '' AND SPEC_NUM != UPPER(SPEC_NUM)"
    : null;

  return {
    rowsSql,
    countSql,
    mixedCaseSql,
    params,
    page: safePage,
    pageSize: safePageSize,
    mode: normalizedMode
  };
}

/**
 * Builds parameterized SQL queries for /api/chart-data with strict column whitelisting.
 */
export function buildChartDataQuery({
  param = 'ORGANISM',
  period = 'all',
  startDate = '',
  endDate = '',
  maxDate = null,
  cols = null
}) {
  const normalizedParam = String(param || 'ORGANISM').toUpperCase();
  if (!ALLOWED_CHART_PARAMS.has(normalizedParam)) {
    return { error: 'Invalid parameter for chart aggregation' };
  }

  const upperCols = Array.isArray(cols) ? cols.map((c) => c.toUpperCase()) : null;
  if (upperCols) {
    const requiredCol = normalizedParam === 'AGE_GROUP' ? 'AGE' : normalizedParam;
    if (!upperCols.includes(requiredCol)) {
      return { empty: true, param: normalizedParam, period };
    }
  }

  const whereClauses = [];
  const params = [];

  if (startDate) {
    whereClauses.push('SPEC_DATE >= ?');
    params.push(startDate);
  }
  if (endDate) {
    whereClauses.push('SPEC_DATE <= ?');
    params.push(endDate);
  }

  if (!startDate && !endDate && period !== 'all' && maxDate) {
    const maxD = new Date(String(maxDate).substring(0, 10));
    if (!isNaN(maxD.getTime())) {
      let monthsBack = 3;
      if (period === '6m') monthsBack = 6;
      if (period === '12m') monthsBack = 12;
      const cutoff = new Date(maxD);
      cutoff.setMonth(cutoff.getMonth() - monthsBack);
      const cutoffStr = cutoff.toISOString().substring(0, 10);
      whereClauses.push('SPEC_DATE >= ?');
      params.push(cutoffStr);
    }
  }

  let selectExpr = normalizedParam;
  if (normalizedParam === 'AGE_GROUP') {
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
  const totalSql = `SELECT COUNT(*) as c FROM Isolates ${whereClauses.length ? 'WHERE ' + whereClauses.join(' AND ') : ''}`;

  return {
    param: normalizedParam,
    period,
    querySql,
    totalSql,
    params
  };
}

/**
 * Builds parameterized SQL for /api/delete-duplicates (never interpolating user strings).
 */
export function buildDeleteDuplicatesQuery({ cols = [], spec_num = '', patient_id = '', mode = '' }) {
  const upperCols = cols.map((c) => c.toUpperCase());
  const hasSpecNum = upperCols.includes('SPEC_NUM');
  const hasPatientId = upperCols.includes('PATIENT_ID');
  const rowIdxCol = upperCols.includes('ROW_IDX') ? 'ROW_IDX' : 'rowid';

  if (mode === 'patient' || patient_id) {
    if (!hasPatientId) return { noop: true };
    if (patient_id) {
      return {
        sql: `DELETE FROM Isolates WHERE ${rowIdxCol} NOT IN (
          SELECT MIN(${rowIdxCol}) FROM Isolates WHERE UPPER(PATIENT_ID) = UPPER(?)
        ) AND UPPER(PATIENT_ID) = UPPER(?)`,
        params: [patient_id, patient_id]
      };
    }
    return {
      sql: `DELETE FROM Isolates WHERE PATIENT_ID IS NOT NULL AND PATIENT_ID != '' AND ${rowIdxCol} NOT IN (
        SELECT MIN(${rowIdxCol}) FROM Isolates WHERE PATIENT_ID IS NOT NULL AND PATIENT_ID != '' GROUP BY UPPER(PATIENT_ID)
      )`,
      params: []
    };
  }

  if (!hasSpecNum) return { noop: true };
  if (spec_num) {
    return {
      sql: `DELETE FROM Isolates WHERE ${rowIdxCol} NOT IN (
        SELECT MIN(${rowIdxCol}) FROM Isolates WHERE UPPER(SPEC_NUM) = UPPER(?)
      ) AND UPPER(SPEC_NUM) = UPPER(?)`,
      params: [spec_num, spec_num]
    };
  }
  return {
    sql: `DELETE FROM Isolates WHERE SPEC_NUM IS NOT NULL AND SPEC_NUM != '' AND ${rowIdxCol} NOT IN (
      SELECT MIN(${rowIdxCol}) FROM Isolates WHERE SPEC_NUM IS NOT NULL AND SPEC_NUM != '' GROUP BY UPPER(SPEC_NUM)
    )`,
    params: []
  };
}

/**
 * Validates and builds parameterized UPDATE SQL for /api/update-field.
 */
export function buildUpdateFieldQuery({ tableCols = [], rowIdx, field, value }) {
  const numIdx = parseRowIdx(rowIdx);
  if (numIdx === null) return { error: 'Invalid row_idx' };
  if (!EDITABLE_FIELDS_SET.has(field)) return { error: 'Field not editable' };

  const colMap = new Map(tableCols.map((c) => [c.toUpperCase(), c]));
  const actualCol = colMap.get(String(field).toUpperCase());
  if (!actualCol) {
    return { error: `Column "${field}" does not exist in Isolates table` };
  }

  const rowIdxCol = colMap.has('ROW_IDX') ? colMap.get('ROW_IDX') : 'rowid';
  return {
    sql: `UPDATE Isolates SET ${actualCol} = ? WHERE ${rowIdxCol} = ?`,
    params: [value, numIdx]
  };
}

/**
 * Validates and builds parameterized UPDATE SQL for /api/update-row.
 * Allows row_idx === 0 and silently skips missing optional columns rather than failing SQL.
 */
export function buildUpdateRowQuery({ tableCols = [], rowIdx, fields }) {
  const numIdx = parseRowIdx(rowIdx);
  if (numIdx === null || !fields || typeof fields !== 'object') {
    return { error: 'Missing row_idx or fields' };
  }

  const colMap = new Map(tableCols.map((c) => [c.toUpperCase(), c]));
  const rowIdxCol = colMap.has('ROW_IDX') ? colMap.get('ROW_IDX') : 'rowid';

  const updates = [];
  const params = [];
  for (const [key, val] of Object.entries(fields)) {
    if (!EDITABLE_FIELDS_SET.has(key)) continue;
    const actualCol = colMap.get(key.toUpperCase());
    if (!actualCol) continue;
    updates.push(`${actualCol} = ?`);
    params.push(val);
  }

  if (!updates.length) return { noop: true };
  params.push(numIdx);
  return {
    sql: `UPDATE Isolates SET ${updates.join(', ')} WHERE ${rowIdxCol} = ?`,
    params
  };
}

/**
 * Builds shared SQLite queries for dataset date profiling (/api/stats) across
 * both Node better-sqlite3 and In-Browser sql.js WASM.
 *
 * @param {string[]} cols
 * @param {Date} [referenceDate]
 */
export function buildDateProfileQueries(cols = [], referenceDate = new Date()) {
  const colMap = new Map(cols.map((c) => [String(c).toUpperCase(), c]));
  const dateCol = colMap.has('SPEC_DATE')
    ? colMap.get('SPEC_DATE')
    : colMap.has('DATE_DATA')
      ? colMap.get('DATE_DATA')
      : null;

  if (!dateCol) {
    return {
      hasDateColumn: false,
      monthCountsSql: null,
      auditSql: 'SELECT COUNT(*) AS totalRows, COUNT(*) AS missingCount, 0 AS malformedCount FROM Isolates',
      anomalySamplesSql: null,
      anomalyParams: []
    };
  }

  const trimmed = `TRIM(COALESCE(${dateCol}, ''))`;
  const iso10 = `SUBSTR(${trimmed}, 1, 10)`;
  const validDateCond = `${trimmed} != '' AND LENGTH(${trimmed}) >= 10 AND ${iso10} GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]' AND date(${iso10}) = ${iso10}`;

  const ref = referenceDate instanceof Date && !isNaN(referenceDate.getTime()) ? referenceDate : new Date();
  const cutoffDate = new Date(ref.getTime() + 7 * 86400000).toISOString().slice(0, 10);

  const rowIdxExpr = colMap.has('ROW_IDX') ? colMap.get('ROW_IDX') : 'rowid';
  const specNumExpr = colMap.has('SPEC_NUM') ? colMap.get('SPEC_NUM') : "''";
  const orgExpr = colMap.has('ORGANISM') ? colMap.get('ORGANISM') : "''";

  return {
    hasDateColumn: true,
    dateCol,
    monthCountsSql: `
      SELECT SUBSTR(${iso10}, 1, 7) AS ym,
             COUNT(*) AS count,
             MIN(${iso10}) AS minDate,
             MAX(${iso10}) AS maxDate
      FROM Isolates
      WHERE ${validDateCond}
      GROUP BY ym
      ORDER BY ym DESC
    `.trim(),
    auditSql: `
      SELECT COUNT(*) AS totalRows,
             SUM(CASE WHEN ${trimmed} = '' THEN 1 ELSE 0 END) AS missingCount,
             SUM(CASE WHEN ${trimmed} != '' AND NOT (${validDateCond}) THEN 1 ELSE 0 END) AS malformedCount
      FROM Isolates
    `.trim(),
    anomalySamplesSql: `
      SELECT ${rowIdxExpr} AS rowIdx,
             ${specNumExpr} AS specNum,
             ${orgExpr} AS organism,
             ${dateCol} AS rawDate
      FROM Isolates
      WHERE ${trimmed} = ''
         OR NOT (${validDateCond})
         OR SUBSTR(${trimmed}, 1, 4) < '1990'
         OR ${iso10} > ?
      ORDER BY ${rowIdxExpr} DESC
      LIMIT 5
    `.trim(),
    anomalyParams: [cutoffDate]
  };
}

/**
 * Builds parameterized SQL telemetry query to measure rows excluded by active
 * startDate/endDate filters (both undated/invalid and outside date bounds).
 */
export function buildAntibiogramDateExclusionQuery({
  cols = [],
  nonDateWhereClause = '',
  nonDateParams = [],
  startDate = '',
  endDate = ''
}) {
  if (!startDate && !endDate) return null;
  const colSet = new Set(cols.map((c) => String(c).toUpperCase()));
  const hasSpec = colSet.size === 0 || colSet.has('SPEC_DATE');
  const hasData = colSet.size === 0 || colSet.has('DATE_DATA');
  let dateExpr = "''";
  if (hasSpec && hasData) dateExpr = "COALESCE(SPEC_DATE, DATE_DATA, '')";
  else if (hasSpec) dateExpr = "COALESCE(SPEC_DATE, '')";
  else if (hasData) dateExpr = "COALESCE(DATE_DATA, '')";

  const trimmed = `TRIM(${dateExpr})`;
  const iso10 = `SUBSTR(${trimmed}, 1, 10)`;
  const validCond = `${trimmed} != '' AND LENGTH(${trimmed}) >= 10 AND ${iso10} GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]' AND date(${iso10}) = ${iso10}`;

  return {
    sql: `
      SELECT
        SUM(CASE WHEN NOT (${validCond}) THEN 1 ELSE 0 END) AS excludedUndated,
        SUM(CASE WHEN (${validCond}) AND ((? != '' AND ${iso10} < ?) OR (? != '' AND ${iso10} > ?)) THEN 1 ELSE 0 END) AS excludedOutsideRange
      FROM Isolates
      ${nonDateWhereClause}
    `.trim(),
    params: [startDate, startDate, endDate, endDate, ...nonDateParams]
  };
}
