/**
 * In-Browser WASM SQLite API Emulator
 * Emulates backend HTTP API endpoints directly against sql.js in-memory database
 * for 100% offline and standalone web usage.
 */
import { state } from '../state/store.js';
import { wasmSelect, wasmRun, normaliseSchema } from '../db/wasm.js';
import { deduplicateFirstIsolates, calculateCumulativeAntibiogram } from '../utils/antibiogram-engine.js';
import {
  CUSTOM_SQL_ROW_LIMIT,
  classifySqlStatement,
  buildIsolatesQuery,
  buildDuplicatesQuery,
  buildChartDataQuery,
  buildDeleteDuplicatesQuery,
  buildUpdateFieldQuery,
  buildUpdateRowQuery,
  buildDateProfileQueries,
  buildAntibiogramDateExclusionQuery
} from '../db/query-core.js';
import {
  analyzeDateProfile,
  suggestSurveillancePeriods
} from '../utils/date-profile.js';

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
      const wardTypes = cols.includes('WARD_TYPE')
        ? wasmSelect("SELECT DISTINCT WARD_TYPE FROM Isolates WHERE WARD_TYPE IS NOT NULL AND WARD_TYPE != '' ORDER BY WARD_TYPE").map(r => r.WARD_TYPE)
        : [];
      const specimens = cols.includes('SPEC_TYPE')
        ? wasmSelect("SELECT DISTINCT SPEC_TYPE FROM Isolates WHERE SPEC_TYPE IS NOT NULL AND SPEC_TYPE != '' ORDER BY SPEC_TYPE").map(r => r.SPEC_TYPE)
        : [];
      const dpQueries = buildDateProfileQueries(cols);
      const auditRow = wasmSelect(dpQueries.auditSql)[0] || {};
      const monthRows = dpQueries.monthCountsSql ? wasmSelect(dpQueries.monthCountsSql) : [];
      const anomalySamples = dpQueries.anomalySamplesSql
        ? wasmSelect(dpQueries.anomalySamplesSql, dpQueries.anomalyParams)
        : [];

      const dateProfile = analyzeDateProfile({
        totalRows: auditRow.totalRows ?? total,
        missingCount: auditRow.missingCount ?? 0,
        malformedCount: auditRow.malformedCount ?? 0,
        monthRows,
        anomalySamples,
      });
      const suggestedPeriods = suggestSurveillancePeriods(dateProfile);

      const plausibleMonths = dateProfile.monthCounts.filter((m) => m.isPlausible).map((m) => m.ym);
      const months = plausibleMonths.length > 0
        ? plausibleMonths
        : dateProfile.monthCounts.map((m) => m.ym);
      const maxDate = dateProfile.maxValidDate || null;

      return { total, dupRows, dupGroups, dupPtRows, dupPtGroups, organisms, wards, wardTypes, specimens, months, maxDate, dateProfile, suggestedPeriods };
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
      const cols = wasmSelect("PRAGMA table_info(Isolates)").map(c => c.name);
      const q = buildIsolatesQuery({
        cols,
        page: parseInt(url.searchParams.get('page') || '1', 10),
        pageSize: parseInt(url.searchParams.get('pageSize') || '25', 10),
        search: url.searchParams.get('search') || '',
        organism: url.searchParams.get('organism') || '',
        ward: url.searchParams.get('ward') || '',
        month: url.searchParams.get('month') || '',
        specimen: url.searchParams.get('specimen') || url.searchParams.get('specType') || '',
        sortCol: url.searchParams.get('sortCol') || 'ROW_IDX',
        sortDir: url.searchParams.get('sortDir') || 'DESC'
      });
      const totalCount = wasmSelect(q.countSql, q.params)[0]?.c || 0;
      const rows = wasmSelect(q.rowsSql, q.params);
      return { rows, totalCount, page: q.page, pageSize: q.pageSize, sortCol: q.sortCol, sortDir: q.sortDir };
    }

    if (pathname === '/api/duplicates') {
      const dupCols = wasmSelect("PRAGMA table_info(Isolates)").map(c => c.name);
      const q = buildDuplicatesQuery({
        cols: dupCols,
        page: parseInt(url.searchParams.get('page') || '1', 10),
        pageSize: parseInt(url.searchParams.get('pageSize') || '50', 10),
        mode: url.searchParams.get('mode') || 'spec',
        search: url.searchParams.get('search') || '',
        sortCol: url.searchParams.get('sortCol') || '',
        sortDir: url.searchParams.get('sortDir') || 'ASC'
      });
      const rows = wasmSelect(q.rowsSql, q.params);
      const totalCount = wasmSelect(q.countSql, q.params)[0]?.c || 0;
      const hasMixedCaseSpecNum = q.mixedCaseSql
        ? (wasmSelect(q.mixedCaseSql)[0]?.c || 0) > 0
        : false;
      return { rows, totalCount, page: q.page, pageSize: q.pageSize, mode: q.mode, hasMixedCaseSpecNum };
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
      const dupCols = wasmSelect("PRAGMA table_info(Isolates)").map(c => c.name);
      const q = buildDeleteDuplicatesQuery({ cols: dupCols, spec_num, patient_id, mode });
      if (q.noop) return { ok: true, changes: 0 };
      const res = wasmRun(q.sql, q.params);
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
      const tableCols = wasmSelect("PRAGMA table_info(Isolates)").map(c => c.name);
      const q = buildUpdateFieldQuery({ tableCols, rowIdx: row_idx, field, value });
      if (q.error) return { error: q.error };
      const res = wasmRun(q.sql, q.params);
      return { ok: true, changes: res.changes };
    }

    if (pathname === '/api/update-row') {
      const { row_idx, fields } = body;
      const tableCols = wasmSelect("PRAGMA table_info(Isolates)").map(c => c.name);
      const q = buildUpdateRowQuery({ tableCols, rowIdx: row_idx, fields });
      if (q.error) return { error: q.error };
      if (q.noop) return { ok: true, changes: 0 };
      const res = wasmRun(q.sql, q.params);
      return { ok: true, changes: res.changes };
    }

    if (pathname === '/api/custom-sql') {
      const { sql } = body;
      if (!sql || !String(sql).trim()) return { error: 'Empty SQL' };
      const info = classifySqlStatement(sql);
      if (!info.stripped) return { error: 'Empty SQL' };
      if (info.hasMultipleStatements) {
        return { error: 'Only a single SQL statement is allowed per execution' };
      }
      if (info.isReadOnly) {
        const rows = wasmSelect(sql);
        const truncated = rows.length > CUSTOM_SQL_ROW_LIMIT;
        const limited = truncated ? rows.slice(0, CUSTOM_SQL_ROW_LIMIT) : rows;
        const columns = limited.length > 0 ? Object.keys(limited[0]) : [];
        return { type: 'select', rows: limited, columns, count: limited.length, truncated };
      }
      const res = wasmRun(sql);
      return { type: 'update', changes: res.changes };
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
      const param = url.searchParams.get('param') || 'ORGANISM';
      const period = url.searchParams.get('period') || 'all';
      const startDate = url.searchParams.get('startDate') || '';
      const endDate = url.searchParams.get('endDate') || '';

      const cols = wasmSelect("PRAGMA table_info(Isolates)").map(c => c.name);
      const maxDateRow = (!startDate && !endDate && period !== 'all')
        ? wasmSelect("SELECT MAX(SPEC_DATE) as m FROM Isolates WHERE SPEC_DATE IS NOT NULL AND SPEC_DATE != ''")[0]
        : null;

      const q = buildChartDataQuery({
        param,
        period,
        startDate,
        endDate,
        maxDate: maxDateRow?.m || null,
        cols
      });
      if (q.error) return { error: q.error };
      if (q.empty) return { param: q.param, period: q.period, totalFiltered: 0, rows: [] };

      const rows = wasmSelect(q.querySql, q.params);
      const totalFiltered = wasmSelect(q.totalSql, q.params)[0]?.c || 0;
      return { param: q.param, period: q.period, totalFiltered, rows };
    }

    if (pathname === '/api/antibiogram') {
      const minIsolates = parseInt(url.searchParams.get('minIsolates') || '30', 10);
      const orgFilter = (url.searchParams.get('organism') || '').trim().toLowerCase();
      const wardFilter = (url.searchParams.get('ward') || '').trim();
      const locType = (url.searchParams.get('locType') || url.searchParams.get('wardType') || '').trim().toLowerCase();
      const specFilter = (url.searchParams.get('specType') || '').trim();
      const startDate = (url.searchParams.get('startDate') || '').trim();
      const endDate = (url.searchParams.get('endDate') || '').trim();
      const dedupMode = (url.searchParams.get('dedupMode') || 'patient_first').trim();
      const episodeDays = parseInt(url.searchParams.get('episodeDays') || '30', 10);

      const where = [];
      const params = [];
      if (orgFilter) {
        where.push('LOWER(ORGANISM) = ?');
        params.push(orgFilter);
      }
      if (locType) {
        const lt = locType.toLowerCase();
        if (lt === 'icu') {
          where.push("(LOWER(COALESCE(WARD_TYPE, '')) = 'icu' OR LOWER(COALESCE(WARD, '')) LIKE '%icu%' OR LOWER(COALESCE(WARD, '')) LIKE '%intensive%' OR LOWER(COALESCE(WARD, '')) LIKE '%ccu%')");
        } else if (lt === 'outpatient' || lt === 'out') {
          where.push("(LOWER(COALESCE(WARD_TYPE, '')) = 'out' OR LOWER(COALESCE(WARD, '')) LIKE '%opd%' OR LOWER(COALESCE(WARD, '')) LIKE '%out%' OR LOWER(COALESCE(WARD, '')) LIKE '%clinic%')");
        } else if (lt === 'inpatient' || lt === 'in') {
          where.push("(LOWER(COALESCE(WARD_TYPE, '')) = 'in' OR (NOT (LOWER(COALESCE(WARD_TYPE, '')) = 'icu' OR LOWER(COALESCE(WARD, '')) LIKE '%icu%' OR LOWER(COALESCE(WARD, '')) LIKE '%intensive%' OR LOWER(COALESCE(WARD, '')) LIKE '%ccu%') AND NOT (LOWER(COALESCE(WARD_TYPE, '')) = 'out' OR LOWER(COALESCE(WARD, '')) LIKE '%opd%' OR LOWER(COALESCE(WARD, '')) LIKE '%out%' OR LOWER(COALESCE(WARD, '')) LIKE '%clinic%')))");
        } else {
          where.push("(LOWER(COALESCE(WARD_TYPE, '')) = ? OR (COALESCE(WARD_TYPE, '') = '' AND LOWER(COALESCE(WARD, '')) LIKE ?))");
          params.push(lt, `%${lt}%`);
        }
      } else if (wardFilter) {
        where.push('WARD = ?');
        params.push(wardFilter);
      }
      if (specFilter) {
        where.push('LOWER(SPEC_TYPE) = LOWER(?)');
        params.push(specFilter);
      }
      // Exclude negative culture / non-pathogen / no growth results (e.g. 'xxx', 'xpa', 'xxp')
      where.push("LOWER(COALESCE(ORGANISM, '')) NOT LIKE 'x%' AND COALESCE(ORGANISM, '') != ''");

      const nonDateWhereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
      const nonDateParams = [...params];

      if (startDate) {
        where.push("SUBSTR(TRIM(COALESCE(SPEC_DATE, DATE_DATA, '')), 1, 10) >= ?");
        params.push(startDate);
      }
      if (endDate) {
        where.push("SUBSTR(TRIM(COALESCE(SPEC_DATE, DATE_DATA, '')), 1, 10) <= ?");
        params.push(endDate);
      }

      const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
      const rawIsolates = wasmSelect(`SELECT * FROM Isolates ${whereClause}`, params);

      let excludedUndated = 0;
      let excludedOutsideRange = 0;
      if (startDate || endDate) {
        const tableCols = wasmSelect('PRAGMA table_info(Isolates)').map((c) => c.name);
        const exclQ = buildAntibiogramDateExclusionQuery({
          cols: tableCols,
          nonDateWhereClause,
          nonDateParams,
          startDate,
          endDate,
        });
        if (exclQ) {
          const exclRow = wasmSelect(exclQ.sql, exclQ.params)[0] || {};
          excludedUndated = Number(exclRow.excludedUndated) || 0;
          excludedOutsideRange = Number(exclRow.excludedOutsideRange) || 0;
        }
      }

      const filteredIsolates = deduplicateFirstIsolates(rawIsolates, {
        mode: dedupMode,
        episodeDays,
        customLabConfig: state.customLabConfig || null
      });

      const report = calculateCumulativeAntibiogram(filteredIsolates, {
        minIsolates,
        customLabConfig: state.customLabConfig || null,
        mode: dedupMode,
        episodeDays
      });

      report.labConfigFile = state.customLabConfig?.filename || null;
      report.labName = state.customLabConfig?.metadata?.['Laboratory Name'] || null;
      report.totalRawIsolates = rawIsolates.length;
      report.startDate = startDate || null;
      report.endDate = endDate || null;
      report.excludedUndated = excludedUndated;
      report.excludedOutsideRange = excludedOutsideRange;

      return report;
    }

    return { error: `Unhandled WASM route: ${pathname}` };
  } catch (err) {
    return { error: `WASM Execution error: ${err.message}` };
  }
}
