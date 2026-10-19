import { state } from '../state/store.js';
import { api } from '../api/client.js';
import { toast } from '../ui/toast.js';
import { getSpecimenName } from '../utils/specimens.js';
import { escapeHtml } from '../utils/formatters.js';

let currentReportData = null;
let currentGroupByClass = true; // default CLSI Appendix E2 (By Drug Class)
let currentMetric = 'S'; // 'S' = % Susceptible, 'R' = % Resistant
let hideUnder30 = true; // default CLSI M39 threshold filter (only report species with >= 30 isolates)

export function setAntibiogramMetric(metric) {
  currentMetric = metric;
  const btnS = document.getElementById('btn-abx-metric-s');
  const btnR = document.getElementById('btn-abx-metric-r');
  if (btnS) btnS.classList.toggle('active', metric === 'S');
  if (btnR) btnR.classList.toggle('active', metric === 'R');
  renderAntibiogramTable();
}

export async function loadAntibiogram() {
  if (!state.currentDb) return;
  const container = document.getElementById('antibiogram-table-container');
  if (container) {
    container.innerHTML = `
      <div style="padding: 48px; text-align: center; color: var(--text3);">
        <i class="fa-solid fa-spinner fa-spin" style="font-size: 24px; color: var(--accent); margin-bottom: 12px;"></i>
        <div style="font-size: 14px; font-weight: 600;">Generating CLSI M39 Cumulative Antibiogram…</div>
        <div style="font-size: 12px; margin-top: 4px;">Deduplicating first isolates and applying AMRIE breakpoint rules…</div>
      </div>
    `;
  }

  const minIsolatesEl = document.getElementById('abx-min-isolates');
  const minIsolates = minIsolatesEl ? parseInt(minIsolatesEl.value || '30', 10) : 30;
  const wardEl = document.getElementById('abx-ward-filter');
  const ward = wardEl ? wardEl.value : '';
  const specEl = document.getElementById('abx-spec-filter');
  const spec = specEl ? specEl.value : '';

  const queryParams = new URLSearchParams({
    minIsolates: String(minIsolates)
  });
  if (ward) queryParams.set('ward', ward);
  if (spec) queryParams.set('specType', spec);

  const res = await api(`/api/antibiogram?${queryParams.toString()}`);
  if (res.error) {
    if (container) {
      container.innerHTML = `
        <div style="padding: 32px; text-align: center; color: var(--red);">
          <i class="fa-solid fa-circle-exclamation" style="font-size: 24px; margin-bottom: 8px;"></i>
          <div>${res.error}</div>
        </div>
      `;
    }
    return toast(res.error, 'error');
  }

  currentReportData = res;
  updateAntibiogramMetaHeader(res);
  renderAntibiogramTable();
}

function updateAntibiogramMetaHeader(data) {
  const metaEl = document.getElementById('antibiogram-meta-banner');
  if (!metaEl) return;

  const labLabel = data.labName || data.labConfigFile || 'Standard CLSI M100';
  const orgCount = data.organisms ? data.organisms.length : 0;
  const qualifiedCount = data.organisms ? data.organisms.filter(o => o.meetsThreshold).length : 0;

  const specEl = document.getElementById('abx-spec-filter');
  const selectedSpec = specEl ? specEl.value : '';
  const specName = selectedSpec ? (getSpecimenName(selectedSpec) || selectedSpec) : '';
  const specBadge = specName ? `
    <div style="display: flex; align-items: center; gap: 6px;">
      <span style="font-weight: 700; color: var(--text);"><i class="fa-solid fa-vial" style="color: var(--accent);"></i> Specimen:</span>
      <span class="badge" style="background: var(--bg3); color: var(--text); border: 1px solid var(--border); padding: 3px 8px; border-radius: 4px; font-weight: 600;">${escapeHtml(specName)} (${escapeHtml(selectedSpec)})</span>
    </div>
  ` : '';

  const orgAnalysisLabel = hideUnder30
    ? `Showing <strong style="color:var(--text);">${qualifiedCount}</strong> with ≥ ${data.minIsolatesThreshold} isolates (${orgCount} total)`
    : `Showing all <strong style="color:var(--text);">${orgCount}</strong> (<strong style="color:var(--text);">${qualifiedCount}</strong> with ≥ ${data.minIsolatesThreshold} isolates)`;

  metaEl.innerHTML = `
    <div style="display: flex; flex-wrap: wrap; gap: 16px; align-items: center; justify-content: space-between; font-size: 12.5px;">
      <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-weight: 700; color: var(--text);"><i class="fa-solid fa-microscope" style="color: var(--accent);"></i> Lab Rules:</span>
          <span class="badge" style="background: var(--accent-light); color: var(--accent); padding: 3px 8px; border-radius: 4px; font-weight: 600;">${labLabel}</span>
        </div>
        ${specBadge}
      </div>
      <div style="display: flex; gap: 14px; color: var(--text3); align-items: center;">
        <span>Total First Isolates: <strong style="color:var(--text);">${data.totalFirstIsolates || 0}</strong></span>
        <span>•</span>
        <span>Organisms Analyzed: ${orgAnalysisLabel}</span>
      </div>
    </div>
  `;
}

export function setAntibiogramGrouping(byClass) {
  currentGroupByClass = byClass;
  const btnClass = document.getElementById('btn-abx-group-class');
  const btnAlpha = document.getElementById('btn-abx-group-alpha');
  if (btnClass) btnClass.classList.toggle('active', byClass);
  if (btnAlpha) btnAlpha.classList.toggle('active', !byClass);
  renderAntibiogramTable();
}

export function toggleHideUnder30(checkbox) {
  hideUnder30 = checkbox.checked;
  if (currentReportData) updateAntibiogramMetaHeader(currentReportData);
  renderAntibiogramTable();
}

export function renderAntibiogramTable() {
  const container = document.getElementById('antibiogram-table-container');
  if (!container || !currentReportData) return;

  const { organisms, antibiotics } = currentReportData;
  if (!organisms || !organisms.length) {
    container.innerHTML = `
      <div style="padding: 40px; text-align: center; color: var(--text3);">
        <i class="fa-solid fa-flask-vial" style="font-size: 28px; margin-bottom: 8px;"></i>
        <div>No organism data available for cumulative antibiogram calculation.</div>
      </div>
    `;
    return;
  }

  // Filter organisms if hideUnder30 is checked
  const filteredOrgs = hideUnder30 ? organisms.filter(o => o.meetsThreshold) : organisms;

  if (!filteredOrgs.length) {
    container.innerHTML = `
      <div style="padding: 40px; text-align: center; color: var(--text3);">
        <div>No organisms meet the threshold of ≥ ${currentReportData.minIsolatesThreshold} isolates. Uncheck "Hide species with &lt; 30 isolates" to view all.</div>
      </div>
    `;
    return;
  }

  // Prepare antibiotic columns (grouped by class or alphabetical)
  let abxList = [...antibiotics];
  if (currentGroupByClass) {
    abxList.sort((a, b) => a.class.localeCompare(b.class) || a.name.localeCompare(b.name));
  } else {
    abxList.sort((a, b) => a.name.localeCompare(b.name));
  }

  // Build Table HTML
  let html = `
    <div style="overflow-x: auto; width: 100%;">
      <table class="data-table antibiogram-table" style="width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12.5px;">
        <thead>
          <tr style="background: var(--bg3); position: sticky; top: 0; z-index: 5;">
            <th style="min-width: 220px; text-align: left; padding: 12px 16px; border-bottom: 2px solid var(--border); position: sticky; left: 0; background: var(--bg3); z-index: 6;">
              Organism Name
            </th>
            <th style="min-width: 60px; text-align: center; padding: 12px 8px; border-bottom: 2px solid var(--border);">
              Total (N)
            </th>
  `;

  for (const drug of abxList) {
    html += `
      <th style="min-width: 90px; text-align: center; padding: 8px 6px; border-bottom: 2px solid var(--border);" title="${drug.name} (${drug.class})">
        <div style="font-weight: 700; color: var(--text);">${drug.name}</div>
        <div style="font-size: 10px; color: var(--text3); font-weight: normal; margin-top: 2px;">${drug.code}${drug.class ? ' • ' + drug.class : ''}</div>
      </th>
    `;
  }

  html += `
          </tr>
        </thead>
        <tbody>
  `;

  for (const org of filteredOrgs) {
    const isUnderThreshold = !org.meetsThreshold;
    const rowClass = isUnderThreshold ? 'under-threshold' : '';

    html += `
      <tr class="${rowClass}" style="border-bottom: 1px solid var(--border);">
        <td style="padding: 10px 16px; font-weight: 600; color: var(--text); position: sticky; left: 0; background: var(--bg2); z-index: 2; border-right: 1px solid var(--border);">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span>${org.orgName}</span>
            ${isUnderThreshold ? '<span title="Fewer than 30 isolates: CLSI suggests cautious interpretation" style="color: var(--yellow); font-size: 12px; font-weight: bold;">*</span>' : ''}
          </div>
          <div style="font-size: 10.5px; color: var(--text3); font-family: monospace;">${org.orgCode}</div>
        </td>
        <td style="text-align: center; font-weight: 700; padding: 10px 8px; color: var(--text2); background: var(--bg3); border-right: 1px solid var(--border);">
          ${org.totalCount}
        </td>
    `;

    for (const drug of abxList) {
      const stats = org.drugStats[drug.code];
      if (!stats) {
        html += `<td style="text-align: center; color: var(--text4); font-size: 11px;">—</td>`;
      } else if (stats.isIntrinsic) {
        html += `
          <td style="text-align: center; background: var(--red-bg); color: var(--red); font-weight: 800; font-family: 'JetBrains Mono', monospace;" title="CLSI Intrinsic Resistance: Inherently resistant without testing">
            <span style="border: 1px solid var(--red-border); padding: 2px 6px; border-radius: 4px; font-size: 11px;">${currentMetric === 'R' ? '100% (R)' : 'R'}</span>
          </td>
        `;
      } else {
        if (currentMetric === 'R') {
          // % Resistant: lower resistance is good (green), high resistance is dangerous (red)
          const pctR = stats.pctR;
          let cellBg = 'transparent';
          let cellColor = 'var(--text)';
          if (pctR <= 20) {
            cellBg = 'var(--green-bg)';
            cellColor = 'var(--green)';
          } else if (pctR <= 50) {
            cellBg = 'var(--yellow-bg)';
            cellColor = 'var(--yellow)';
          } else {
            cellBg = 'rgba(244, 63, 94, 0.08)';
            cellColor = 'var(--red)';
          }

          html += `
            <td style="text-align: center; background: ${cellBg}; color: ${cellColor}; font-weight: 700; font-family: 'JetBrains Mono', monospace;" title="${stats.rCount} of ${stats.testedCount} isolates resistant (${stats.pctR}%) [${stats.sCount} S, ${stats.iCount} I]">
              ${stats.displayR}
              <div style="font-size: 9.5px; color: var(--text3); font-weight: normal;">(${stats.rCount}/${stats.testedCount})</div>
            </td>
          `;
        } else {
          // % Susceptible: higher susceptibility is good (green), low susceptibility is alert (red)
          const pctS = stats.pctS;
          let cellBg = 'transparent';
          let cellColor = 'var(--text)';
          if (pctS >= 80) {
            cellBg = 'var(--green-bg)';
            cellColor = 'var(--green)';
          } else if (pctS >= 50) {
            cellBg = 'var(--yellow-bg)';
            cellColor = 'var(--yellow)';
          } else {
            cellBg = 'rgba(244, 63, 94, 0.08)';
            cellColor = 'var(--red)';
          }

          html += `
            <td style="text-align: center; background: ${cellBg}; color: ${cellColor}; font-weight: 700; font-family: 'JetBrains Mono', monospace;" title="${stats.sCount} of ${stats.testedCount} isolates susceptible (${stats.pctS}%) [${stats.rCount} R, ${stats.iCount} I]">
              ${stats.displayS}
              <div style="font-size: 9.5px; color: var(--text3); font-weight: normal;">(${stats.sCount}/${stats.testedCount})</div>
            </td>
          `;
        }
      }
    }

    html += `</tr>`;
  }

  html += `
        </tbody>
      </table>
    </div>
  `;

  container.innerHTML = html;
}

export function exportAntibiogramCsv() {
  if (!currentReportData || !currentReportData.organisms) return toast('No antibiogram data to export', 'error');

  const { organisms, antibiotics } = currentReportData;
  const activeOrgs = hideUnder30 ? organisms.filter(o => o.meetsThreshold) : organisms;

  const headers = ['Organism Code', 'Organism Name', 'Total Isolates (N)', ...antibiotics.map(a => `${a.name} (${a.code})`)];
  const rows = [headers.join(',')];

  for (const org of activeOrgs) {
    const row = [
      `"${org.orgCode}"`,
      `"${org.orgName.replace(/"/g, '""')}"`,
      org.totalCount
    ];
    for (const drug of antibiotics) {
      const stats = org.drugStats[drug.code];
      if (!stats) row.push('""');
      else if (stats.isIntrinsic) row.push('"R"');
      else row.push(`"${stats.pctS}%"`);
    }
    rows.push(row.join(','));
  }

  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Antibiogram_${state.currentDb || 'WHONET'}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Antibiogram CSV exported successfully!', 'success');
}
