/**
 * Organism Dictionary & Badge Rendering Utilities
 */

/**
 * Looks up full scientific name for a WHONET organism code.
 * @param {string|number|null|undefined} code 
 * @returns {string}
 */
export function getOrganismName(code) {
  if (!code) return '';
  const key = String(code).trim().toLowerCase();
  if (typeof window !== 'undefined' && window.ORGANISMS_DICT && window.ORGANISMS_DICT[key]) {
    return window.ORGANISMS_DICT[key];
  }
  return '';
}

/**
 * Renders an HTML organism badge with tooltip.
 * @param {string|number|null|undefined} code 
 * @param {string} [extraStyle=''] 
 * @returns {string}
 */
export function renderOrgBadge(code, extraStyle = '') {
  if (!code || code === '—') return '—';
  const name = getOrganismName(code);
  const titleAttr = name ? `title="${name} (${code})"` : `title="${code}"`;
  return `<span class="badge badge-org" ${titleAttr} style="${extraStyle}">${code}</span>`;
}
