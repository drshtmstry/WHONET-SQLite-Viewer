/**
 * Resource Explorer Page Controller
 * Recreates and enhances the AMRIE Resource Explorer in WHONET-SQLite-Viewer.
 * Includes complete AMRIE taxonomic hierarchy, panel-to-member mappings,
 * and organism-specific resolution (e.g. Enterobacterales EBC panel + E. coli species breakpoints).
 */

import { renderSortHeader, renderPagination } from '../ui/table.js';
import { toast } from '../ui/toast.js';
import { naturalCompare } from '../utils/natural-sort.js';
import { escapeHtml, debounce } from '../utils/formatters.js';

// ── Resource Explorer State ──
export const resState = {
  activeTab: 'breakpoints', // 'breakpoints' | 'expert-rules' | 'intrinsic'
  searchQuery: '',
  selectedGuideline: 'All Guidelines',
  selectedTestMethod: 'All Methods',
  selectedBreakpointType: 'All Types',
  selectedYear: '2026',
  selectedOrganism: 'ALL', // 'ALL' or specific code e.g. 'eco', 'EBC', 'sau', 'STA'

  page: 1,
  pageSize: 50,
  sortCol: 'organismCode',
  sortDir: 'asc',

  isLoading: false,
  isLoaded: false,

  metadata: null,
  allBreakpoints: [],
  allExpertRules: [],
  allIntrinsicRules: [],

  filteredItems: []
};

/**
 * Initializes and loads resource data on first visit
 */
export async function initResourceExplorer() {
  if (resState.isLoaded) {
    applyResourceFilters();
    return;
  }

  const container = document.getElementById('resource-explorer-table-container');
  if (container) {
    container.innerHTML = `
      <div class="empty" style="padding: 60px 20px;">
        <i class="fa-solid fa-circle-notch fa-spin" style="font-size: 32px; color: var(--accent); margin-bottom: 16px;"></i>
        <div class="empty-title">Loading Reference Resources…</div>
        <div class="empty-desc">Fetching CLSI, EUCAST clinical panels, species breakpoints, expert interpretation rules and intrinsic resistance profiles.</div>
      </div>
    `;
  }

  resState.isLoading = true;

  try {
    const timestamp = Date.now();
    // 1. Fetch metadata & lookup tables
    const metaRes = await fetch(`/resources/metadata.json?v=${timestamp}`, { cache: 'no-cache' });
    if (!metaRes.ok) throw new Error('Failed to load metadata.json');
    resState.metadata = await metaRes.json();

    // Populate filter dropdown options
    populateFilterDropdowns();

    // 2. Fetch Expert Rules, Intrinsic Rules, and Breakpoints
    const [expRes, intRes, bpRes] = await Promise.all([
      fetch(`/resources/expert-rules.json?v=${timestamp}`, { cache: 'no-cache' }),
      fetch(`/resources/intrinsic-rules.json?v=${timestamp}`, { cache: 'no-cache' }),
      fetch(`/resources/breakpoints.json?v=${timestamp}`, { cache: 'no-cache' })
    ]);

    if (!expRes.ok || !intRes.ok || !bpRes.ok) {
      throw new Error('Failed to load one or more resource files');
    }

    const [expertData, intrinsicData, bpRawRows] = await Promise.all([
      expRes.json(),
      intRes.json(),
      bpRes.json()
    ]);

    // Build pre-indexed Expert Rules
    resState.allExpertRules = expertData.map(r => ({
      ...r,
      searchKey: `${r.ruleCode} ${r.description} ${r.organismCode} ${r.organismName} ${r.affectedAntibiotics} ${r.exceptions}`.toLowerCase()
    }));

    // Build pre-indexed Intrinsic Rules
    resState.allIntrinsicRules = intrinsicData.map(r => ({
      ...r,
      searchKey: `${r.guideline} ${r.organismCode} ${r.organismName} ${r.abxCode} ${r.abxName} ${r.comments}`.toLowerCase()
    }));

    // Build pre-indexed Breakpoint objects
    const orgs = resState.metadata.organisms || {};
    const abx = resState.metadata.antibiotics || {};
    const panelDesc = resState.metadata.panelDescriptions || {};

    resState.allBreakpoints = bpRawRows.map(row => {
      const g = row[0];
      const y = row[1];
      const m = row[2];
      const p = row[3];
      const org = row[4];
      const orgType = row[5];
      const bpType = row[6];
      const site = row[7];
      const refTable = row[8];
      const drug = row[9];
      const test = row[10];
      const r = row[11];
      const i = row[12];
      const sdd = row[13];
      const s = row[14];
      const ecv = row[15];
      const comments = row[16];

      // Resolve human-readable organism/panel name
      let orgName = orgs[org] || orgs[org.toLowerCase()] || panelDesc[org.toUpperCase()] || org;
      const isPanel = orgType !== 'WHONET_ORG_CODE' && orgType !== '';

      const searchKey = `${org} ${orgName} ${orgType} ${refTable} ${drug} ${abx[drug] || ''} ${g} ${m} ${bpType} ${site} ${comments}`.toLowerCase();

      return {
        guidelines: g,
        year: y,
        testMethod: m,
        potency: p,
        organismCode: org,
        organismCodeType: orgType,
        organismName: orgName,
        isPanel,
        breakpointType: bpType,
        siteOfInfection: site,
        referenceTable: refTable,
        abxCode: drug,
        abxName: abx[drug] || drug,
        whonetTest: test,
        r,
        i,
        sdd,
        s,
        ecvEcoff: ecv,
        comments,
        searchKey
      };
    });

    resState.isLoaded = true;
    resState.isLoading = false;

    applyResourceFilters();
  } catch (err) {
    console.error('Error loading resources:', err);
    resState.isLoading = false;
    if (container) {
      container.innerHTML = `
        <div class="empty" style="padding: 50px 20px;">
          <i class="fa-solid fa-triangle-exclamation" style="font-size: 32px; color: var(--red); margin-bottom: 12px;"></i>
          <div class="empty-title">Failed to Load Resources</div>
          <div class="empty-desc">${escapeHtml(err.message)}</div>
          <button class="btn btn-primary" onclick="initResourceExplorer()" style="margin-top: 14px;">Retry</button>
        </div>
      `;
    }
  }
}

/**
 * Populates dropdown options for Guideline, Test Method, Type, Year, and Organisms/Panels
 */
function populateFilterDropdowns() {
  const guideSel = document.getElementById('res-guideline-filter');
  const methodSel = document.getElementById('res-method-filter');
  const typeSel = document.getElementById('res-type-filter');
  const yearSel = document.getElementById('res-year-filter');
  const orgSel = document.getElementById('res-organism-filter');

  if (guideSel) {
    guideSel.innerHTML = '<option value="All Guidelines">All Guidelines</option>' +
      (resState.metadata.guidelines || []).map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
    guideSel.value = resState.selectedGuideline;
  }

  if (methodSel) {
    methodSel.innerHTML = '<option value="All Methods">All Methods</option>' +
      (resState.metadata.testMethods || []).map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
    methodSel.value = resState.selectedTestMethod;
  }

  if (typeSel) {
    typeSel.innerHTML = '<option value="All Types">All Types</option>' +
      (resState.metadata.breakpointTypes || []).map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    typeSel.value = resState.selectedBreakpointType;
  }

  if (yearSel) {
    const years = resState.metadata.years || [];
    let html = '<option value="All Years">All Years</option>';
    years.forEach(y => {
      html += `<option value="${y}">${y}</option>`;
    });
    yearSel.innerHTML = html;
    const defaultYear = (resState.metadata.defaultYear || 2026).toString();
    if (years.map(String).includes(defaultYear)) {
      resState.selectedYear = defaultYear;
    } else {
      resState.selectedYear = 'All Years';
    }
    yearSel.value = resState.selectedYear;
  }

  if (orgSel) {
    const popular = resState.metadata.popularOrganisms || [];
    const clinicalPanels = resState.metadata.clinicalPanels || [];
    const clinicalOrgs = resState.metadata.clinicalOrganisms || [];

    let html = '<option value="ALL">All Organisms &amp; Panels</option>';

    if (clinicalPanels.length) {
      html += '<optgroup label="Clinical Panels (Group Breakpoints)">';
      clinicalPanels.forEach(item => {
        html += `<option value="${escapeHtml(item.code)}">${escapeHtml(item.code)} — ${escapeHtml(item.name)}</option>`;
      });
      html += '</optgroup>';
    }

    if (clinicalOrgs.length) {
      html += '<optgroup label="Common Pathogens (Panel + Species Breakpoints)">';
      clinicalOrgs.forEach(item => {
        html += `<option value="${escapeHtml(item.code)}">${escapeHtml(item.code)} — ${escapeHtml(item.name)}</option>`;
      });
      html += '</optgroup>';
    } else if (popular.length) {
      html += '<optgroup label="Clinical Panels &amp; Common Organisms">';
      popular.forEach(item => {
        html += `<option value="${escapeHtml(item.code)}">${escapeHtml(item.code)} — ${escapeHtml(item.name)}</option>`;
      });
      html += '</optgroup>';
    }

    orgSel.innerHTML = html;
    orgSel.value = resState.selectedOrganism;
  }
}

/**
 * Switches the active section tab: 'breakpoints' | 'expert-rules' | 'intrinsic'
 */
export function setResourceExplorerSection(tabName) {
  if (resState.activeTab === tabName) return;
  resState.activeTab = tabName;
  resState.page = 1;
  resState.searchQuery = '';

  const searchInput = document.getElementById('res-search');
  if (searchInput) searchInput.value = '';

  // Update tab buttons
  document.querySelectorAll('.resource-tab-btn').forEach(btn => {
    const isActive = btn.dataset.tab === tabName;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  // Toggle filter visibility (Method, Type, Year, Organism are specific to Breakpoints)
  const isBp = tabName === 'breakpoints';
  const methodSel = document.getElementById('res-method-filter');
  const typeSel = document.getElementById('res-type-filter');
  const yearSel = document.getElementById('res-year-filter');
  const orgSel = document.getElementById('res-organism-filter');

  if (methodSel) methodSel.style.display = isBp ? '' : 'none';
  if (typeSel) typeSel.style.display = isBp ? '' : 'none';
  if (yearSel) yearSel.style.display = isBp ? '' : 'none';
  if (orgSel) orgSel.style.display = isBp ? '' : 'none';

  // Default sorting
  if (tabName === 'breakpoints') {
    resState.sortCol = 'organismCode';
  } else if (tabName === 'expert-rules') {
    resState.sortCol = 'ruleCode';
  } else {
    resState.sortCol = 'organismCode';
  }
  resState.sortDir = 'asc';

  applyResourceFilters();
}

/**
 * Helper to determine if a breakpoint matches a queried organism or panel
 * using AMRIE's taxonomic hierarchy.
 */
function matchesOrganismWithPanels(b, targetCode, memberToPanels, panelToMembers) {
  const tUpper = targetCode.toUpperCase();
  const tLower = targetCode.toLowerCase();
  const bpOrgUpper = b.organismCode.toUpperCase();
  const bpOrgLower = b.organismCode.toLowerCase();

  // 1. Direct match on organism or panel code
  if (bpOrgUpper === tUpper || bpOrgLower === tLower) return true;

  // 2. If target is a member organism (e.g. 'eco', 'sau', 'kpn'):
  // Check if breakpoint is a parent panel of target (e.g. 'EBC', 'STA', 'ENT')
  const parentPanels = memberToPanels[tLower];
  if (parentPanels && parentPanels.includes(bpOrgUpper)) {
    return true;
  }

  // 3. If target is a panel (e.g. 'EBC', 'STA', 'ENT'):
  // Check if breakpoint is a member species of this panel
  const members = panelToMembers[tUpper];
  if (members && members.includes(bpOrgLower)) {
    return true;
  }

  return false;
}

/**
 * Applies active filters, sorts, and renders the current page
 */
export function applyResourceFilters() {
  if (!resState.isLoaded) return;

  const q = resState.searchQuery.trim().toLowerCase();
  const guideline = resState.selectedGuideline;
  const memberToPanels = resState.metadata?.memberToPanels || {};
  const panelToMembers = {};
  for (const [m, panels] of Object.entries(memberToPanels)) {
    panels.forEach(p => {
      if (!panelToMembers[p]) panelToMembers[p] = [];
      panelToMembers[p].push(m);
    });
  }

  let list = [];

  if (resState.activeTab === 'breakpoints') {
    const method = resState.selectedTestMethod;
    const type = resState.selectedBreakpointType;
    const yearStr = resState.selectedYear;
    const targetYear = yearStr !== 'All Years' ? parseInt(yearStr, 10) : null;
    const targetOrg = resState.selectedOrganism;

    // Check if query corresponds to a specific organism code or organism name with parent panels
    const queryPanels = new Set();
    if (q) {
      if (memberToPanels[q]) {
        memberToPanels[q].forEach(p => queryPanels.add(p.toUpperCase()));
      }
      const orgLookup = resState.metadata?.organisms || {};
      for (const [code, name] of Object.entries(orgLookup)) {
        if (code.toLowerCase() === q || name.toLowerCase().includes(q)) {
          const panels = memberToPanels[code.toLowerCase()];
          if (panels) {
            panels.forEach(p => queryPanels.add(p.toUpperCase()));
          }
        }
      }
    }

    list = resState.allBreakpoints.filter(b => {
      if (guideline !== 'All Guidelines' && b.guidelines.toLowerCase() !== guideline.toLowerCase()) return false;
      if (method !== 'All Methods' && b.testMethod.toLowerCase() !== method.toLowerCase()) return false;
      if (type !== 'All Types' && b.breakpointType.toLowerCase() !== type.toLowerCase()) return false;
      if (targetYear !== null && b.year !== targetYear) return false;

      // Filter by selected Organism / Panel dropdown
      if (targetOrg !== 'ALL') {
        if (!matchesOrganismWithPanels(b, targetOrg, memberToPanels, panelToMembers)) {
          return false;
        }
      }

      // Filter by Search Query
      if (q) {
        // Direct string match
        if (b.searchKey.includes(q)) return true;

        // AMRIE Taxonomic Search: If query matches an organism, include parent panel breakpoints
        if (queryPanels.size > 0 && queryPanels.has(b.organismCode.toUpperCase())) {
          return true;
        }

        return false;
      }

      return true;
    });

    // Update count message with panel & species breakdown
    const countEl = document.getElementById('res-count-msg');
    if (countEl) {
      if (targetOrg !== 'ALL') {
        const panelsCount = list.filter(item => item.isPanel).length;
        const speciesCount = list.length - panelsCount;
        const orgs = resState.metadata?.organisms || {};
        const panelDesc = resState.metadata?.panelDescriptions || {};
        const orgLabel = orgs[targetOrg] || orgs[targetOrg.toLowerCase()] || panelDesc[targetOrg.toUpperCase()] || targetOrg;
        countEl.textContent = `Showing ${list.length.toLocaleString()} breakpoints (${panelsCount} panel, ${speciesCount} species-specific) for ${targetOrg} (${orgLabel})`;
      } else {
        countEl.textContent = yearStr !== 'All Years'
          ? `Showing ${list.length.toLocaleString()} breakpoints for year ${yearStr}`
          : `Showing ${list.length.toLocaleString()} of ${resState.allBreakpoints.length.toLocaleString()} breakpoints`;
      }
    }
  } else if (resState.activeTab === 'expert-rules') {
    list = resState.allExpertRules.filter(r => {
      if (guideline !== 'All Guidelines') {
        const matchesGuide = (r.ruleCode + ' ' + r.description).toLowerCase().includes(guideline.toLowerCase());
        if (!matchesGuide) return false;
      }
      if (q && !r.searchKey.includes(q)) return false;
      return true;
    });

    const countEl = document.getElementById('res-count-msg');
    if (countEl) {
      countEl.textContent = `Showing ${list.length.toLocaleString()} expert rule${list.length === 1 ? '' : 's'}`;
    }
  } else if (resState.activeTab === 'intrinsic') {
    list = resState.allIntrinsicRules.filter(r => {
      if (guideline !== 'All Guidelines' && r.guideline.toLowerCase() !== guideline.toLowerCase()) return false;
      if (q && !r.searchKey.includes(q)) return false;
      return true;
    });

    const countEl = document.getElementById('res-count-msg');
    if (countEl) {
      countEl.textContent = `Showing ${list.length.toLocaleString()} intrinsic resistance rule${list.length === 1 ? '' : 's'}`;
    }
  }

  // Sort
  const col = resState.sortCol;
  const dir = resState.sortDir === 'desc' ? -1 : 1;

  list.sort((a, b) => {
    let valA = a[col];
    let valB = b[col];

    if (valA === undefined || valA === null) valA = '';
    if (valB === undefined || valB === null) valB = '';

    if (typeof valA === 'number' && typeof valB === 'number') {
      return (valA - valB) * dir;
    }
    return naturalCompare(String(valA), String(valB)) * dir;
  });

  resState.filteredItems = list;
  renderResourceTable();
}

/**
 * Changes sort column
 */
export function sortResourceTable(colName) {
  if (resState.sortCol === colName) {
    resState.sortDir = resState.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    resState.sortCol = colName;
    resState.sortDir = 'asc';
  }
  applyResourceFilters();
}

/**
 * Go to a specific page (no-op as pagination is replaced by continuous scrolling)
 */
export function setResourcePage() {
  // Continuous single table scrolling enabled
}

/**
 * Format helper for Scope badge (Panel vs Species)
 */
function renderScopeBadge(codeType, isPanel) {
  if (!codeType) return '';
  if (codeType === 'FAMILY_CODE') {
    return '<span class="badge badge-panel" title="Family Panel Breakpoint">Family Panel</span>';
  }
  if (codeType === 'GENUS_CODE') {
    return '<span class="badge badge-panel" title="Genus Panel Breakpoint">Genus Panel</span>';
  }
  if (codeType === 'SPECIES_GROUP' || codeType === 'GENUS_GROUP') {
    return '<span class="badge badge-panel" title="Group Panel Breakpoint">Group Panel</span>';
  }
  if (codeType === 'ANAEROBE') {
    return '<span class="badge badge-panel" title="Anaerobic Panel Breakpoint">Anaerobe Panel</span>';
  }
  if (codeType === 'WHONET_ORG_CODE') {
    return '<span class="badge badge-species" title="Organism-Specific Breakpoint">Species-Specific</span>';
  }
  if (isPanel) {
    return '<span class="badge badge-panel">Panel</span>';
  }
  return '<span class="badge badge-subtle">' + escapeHtml(codeType) + '</span>';
}

/**
 * Format helper for Resistant breakpoint
 */
function formatRDisplay(r, testMethod) {
  if (r <= 0) return '<span style="color:var(--text4);">-</span>';
  const isDisk = String(testMethod).trim().toUpperCase() === 'DISK';
  const op = isDisk ? '≤' : '≥';
  return `<span class="res-bp-r">${op} ${r}</span>`;
}

/**
 * Format helper for Susceptible breakpoint
 */
function formatSDisplay(s, testMethod) {
  if (s <= 0) return '<span style="color:var(--text4);">-</span>';
  const isDisk = String(testMethod).trim().toUpperCase() === 'DISK';
  const op = isDisk ? '≥' : '≤';
  return `<span class="res-bp-s">${op} ${s}</span>`;
}

/**
 * Format helper for ECV/ECOFF
 */
function formatEcvDisplay(ecv) {
  if (ecv <= 0) return '<span style="color:var(--text4);">-</span>';
  return `<span class="res-bp-ecv">≤ ${ecv}</span>`;
}

/**
 * Renders the table content as a single continuous scrollable table
 */
function renderResourceTable() {
  const container = document.getElementById('resource-explorer-table-container');
  if (!container) return;

  const total = resState.filteredItems.length;
  const pageItems = resState.filteredItems;

  if (total === 0) {
    container.innerHTML = `
      <div class="empty" style="padding: 60px 20px;">
        <i class="fa-solid fa-magnifying-glass" style="font-size: 32px; color: var(--text3); margin-bottom: 12px;"></i>
        <div class="empty-title">No matching records found</div>
        <div class="empty-desc">Try adjusting your organism selection, search terms or filter criteria.</div>
      </div>
    `;
    return;
  }

  let tableHtml = '';

  if (resState.activeTab === 'breakpoints') {
    tableHtml = `
      <table class="res-explorer-table">
        <thead>
          <tr>
            ${renderSortHeader('Guide', 'guidelines', resState.sortCol, resState.sortDir, 'sortResourceTable', 'style="width: 75px;"')}
            ${renderSortHeader('Year', 'year', resState.sortCol, resState.sortDir, 'sortResourceTable', 'style="width: 65px;"')}
            ${renderSortHeader('Method', 'testMethod', resState.sortCol, resState.sortDir, 'sortResourceTable', 'style="width: 80px;"')}
            ${renderSortHeader('Potency', 'potency', resState.sortCol, resState.sortDir, 'sortResourceTable', 'style="width: 80px;"')}
            ${renderSortHeader('Organism / Panel', 'organismCode', resState.sortCol, resState.sortDir, 'sortResourceTable', 'style="min-width: 220px;"')}
            ${renderSortHeader('Type', 'breakpointType', resState.sortCol, resState.sortDir, 'sortResourceTable', 'style="width: 80px;"')}
            ${renderSortHeader('Antibiotic', 'abxCode', resState.sortCol, resState.sortDir, 'sortResourceTable', 'style="min-width: 190px;"')}
            ${renderSortHeader('R', 'r', resState.sortCol, resState.sortDir, 'sortResourceTable', 'style="width: 75px; text-align: center;"')}
            ${renderSortHeader('I', 'i', resState.sortCol, resState.sortDir, 'sortResourceTable', 'style="width: 70px; text-align: center;"')}
            ${renderSortHeader('SDD', 'sdd', resState.sortCol, resState.sortDir, 'sortResourceTable', 'style="width: 65px; text-align: center;"')}
            ${renderSortHeader('S', 's', resState.sortCol, resState.sortDir, 'sortResourceTable', 'style="width: 75px; text-align: center;"')}
            ${renderSortHeader('ECV', 'ecvEcoff', resState.sortCol, resState.sortDir, 'sortResourceTable', 'style="width: 75px; text-align: center;"')}
            ${renderSortHeader('Scope', 'organismCodeType', resState.sortCol, resState.sortDir, 'sortResourceTable', 'style="width: 120px;"')}
            ${renderSortHeader('Site', 'siteOfInfection', resState.sortCol, resState.sortDir, 'sortResourceTable', 'style="min-width: 110px;"')}
            ${renderSortHeader('Ref Table', 'referenceTable', resState.sortCol, resState.sortDir, 'sortResourceTable', 'style="min-width: 140px;"')}
            ${renderSortHeader('Comments', 'comments', resState.sortCol, resState.sortDir, 'sortResourceTable', 'style="min-width: 160px;"')}
          </tr>
        </thead>
        <tbody>
          ${pageItems.map(b => `
            <tr class="${b.isPanel ? 'row-panel-breakpoint' : 'row-species-breakpoint'}">
              <td><span class="badge badge-subtle">${escapeHtml(b.guidelines)}</span></td>
              <td style="font-variant-numeric: tabular-nums; font-weight: 500;">${b.year}</td>
              <td><span class="badge badge-outline">${escapeHtml(b.testMethod)}</span></td>
              <td style="font-size: 12px; color: var(--text3);">${escapeHtml(b.potency || '-')}</td>
              <td>
                <div class="res-item-cell">
                  <span class="res-code">${escapeHtml(b.organismCode)}</span>
                  <span class="res-name" title="${escapeHtml(b.organismName)}">${escapeHtml(b.organismName)}</span>
                  ${b.isPanel && resState.selectedOrganism !== 'ALL' && resState.selectedOrganism.toUpperCase() !== b.organismCode.toUpperCase() ? `
                    <span class="res-panel-note" style="font-size: 11px; color: var(--accent); margin-top: 2px; font-weight: 500;">
                      ↳ Applies to ${escapeHtml(resState.selectedOrganism)} via ${escapeHtml(b.organismCode)} panel
                    </span>
                  ` : ''}
                </div>
              </td>
              <td><span style="font-size: 12px;">${escapeHtml(b.breakpointType)}</span></td>
              <td>
                <div class="res-item-cell">
                  <span class="res-code">${escapeHtml(b.abxCode)}</span>
                  <span class="res-name" title="${escapeHtml(b.abxName)}">${escapeHtml(b.abxName)}</span>
                </div>
              </td>
              <td style="text-align: center;">${formatRDisplay(b.r, b.testMethod)}</td>
              <td style="text-align: center; font-variant-numeric: tabular-nums;">${escapeHtml(b.i || '-')}</td>
              <td style="text-align: center; font-variant-numeric: tabular-nums;">${escapeHtml(b.sdd || '-')}</td>
              <td style="text-align: center;">${formatSDisplay(b.s, b.testMethod)}</td>
              <td style="text-align: center;">${formatEcvDisplay(b.ecvEcoff)}</td>
              <td>${renderScopeBadge(b.organismCodeType, b.isPanel)}</td>
              <td><span style="font-size: 12px; color: var(--text2);" title="${escapeHtml(b.siteOfInfection)}">${escapeHtml(b.siteOfInfection || '-')}</span></td>
              <td style="font-size: 11.5px; color: var(--text3); white-space: nowrap;" title="${escapeHtml(b.referenceTable)}">${escapeHtml(b.referenceTable || '-')}</td>
              <td style="font-size: 12px; color: var(--text3);" title="${escapeHtml(b.comments)}">${escapeHtml(b.comments || '-')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } else if (resState.activeTab === 'expert-rules') {
    tableHtml = `
      <table class="res-explorer-table">
        <thead>
          <tr>
            ${renderSortHeader('Rule Code', 'ruleCode', resState.sortCol, resState.sortDir, 'sortResourceTable', 'style="width: 180px;"')}
            ${renderSortHeader('Organism', 'organismCode', resState.sortCol, resState.sortDir, 'sortResourceTable', 'style="min-width: 200px;"')}
            ${renderSortHeader('Affected Drugs', 'affectedAntibiotics', resState.sortCol, resState.sortDir, 'sortResourceTable', 'style="min-width: 220px;"')}
            ${renderSortHeader('Exceptions', 'exceptions', resState.sortCol, resState.sortDir, 'sortResourceTable', 'style="min-width: 160px;"')}
            ${renderSortHeader('Description & Criteria', 'description', resState.sortCol, resState.sortDir, 'sortResourceTable', 'style="min-width: 280px;"')}
          </tr>
        </thead>
        <tbody>
          ${pageItems.map(r => `
            <tr>
              <td><span class="badge badge-accent" style="font-family: var(--font-mono); font-size: 12px;">${escapeHtml(r.ruleCode)}</span></td>
              <td>
                <div class="res-item-cell">
                  <span class="res-code">${escapeHtml(r.organismCode)}</span>
                  <span class="res-name" title="${escapeHtml(r.organismName)}">${escapeHtml(r.organismName)}</span>
                </div>
              </td>
              <td style="font-size: 13px; line-height: 1.4;">${escapeHtml(r.affectedAntibiotics || '-')}</td>
              <td style="font-size: 13px; color: var(--text3); line-height: 1.4;">${escapeHtml(r.exceptions || '-')}</td>
              <td>
                <div style="font-size: 13px; font-weight: 500; margin-bottom: 3px;">${escapeHtml(r.description)}</div>
                ${r.criteria ? `<div style="font-size: 11px; font-family: var(--font-mono); color: var(--text3);">${escapeHtml(r.criteria)}</div>` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } else if (resState.activeTab === 'intrinsic') {
    tableHtml = `
      <table class="res-explorer-table">
        <thead>
          <tr>
            ${renderSortHeader('Guideline', 'guideline', resState.sortCol, resState.sortDir, 'sortResourceTable', 'style="width: 110px;"')}
            ${renderSortHeader('Organism', 'organismCode', resState.sortCol, resState.sortDir, 'sortResourceTable', 'style="min-width: 220px;"')}
            ${renderSortHeader('Antibiotic', 'abxCode', resState.sortCol, resState.sortDir, 'sortResourceTable', 'style="min-width: 220px;"')}
            ${renderSortHeader('Exceptions', 'exceptions', resState.sortCol, resState.sortDir, 'sortResourceTable', 'style="min-width: 180px;"')}
            ${renderSortHeader('Comments', 'comments', resState.sortCol, resState.sortDir, 'sortResourceTable', 'style="min-width: 240px;"')}
          </tr>
        </thead>
        <tbody>
          ${pageItems.map(r => `
            <tr>
              <td><span class="badge badge-subtle">${escapeHtml(r.guideline)}</span></td>
              <td>
                <div class="res-item-cell">
                  <span class="res-code">${escapeHtml(r.organismCode)}</span>
                  <span class="res-name" title="${escapeHtml(r.organismName)}">${escapeHtml(r.organismName)}</span>
                </div>
              </td>
              <td>
                <div class="res-item-cell">
                  <span class="res-code">${escapeHtml(r.abxCode)}</span>
                  <span class="res-name" title="${escapeHtml(r.abxName)}">${escapeHtml(r.abxName)}</span>
                </div>
              </td>
              <td style="font-size: 13px; color: var(--text3);">${escapeHtml(r.exceptions || '-')}</td>
              <td style="font-size: 12px; color: var(--text3);" title="${escapeHtml(r.comments)}">${escapeHtml(r.comments || '-')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  container.innerHTML = tableHtml;
}

// ── Search & Filter Listeners ──

export const debouncedResourceSearch = debounce(() => {
  const input = document.getElementById('res-search');
  if (input) {
    resState.searchQuery = input.value;
    resState.page = 1;
    applyResourceFilters();
  }
}, 200);

export function onResourceGuidelineChange() {
  const sel = document.getElementById('res-guideline-filter');
  if (sel) {
    resState.selectedGuideline = sel.value;
    resState.page = 1;
    applyResourceFilters();
  }
}

export function onResourceOrganismChange(event) {
  const val = event?.target?.value || document.getElementById('res-organism-filter')?.value;
  if (val !== undefined) {
    resState.selectedOrganism = val;
    resState.page = 1;
    applyResourceFilters();
  }
}

export function onResourceMethodChange() {
  const sel = document.getElementById('res-method-filter');
  if (sel) {
    resState.selectedTestMethod = sel.value;
    resState.page = 1;
    applyResourceFilters();
  }
}

export function onResourceTypeChange() {
  const sel = document.getElementById('res-type-filter');
  if (sel) {
    resState.selectedBreakpointType = sel.value;
    resState.page = 1;
    applyResourceFilters();
  }
}

export function onResourceYearChange() {
  const sel = document.getElementById('res-year-filter');
  if (sel) {
    resState.selectedYear = sel.value;
    resState.page = 1;
    applyResourceFilters();
  }
}

// ── Export & Copy Utilities ──

/**
 * Copies the current filtered table records as TSV to the clipboard
 */
export async function copyResourceTableTsv() {
  const items = resState.filteredItems;
  if (!items || items.length === 0) {
    toast('No data to copy', 'warning');
    return;
  }

  let headers = [];
  let rows = [];

  if (resState.activeTab === 'breakpoints') {
    headers = ['Guidelines', 'Year', 'Test Method', 'Potency', 'Organism / Panel Code', 'Organism Name', 'Breakpoint Type', 'Antibiotic Code', 'Antibiotic Name', 'R', 'I', 'SDD', 'S', 'ECV/ECOFF', 'Scope', 'Site of Infection', 'Reference Table', 'Comments'];
    rows = items.map(b => [
      b.guidelines,
      b.year,
      b.testMethod,
      b.potency,
      b.organismCode,
      b.organismName,
      b.breakpointType,
      b.abxCode,
      b.abxName,
      b.r > 0 ? (b.testMethod.toUpperCase() === 'DISK' ? `<=${b.r}` : `>=${b.r}`) : '',
      b.i,
      b.sdd,
      b.s > 0 ? (b.testMethod.toUpperCase() === 'DISK' ? `>=${b.s}` : `<=${b.s}`) : '',
      b.ecvEcoff > 0 ? `<=${b.ecvEcoff}` : '',
      b.organismCodeType,
      b.siteOfInfection,
      b.referenceTable,
      b.comments
    ]);
  } else if (resState.activeTab === 'expert-rules') {
    headers = ['Rule Code', 'Organism Code', 'Organism Name', 'Affected Antibiotics', 'Exceptions', 'Description', 'Criteria'];
    rows = items.map(r => [
      r.ruleCode,
      r.organismCode,
      r.organismName,
      r.affectedAntibiotics,
      r.exceptions,
      r.description,
      r.criteria
    ]);
  } else if (resState.activeTab === 'intrinsic') {
    headers = ['Guideline', 'Organism Code', 'Organism Name', 'Antibiotic Code', 'Antibiotic Name', 'Exceptions', 'Comments'];
    rows = items.map(r => [
      r.guideline,
      r.organismCode,
      r.organismName,
      r.abxCode,
      r.abxName,
      r.exceptions,
      r.comments
    ]);
  }

  const tsv = [
    headers.join('\t'),
    ...rows.map(r => r.map(c => String(c ?? '').replace(/\t/g, ' ')).join('\t'))
  ].join('\n');

  // Build Excel-compliant HTML table with mso-number-format:'\@'
  // This prevents Excel from auto-converting breakpoint ranges (like 12-14 or 11-13) into calendar dates (Dec-14 / Nov-13)
  const htmlRows = rows.map(r => {
    return '<tr>' + r.map(c => {
      const val = escapeHtml(String(c ?? ''));
      return `<td style="mso-number-format:'\\@';">${val}</td>`;
    }).join('') + '</tr>';
  }).join('');

  const htmlTable = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  table { border-collapse: collapse; font-family: Calibri, Arial, sans-serif; }
  th { background-color: #f1f5f9; font-weight: bold; border: 1px solid #cbd5e1; padding: 4px 8px; }
  td { border: 1px solid #cbd5e1; padding: 4px 8px; mso-number-format: '\\@'; }
</style>
</head>
<body>
<table>
  <thead>
    <tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr>
  </thead>
  <tbody>
    ${htmlRows}
  </tbody>
</table>
</body>
</html>`;

  try {
    if (navigator.clipboard && window.ClipboardItem) {
      const blobHtml = new Blob([htmlTable], { type: 'text/html' });
      const blobText = new Blob([tsv], { type: 'text/plain' });
      const item = new ClipboardItem({
        'text/html': blobHtml,
        'text/plain': blobText
      });
      await navigator.clipboard.write([item]);
    } else {
      await navigator.clipboard.writeText(tsv);
    }
    toast(`Copied ${items.length.toLocaleString()} rows to clipboard (ready for Excel)`, 'success');
  } catch (err) {
    try {
      await navigator.clipboard.writeText(tsv);
      toast(`Copied ${items.length.toLocaleString()} rows to clipboard`, 'success');
    } catch (fallbackErr) {
      console.error('Clipboard copy failed:', err, fallbackErr);
      toast('Failed to copy to clipboard', 'error');
    }
  }
}
