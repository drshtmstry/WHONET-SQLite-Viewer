import { api } from '../api/client.js';
import { escapeHtml } from '../utils/formatters.js';
import { renderSortHeader } from '../ui/table.js';

export let sqlSchemaCache = {
  tables: ['Isolates'],
  columns: {
    'Isolates': [
      'ROW_IDX', 'SPEC_NUM', 'PATIENT_ID', 'SPEC_DATE', 'SPEC_TYPE', 'ORGANISM',
      'FULL_NAME', 'SEX', 'AGE', 'AGE_GROUP', 'WARD', 'WARD_TYPE', 'DEPARTMENT',
      'INSTITUT', 'DATE_ADMIS', 'DATE_DATA', 'COMMENT', 'ESBL', 'CARBAPENEM', 'MRSA',
      'URINECOUNT', 'SEROTYPE', 'BETA_LACT', 'INDUC_CLI',
      'AMP_ND10', 'AMX_ND25', 'AMC_ND30', 'TZP_ND100', 'SAM_ND20', 'CFZ_ND30',
      'CXM_ND30', 'CRO_ND30', 'CTX_ND30', 'CAZ_ND30', 'FEP_ND30', 'IPM_ND10',
      'MEM_ND10', 'ETP_ND10', 'CIP_ND5', 'LVX_ND5', 'OFX_ND5', 'GEN_ND10',
      'AMK_ND30', 'TOB_ND10', 'VAN_ND30', 'TEC_ND30', 'LNZ_ND30', 'DOX_ND30',
      'TET_ND30', 'TGC_ND15', 'SXT_ND25', 'NIT_ND300', 'FOF_ND200', 'CHL_ND30',
      'CLI_ND2', 'ERY_ND15'
    ]
  }
};

export const SQL_AUTOCOMPLETE_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET',
  'JOIN', 'LEFT JOIN', 'INNER JOIN', 'RIGHT JOIN', 'CROSS JOIN', 'ON',
  'UPDATE', 'SET', 'INSERT INTO', 'VALUES', 'DELETE FROM', 'WITH', 'AS', 'DISTINCT',
  'AND', 'OR', 'NOT', 'IN', 'LIKE', 'GLOB', 'BETWEEN', 'IS NULL', 'IS NOT NULL',
  'EXISTS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'UNION', 'UNION ALL',
  'CREATE TABLE', 'DROP TABLE', 'ALTER TABLE', 'PRAGMA', 'DESC', 'ASC',
  'NULL', 'TRUE', 'FALSE', 'CAST', 'COLLATE', 'NOCASE'
];

export const SQL_AUTOCOMPLETE_FUNCTIONS = [
  'COUNT(*)', 'COUNT()', 'SUM()', 'AVG()', 'MIN()', 'MAX()',
  'UPPER()', 'LOWER()', 'TRIM()', 'LENGTH()', 'SUBSTR()',
  'COALESCE()', 'IFNULL()', 'NULLIF()', 'ROUND()', 'ABS()',
  'ROW_NUMBER() OVER ()', 'DATE()', 'STRFTIME()', 'GROUP_CONCAT()',
  'NATURAL_KEY()'
];

export async function refreshSqlSchema() {
  try {
    const data = await api('/api/schema');
    if (data && data.tables && data.columns) {
      sqlSchemaCache = data;
    }
  } catch (err) {
    console.info('Could not refresh SQL schema:', err.message);
  }
}

export let sqlAutocompleteState = {
  visible: false,
  selectedIndex: 0,
  items: [],
  query: '',
  startPos: 0,
  endPos: 0
};

export function getCaretPixelPos(textarea, caretIndex) {
  const mirror = document.createElement('div');
  const style = window.getComputedStyle(textarea);
  const props = [
    'direction', 'boxSizing', 'width', 'height', 'overflowX', 'overflowY',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize',
    'fontSizeAdjust', 'lineHeight', 'fontFamily', 'textAlign', 'textTransform',
    'textIndent', 'textDecoration', 'letterSpacing', 'wordSpacing', 'tabSize'
  ];
  props.forEach(p => { mirror.style[p] = style[p]; });
  mirror.style.position = 'absolute';
  mirror.style.top = '0';
  mirror.style.left = '-9999px';
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.wordWrap = 'break-word';

  const text = textarea.value.substring(0, caretIndex);
  mirror.textContent = text;

  const span = document.createElement('span');
  span.textContent = textarea.value.substring(caretIndex, caretIndex + 1) || '.';
  mirror.appendChild(span);

  document.body.appendChild(mirror);
  const top = span.offsetTop - textarea.scrollTop;
  const left = span.offsetLeft - textarea.scrollTop;
  document.body.removeChild(mirror);

  return { top, left };
}

export function hideSqlAutocomplete() {
  const dropdown = document.getElementById('sql-autocomplete-dropdown');
  if (dropdown) dropdown.style.display = 'none';
  sqlAutocompleteState.visible = false;
  sqlAutocompleteState.items = [];
  sqlAutocompleteState.selectedIndex = 0;
  sqlAutocompleteState.query = '';
}

export function applySqlSuggestion(item) {
  const textarea = document.getElementById('sql-input');
  if (!textarea) return;
  const val = textarea.value;
  const before = val.substring(0, sqlAutocompleteState.startPos);
  const after = val.substring(sqlAutocompleteState.endPos);

  let insertion = item.word;
  let cursorOffset = insertion.length;

  if (insertion.endsWith('()')) {
    cursorOffset = insertion.length - 1;
  } else if (insertion.endsWith(' ()')) {
    cursorOffset = insertion.length - 2;
  }

  textarea.value = before + insertion + after;
  const newPos = sqlAutocompleteState.startPos + cursorOffset;
  textarea.setSelectionRange(newPos, newPos);
  textarea.focus();
  hideSqlAutocomplete();
}

export function renderSqlAutocompleteList() {
  const dropdown = document.getElementById('sql-autocomplete-dropdown');
  if (!dropdown || !sqlAutocompleteState.items.length) {
    hideSqlAutocomplete();
    return;
  }

  const query = (sqlAutocompleteState.query || '').toLowerCase();
  dropdown.innerHTML = sqlAutocompleteState.items.map((item, idx) => {
    const isSelected = idx === sqlAutocompleteState.selectedIndex;
    const word = item.word;
    const matchIdx = word.toLowerCase().indexOf(query);
    let wordHtml = escapeHtml(word);
    if (matchIdx !== -1 && query.length > 0) {
      const pre = escapeHtml(word.substring(0, matchIdx));
      const match = escapeHtml(word.substring(matchIdx, matchIdx + query.length));
      const post = escapeHtml(word.substring(matchIdx + query.length));
      wordHtml = `${pre}<span class="match-hl">${match}</span>${post}`;
    }

    return `
      <div class="sql-autocomplete-item ${isSelected ? 'active' : ''}" data-idx="${idx}">
        <div class="sql-autocomplete-word">${wordHtml}</div>
        <span class="sql-autocomplete-badge sql-badge-${item.type}">${item.type}</span>
      </div>
    `;
  }).join('');

  const activeItem = dropdown.querySelector('.sql-autocomplete-item.active');
  if (activeItem) {
    activeItem.scrollIntoView({ block: 'nearest' });
  }

  dropdown.style.display = 'flex';
  sqlAutocompleteState.visible = true;

  dropdown.querySelectorAll('.sql-autocomplete-item').forEach(el => {
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const idx = parseInt(el.getAttribute('data-idx'), 10);
      if (sqlAutocompleteState.items[idx]) {
        applySqlSuggestion(sqlAutocompleteState.items[idx]);
      }
    });
  });
}

export function triggerSqlAutocomplete(forced = false) {
  const textarea = document.getElementById('sql-input');
  const dropdown = document.getElementById('sql-autocomplete-dropdown');
  if (!textarea || !dropdown) return;

  const cursor = textarea.selectionStart;
  const val = textarea.value;
  const textBefore = val.substring(0, cursor);

  const tokenMatch = textBefore.match(/([a-zA-Z0-9_*]+)$/);
  const token = tokenMatch ? tokenMatch[1] : '';

  if (!forced && token.length === 0) {
    hideSqlAutocomplete();
    return;
  }

  const q = token.toLowerCase();
  const suggestions = [];
  const seen = new Set();

  function addItem(word, type, priorityBoost = 0) {
    const wUpper = word.toUpperCase();
    if (seen.has(wUpper)) return;
    seen.add(wUpper);

    const wLower = word.toLowerCase();
    let score = -1;
    if (wLower === q) score = 100;
    else if (wLower.startsWith(q)) score = 80 + priorityBoost - (wLower.length - q.length);
    else if (wLower.includes(q)) score = 40 + priorityBoost;
    else if (forced) score = 10 + priorityBoost;

    if (score > 0) {
      suggestions.push({ word, type, score });
    }
  }

  // 1. Column names from active schema
  const allCols = new Set();
  Object.values(sqlSchemaCache.columns || {}).forEach(cols => cols.forEach(c => allCols.add(c)));
  allCols.forEach(col => addItem(col, 'column', 5));

  // 2. Table names
  (sqlSchemaCache.tables || ['Isolates']).forEach(t => addItem(t, 'table', 8));

  // 3. SQL Keywords
  SQL_AUTOCOMPLETE_KEYWORDS.forEach(kw => addItem(kw, 'keyword', 0));

  // 4. SQL Functions
  SQL_AUTOCOMPLETE_FUNCTIONS.forEach(fn => addItem(fn, 'function', 2));

  if (!suggestions.length) {
    hideSqlAutocomplete();
    return;
  }

  suggestions.sort((a, b) => b.score - a.score);
  const topItems = suggestions.slice(0, 10);

  sqlAutocompleteState.items = topItems;
  sqlAutocompleteState.selectedIndex = 0;
  sqlAutocompleteState.query = token;
  sqlAutocompleteState.startPos = cursor - token.length;
  sqlAutocompleteState.endPos = cursor;

  const caretPos = getCaretPixelPos(textarea, cursor);
  const container = textarea.parentElement;
  const containerWidth = container ? container.clientWidth : 600;
  const dropdownWidth = 300;

  let left = caretPos.left;
  if (left + dropdownWidth > containerWidth - 20) {
    left = Math.max(12, containerWidth - dropdownWidth - 20);
  } else {
    left = Math.max(12, left);
  }

  let top = caretPos.top + 28;
  dropdown.style.left = `${left}px`;
  dropdown.style.top = `${top}px`;

  renderSqlAutocompleteList();
}

export function initSqlAutocomplete() {
  const textarea = document.getElementById('sql-input');
  if (!textarea || textarea.dataset.autocompleteBound) return;
  textarea.dataset.autocompleteBound = 'true';

  textarea.addEventListener('input', () => {
    triggerSqlAutocomplete(false);
  });

  textarea.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.code === 'Space') {
      e.preventDefault();
      triggerSqlAutocomplete(true);
      return;
    }

    if (!sqlAutocompleteState.visible) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      sqlAutocompleteState.selectedIndex =
        (sqlAutocompleteState.selectedIndex + 1) % sqlAutocompleteState.items.length;
      renderSqlAutocompleteList();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      sqlAutocompleteState.selectedIndex =
        (sqlAutocompleteState.selectedIndex - 1 + sqlAutocompleteState.items.length) %
        sqlAutocompleteState.items.length;
      renderSqlAutocompleteList();
    } else if (e.key === 'Tab' || e.key === 'Enter') {
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        applySqlSuggestion(sqlAutocompleteState.items[sqlAutocompleteState.selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      hideSqlAutocomplete();
    }
  });

  textarea.addEventListener('blur', () => {
    setTimeout(hideSqlAutocomplete, 180);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.sql-input-container')) {
      hideSqlAutocomplete();
    }
  });
}

export function insertSQL(sql) {
  hideSqlAutocomplete();
  const input = document.getElementById('sql-input');
  if (input) input.value = sql;
  const res = document.getElementById('sql-result');
  if (res) res.innerHTML = '<span style="color:var(--text3)">Results will appear here…</span>';
  const tbl = document.getElementById('sql-result-table');
  if (tbl) tbl.style.display = 'none';
}

export function clearSQL() {
  hideSqlAutocomplete();
  const input = document.getElementById('sql-input');
  if (input) input.value = '';
  const res = document.getElementById('sql-result');
  if (res) res.innerHTML = '<span style="color:var(--text3)">Results will appear here…</span>';
  const tbl = document.getElementById('sql-result-table');
  if (tbl) tbl.style.display = 'none';
}

export function sortSqlTable(colName) {
  if (!window.currentSqlResult) return;
  const res = window.currentSqlResult;
  if (res.sortCol === colName) {
    res.sortDir = res.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    res.sortCol = colName;
    res.sortDir = 'asc';
  }

  res.rows.sort((a, b) => {
    const va = a[colName];
    const vb = b[colName];
    if (va === null || va === undefined || va === '') return 1;
    if (vb === null || vb === undefined || vb === '') return -1;

    const numA = Number(va);
    const numB = Number(vb);
    if (!isNaN(numA) && !isNaN(numB) && typeof va !== 'boolean' && typeof vb !== 'boolean') {
      return res.sortDir === 'asc' ? numA - numB : numB - numA;
    }

    const strA = String(va);
    const strB = String(vb);
    const cmp = strA.localeCompare(strB, undefined, { numeric: true, sensitivity: 'base' });
    return res.sortDir === 'asc' ? cmp : -cmp;
  });

  renderSqlResultTable();
}

export function renderSqlResultTable() {
  const tableEl = document.getElementById('sql-result-table');
  if (!tableEl || !window.currentSqlResult) return;
  const { columns, rows, sortCol, sortDir } = window.currentSqlResult;

  tableEl.innerHTML = `<table>
    <thead><tr>
      ${columns.map(c => renderSortHeader(escapeHtml(c), c.replace(/'/g, "\\'"), sortCol, sortDir, 'sortSqlTable')).join('')}
    </tr></thead>
    <tbody>${rows.slice(0, 500).map(r =>
      `<tr>${columns.map(c => `<td>${escapeHtml(r[c] !== null && r[c] !== undefined ? String(r[c]) : '—')}</td>`).join('')}</tr>`
    ).join('')}</tbody>
  </table>`;
}

export async function runSQL() {
  const input = document.getElementById('sql-input');
  const sql = input ? input.value.trim() : '';
  if (!sql) return;
  const resultEl = document.getElementById('sql-result');
  const tableEl = document.getElementById('sql-result-table');
  if (resultEl) {
    resultEl.innerHTML = '<div class="loading" style="padding:12px"><div class="spinner"></div> Running…</div>';
    resultEl.className = 'sql-result';
  }
  if (tableEl) tableEl.style.display = 'none';

  const data = await api('/api/custom-sql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql })
  });

  if (!resultEl) return;

  if (data.error) {
    resultEl.className = 'sql-result error';
    resultEl.textContent = '✗ ' + data.error;
    return;
  }

  if (data.type === 'select') {
    const truncated = !!data.truncated;
    resultEl.className = 'sql-result success';
    resultEl.textContent = `✓ ${data.count} row${data.count !== 1 ? 's' : ''} returned${truncated ? ` (first 10,000 shown — add a LIMIT clause for more)` : ''}`;
    if (truncated) resultEl.className = 'sql-result warn';
    if (data.rows.length > 0) {
      if (tableEl) {
        tableEl.style.display = 'block';
        tableEl.scrollLeft = 0;
        tableEl.scrollTop = 0;
      }
      window.currentSqlResult = {
        columns: data.columns,
        rows: [...data.rows],
        sortCol: null,
        sortDir: 'asc'
      };
      renderSqlResultTable();
    }
  } else {
    resultEl.className = 'sql-result success';
    resultEl.textContent = `✓ ${data.changes} row${data.changes !== 1 ? 's' : ''} affected`;
    if (typeof window.loadStats === 'function') {
      window.loadStats();
    }
  }
}
