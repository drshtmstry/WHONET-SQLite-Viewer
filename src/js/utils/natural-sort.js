/**
 * Universal Natural Alphanumeric Sorting Utilities
 * Supports any laboratory specimen or accession numbering format:
 * - Hyphenated with sub-suffixes: CSR-1, CSR-1-A, CSR-1-1, CSR-1-10, CSR-151
 * - Slashes: 2024/01/1, 2024/01/15, 2024/01/100
 * - Periods: SP.1, SP.2, SP.151
 * - Direct alphanumeric: ISO1A, ISO2A, ISO10A, ISO100A
 * - Space-separated: LAB 1, LAB 2, LAB 151
 */

/**
 * Generates a normalized sorting key where all numeric runs are zero-padded to 12 digits.
 * Used for SQL queries (both Node DatabaseSync and sql.js WASM).
 * @param {string|number|null|undefined} str 
 * @returns {string}
 */
export function naturalKey(str) {
  if (str === null || str === undefined) return '';
  return String(str).toLowerCase().replace(/\d+/g, (m) => m.padStart(12, '0'));
}

/**
 * Universal in-memory natural comparator for JavaScript arrays.
 * @param {*} a 
 * @param {*} b 
 * @param {'asc'|'desc'} [direction='asc'] 
 * @returns {number}
 */
export function naturalCompare(a, b, direction = 'asc') {
  if (a === null || a === undefined || a === '') return 1;
  if (b === null || b === undefined || b === '') return -1;

  // Direct numeric comparison if both are valid numbers
  const numA = Number(a);
  const numB = Number(b);
  if (!isNaN(numA) && !isNaN(numB) && typeof a !== 'boolean' && typeof b !== 'boolean') {
    return direction === 'asc' ? numA - numB : numB - numA;
  }

  // Natural alphanumeric comparison
  const strA = String(a);
  const strB = String(b);
  const cmp = strA.localeCompare(strB, undefined, { numeric: true, sensitivity: 'base' });
  return direction === 'asc' ? cmp : -cmp;
}
