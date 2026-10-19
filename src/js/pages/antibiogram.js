import { state } from '../state/store.js';
import { api } from '../api/client.js';
import { toast } from '../ui/toast.js';
import { getSpecimenName } from '../utils/specimens.js';
import { escapeHtml } from '../utils/formatters.js';

let currentReportData = null;
let currentGroupByClass = true; // default CLSI Appendix E2 (By Drug Class)
let currentMetric = 'S'; // 'S' = % Susceptible, 'R' = % Resistant
let hideUnderMinIsolates = true; // default CLSI M39 threshold filter (hide organisms < threshold)

// WHONET Deduplication & Surveillance Configuration State
let currentDedupMode = 'patient_first'; // 'patient_first' | 'isolate' | 'patient_first_ast' | 'episode' | 'patient_most_resistant' | 'patient_most_susceptible'
let currentEpisodeDays = 30; // Number of days for episode window
let currentMinIsolates = 30; // CLSI M39 recommendation
let currentPeriodPreset = 'all'; // 'all' | '1y' | '6m' | '90d' | '30d' | 'custom'
let currentStartDate = '';
let currentEndDate = '';

export function setAntibiogramMetric(metric) {
  currentMetric = metric;
  const btnS = document.getElementById('btn-abx-metric-s');
  const btnR = document.getElementById('btn-abx-metric-r');
  if (btnS) btnS.classList.toggle('active', metric === 'S');
  if (btnR) btnR.classList.toggle('active', metric === 'R');
  renderAntibiogramTable();
}

export function setAntibiogramGrouping(byClass) {
  currentGroupByClass = byClass;
  const btnClass = document.getElementById('btn-abx-group-class');
  const btnAlpha = document.getElementById('btn-abx-group-alpha');
  if (btnClass) btnClass.classList.toggle('active', byClass);
  if (btnAlpha) btnAlpha.classList.toggle('active', !byClass);
  renderAntibiogramTable();
}

export function setAntibiogramMinIsolates(val) {
  const num = parseInt(val, 10);
  currentMinIsolates = isNaN(num) || num < 1 ? 1 : num;
  const inputEl = document.getElementById('abx-min-isolates-input');
  if (inputEl && parseInt(inputEl.value, 10) !== currentMinIsolates) {
    inputEl.value = currentMinIsolates;
  }
  const modalInput = document.getElementById('abx-modal-min-isolates');
  if (modalInput && parseInt(modalInput.value, 10) !== currentMinIsolates) {
    modalInput.value = currentMinIsolates;
  }
  updateHideThresholdLabel();
  loadAntibiogram();
}

export function toggleHideUnderMinIsolates(checkbox) {
  hideUnderMinIsolates = checkbox.checked;
  if (currentReportData) updateAntibiogramMetaHeader(currentReportData);
  renderAntibiogramTable();
}
// Backward compatibility
export const toggleHideUnder30 = toggleHideUnderMinIsolates;

function updateHideThresholdLabel() {
  const lbl = document.getElementById('abx-hide-under-label');
  if (lbl) {
    lbl.textContent = `Hide species with < ${currentMinIsolates} isolates`;
  }
}

export function setAntibiogramDedupMode(mode) {
  currentDedupMode = mode;
  const selectEl = document.getElementById('abx-dedup-select');
  if (selectEl) selectEl.value = mode;
  loadAntibiogram();
}

export function setAntibiogramPeriodPreset(preset) {
  currentPeriodPreset = preset;
  const presetSelect = document.getElementById('abx-period-preset');
  if (presetSelect) presetSelect.value = preset;

  const startInput = document.getElementById('abx-start-date');
  const endInput = document.getElementById('abx-end-date');

  if (preset === 'all') {
    currentStartDate = '';
    currentEndDate = '';
  } else {
    const now = new Date();
    const endStr = now.toISOString().slice(0, 10);
    let pastDays = 365;
    if (preset === '30d') pastDays = 30;
    else if (preset === '90d') pastDays = 90;
    else if (preset === '6m') pastDays = 180;
    else if (preset === '1y') pastDays = 365;

    const past = new Date(now.getTime() - pastDays * 24 * 60 * 60 * 1000);
    const startStr = past.toISOString().slice(0, 10);

    currentStartDate = startStr;
    currentEndDate = endStr;
  }

  if (startInput) startInput.value = currentStartDate;
  if (endInput) endInput.value = currentEndDate;

  loadAntibiogram();
}

export function handleDateInputChange() {
  const startInput = document.getElementById('abx-start-date');
  const endInput = document.getElementById('abx-end-date');
  currentStartDate = startInput ? startInput.value : '';
  currentEndDate = endInput ? endInput.value : '';
  currentPeriodPreset = 'custom';
  const presetSelect = document.getElementById('abx-period-preset');
  if (presetSelect) presetSelect.value = 'custom';
  loadAntibiogram();
}

export async function loadAntibiogram() {
  if (!state.currentDb) return;
  const container = document.getElementById('antibiogram-table-container');
  if (container) {
    container.innerHTML = `
      <div style="padding: 48px; text-align: center; color: var(--text3);">
        <i class="fa-solid fa-spinner fa-spin" style="font-size: 24px; color: var(--accent); margin-bottom: 12px;"></i>
        <div style="font-size: 14px; font-weight: 600;">Generating CLSI M39 Cumulative Antibiogram…</div>
        <div style="font-size: 12px; margin-top: 4px;">Deduplicating isolates (${getDedupModeLabel(currentDedupMode)}) and calculating AMR matrices…</div>
      </div>
    `;
  }

  const wardEl = document.getElementById('abx-ward-filter');
  const ward = wardEl ? wardEl.value : '';
  const specEl = document.getElementById('abx-spec-filter');
  const spec = specEl ? specEl.value : '';

  const queryParams = new URLSearchParams({
    minIsolates: String(currentMinIsolates),
    dedupMode: currentDedupMode,
    episodeDays: String(currentEpisodeDays)
  });
  if (ward) queryParams.set('ward', ward);
  if (spec) queryParams.set('specType', spec);
  if (currentStartDate) queryParams.set('startDate', currentStartDate);
  if (currentEndDate) queryParams.set('endDate', currentEndDate);

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

function getDedupModeLabel(mode) {
  switch (mode) {
    case 'isolate': return 'By Isolate (All Isolates)';
    case 'patient_first_ast': return 'First with AST Results';
    case 'episode': return `Episode (${currentEpisodeDays} Days)`;
    case 'patient_most_resistant': return 'Most Resistant Isolate';
    case 'patient_most_susceptible': return 'Most Susceptible Isolate';
    case 'patient_first':
    default:
      return 'First Isolate (CLSI M39)';
  }
}

function updateAntibiogramMetaHeader(data) {
  const metaEl = document.getElementById('antibiogram-meta-banner');
  if (!metaEl) return;

  const labLabel = data.labName || data.labConfigFile || 'Standard CLSI M100';
  const orgCount = data.organisms ? data.organisms.length : 0;
  const qualifiedCount = data.organisms ? data.organisms.filter(o => o.meetsThreshold).length : 0;
  const threshold = data.minIsolatesThreshold !== undefined ? data.minIsolatesThreshold : currentMinIsolates;

  const specEl = document.getElementById('abx-spec-filter');
  const selectedSpec = specEl ? specEl.value : '';
  const specName = selectedSpec ? (getSpecimenName(selectedSpec) || selectedSpec) : '';
  const specBadge = specName ? `
    <div style="display: flex; align-items: center; gap: 6px;">
      <span style="font-weight: 700; color: var(--text);"><i class="fa-solid fa-vial" style="color: var(--accent);"></i> Specimen:</span>
      <span class="badge" style="background: var(--bg3); color: var(--text); border: 1px solid var(--border); padding: 3px 8px; border-radius: 4px; font-weight: 600;">${escapeHtml(specName)} (${escapeHtml(selectedSpec)})</span>
    </div>
  ` : '';

  const dateBadge = (data.startDate || data.endDate) ? `
    <div style="display: flex; align-items: center; gap: 6px;">
      <span style="font-weight: 700; color: var(--text);"><i class="fa-regular fa-calendar" style="color: var(--accent);"></i> Period:</span>
      <span class="badge" style="background: var(--bg3); color: var(--text); border: 1px solid var(--border); padding: 3px 8px; border-radius: 4px; font-weight: 600;">${data.startDate || 'Beginning'} &rarr; ${data.endDate || 'Latest'}</span>
    </div>
  ` : '';

  const dedupBadge = `
    <div style="display: flex; align-items: center; gap: 6px;">
      <span style="font-weight: 700; color: var(--text);"><i class="fa-solid fa-user-check" style="color: var(--accent);"></i> Deduplication:</span>
      <span class="badge" style="background: var(--bg3); color: var(--text); border: 1px solid var(--border); padding: 3px 8px; border-radius: 4px; font-weight: 600;">${escapeHtml(getDedupModeLabel(data.dedupMode || currentDedupMode))}</span>
    </div>
  `;

  const orgAnalysisLabel = hideUnderMinIsolates
    ? `Showing <strong style="color:var(--text);">${qualifiedCount}</strong> with ≥ ${threshold} isolates (${orgCount} total)`
    : `Showing all <strong style="color:var(--text);">${orgCount}</strong> (<strong style="color:var(--text);">${qualifiedCount}</strong> with ≥ ${threshold} isolates)`;

  metaEl.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 10px; font-size: 12.5px;">
      <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px;">
        <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-weight: 700; color: var(--text);"><i class="fa-solid fa-microscope" style="color: var(--accent);"></i> Lab Rules:</span>
            <span class="badge" style="background: var(--accent-light); color: var(--accent); padding: 3px 8px; border-radius: 4px; font-weight: 600;">${labLabel}</span>
          </div>
          ${dedupBadge}
          ${dateBadge}
          ${specBadge}
        </div>
        <button
          type="button"
          class="btn btn-outline btn-xs"
          onclick="openAntibiogramOptionsModal()"
          title="Open WHONET Patient-wise Deduplication & Analysis Options"
          style="display: inline-flex; align-items: center; gap: 5px; font-weight: 600;"
        >
          <i class="fa-solid fa-sliders"></i> Deduplication Settings
        </button>
      </div>

      <div style="display: flex; flex-wrap: wrap; gap: 14px; color: var(--text3); align-items: center; justify-content: flex-end; padding-top: 6px; border-top: 1px dashed var(--border);">
        <span>Total Analyzed Isolates: <strong style="color:var(--text);">${data.totalFirstIsolates || 0}</strong></span>
        <span>•</span>
        <span>Total Raw Isolates: <strong style="color:var(--text);">${data.totalRawIsolates || data.totalFirstIsolates || 0}</strong></span>
        <span>•</span>
        <span>Organisms: ${orgAnalysisLabel}</span>
      </div>
    </div>
  `;
}

export function renderAntibiogramTable() {
  const container = document.getElementById('antibiogram-table-container');
  if (!container || !currentReportData) return;

  const { organisms, antibiotics } = currentReportData;
  if (!organisms || !organisms.length) {
    container.innerHTML = `
      <div style="padding: 40px; text-align: center; color: var(--text3);">
        <i class="fa-solid fa-flask-vial" style="font-size: 28px; margin-bottom: 8px;"></i>
        <div>No organism data available for the chosen filters.</div>
      </div>
    `;
    return;
  }

  // Filter organisms if hideUnderMinIsolates is checked
  const filteredOrgs = hideUnderMinIsolates ? organisms.filter(o => o.meetsThreshold) : organisms;

  if (!filteredOrgs.length) {
    container.innerHTML = `
      <div style="padding: 40px; text-align: center; color: var(--text3);">
        <div>No organisms meet the threshold of ≥ ${currentReportData.minIsolatesThreshold} isolates. Uncheck "Hide species with < ${currentReportData.minIsolatesThreshold} isolates" or lower the threshold to view all.</div>
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
            <th style="min-width: 240px; text-align: left; padding: 12px 16px; border-bottom: 2px solid var(--border); position: sticky; left: 0; background: var(--bg3); z-index: 6;">
              Organism Name
            </th>
            <th style="min-width: 70px; text-align: center; padding: 12px 8px; border-bottom: 2px solid var(--border);">
              Total (N)
            </th>
  `;

  for (const drug of abxList) {
    const isUrine = drug.isUrineOnly;
    const urineBadge = isUrine ? `
      <div style="margin-top: 3px;">
        <span class="badge" style="background: rgba(14, 165, 233, 0.12); color: var(--accent); border: 1px solid rgba(14, 165, 233, 0.3); font-size: 9.5px; padding: 1px 5px; border-radius: 3px; font-weight: 700;" title="CLSI M39: Susceptibility calculated strictly from urine specimens">
          <i class="fa-solid fa-vial" style="font-size: 8.5px;"></i> Urine only
        </span>
      </div>
    ` : '';

    html += `
      <th style="min-width: 95px; text-align: center; padding: 8px 6px; border-bottom: 2px solid var(--border);" title="${drug.name} (${drug.class})${isUrine ? ' — CLSI M39: Calculated strictly from urine isolates' : ''}">
        <div style="font-weight: 700; color: var(--text);">${escapeHtml(drug.name)}</div>
        <div style="font-size: 10px; color: var(--text3); font-weight: normal; margin-top: 2px;">${drug.code}${drug.class ? ' • ' + drug.class : ''}</div>
        ${urineBadge}
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
            <span>${escapeHtml(org.orgName)}</span>
            ${isUnderThreshold ? `<span title="Fewer than ${currentReportData.minIsolatesThreshold} isolates: CLSI suggests cautious interpretation" style="color: var(--yellow); font-size: 12px; font-weight: bold;">*</span>` : ''}
          </div>
          <div style="font-size: 10.5px; color: var(--text3); font-family: monospace;">${escapeHtml(org.orgCode)}</div>
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

// ── WHONET "One Isolate of Species by Patient" Modal Dialog ──

export function openAntibiogramOptionsModal() {
  const modal = document.getElementById('antibiogram-options-modal');
  if (!modal) return;

  // Sync inputs with current state
  const radioByIsolate = document.getElementById('abx-opt-by-isolate');
  const radioByPatientFirst = document.getElementById('abx-opt-by-patient-first');
  const radioByPatientAst = document.getElementById('abx-opt-by-patient-ast');
  const radioByPatientRes = document.getElementById('abx-opt-by-patient-res');
  const radioByPatientSusc = document.getElementById('abx-opt-by-patient-susc');
  const radioByEpisode = document.getElementById('abx-opt-by-episode');
  const episodeDaysInput = document.getElementById('abx-opt-episode-days');
  const modalMinIsolatesInput = document.getElementById('abx-modal-min-isolates');
  const modalPeriodPreset = document.getElementById('abx-modal-period-preset');
  const modalStartDate = document.getElementById('abx-modal-start-date');
  const modalEndDate = document.getElementById('abx-modal-end-date');

  if (currentDedupMode === 'isolate' && radioByIsolate) radioByIsolate.checked = true;
  else if (currentDedupMode === 'patient_first_ast' && radioByPatientAst) radioByPatientAst.checked = true;
  else if (currentDedupMode === 'patient_most_resistant' && radioByPatientRes) radioByPatientRes.checked = true;
  else if (currentDedupMode === 'patient_most_susceptible' && radioByPatientSusc) radioByPatientSusc.checked = true;
  else if (currentDedupMode === 'episode' && radioByEpisode) radioByEpisode.checked = true;
  else if (radioByPatientFirst) radioByPatientFirst.checked = true;

  if (episodeDaysInput) episodeDaysInput.value = currentEpisodeDays;
  if (modalMinIsolatesInput) modalMinIsolatesInput.value = currentMinIsolates;
  if (modalPeriodPreset) modalPeriodPreset.value = currentPeriodPreset;
  if (modalStartDate) modalStartDate.value = currentStartDate;
  if (modalEndDate) modalEndDate.value = currentEndDate;

  modal.style.display = 'flex';
  setTimeout(() => modal.classList.add('open'), 10);
}

export function closeAntibiogramOptionsModal() {
  const modal = document.getElementById('antibiogram-options-modal');
  if (modal) {
    modal.classList.remove('open');
    setTimeout(() => { modal.style.display = 'none'; }, 200);
  }
}

export function applyAntibiogramOptions() {
  const selectedRadio = document.querySelector('input[name="abx-dedup-mode-opt"]:checked');
  if (selectedRadio) {
    currentDedupMode = selectedRadio.value;
    const selectEl = document.getElementById('abx-dedup-select');
    if (selectEl) selectEl.value = currentDedupMode;
  }

  const episodeDaysInput = document.getElementById('abx-opt-episode-days');
  if (episodeDaysInput) {
    const days = parseInt(episodeDaysInput.value, 10);
    currentEpisodeDays = isNaN(days) || days < 1 ? 30 : days;
  }

  const modalMinIsolatesInput = document.getElementById('abx-modal-min-isolates');
  if (modalMinIsolatesInput) {
    const minIso = parseInt(modalMinIsolatesInput.value, 10);
    currentMinIsolates = isNaN(minIso) || minIso < 1 ? 1 : minIso;
    const barInput = document.getElementById('abx-min-isolates-input');
    if (barInput) barInput.value = currentMinIsolates;
    updateHideThresholdLabel();
  }

  const modalPeriodPreset = document.getElementById('abx-modal-period-preset');
  const modalStartDate = document.getElementById('abx-modal-start-date');
  const modalEndDate = document.getElementById('abx-modal-end-date');
  if (modalPeriodPreset) {
    currentPeriodPreset = modalPeriodPreset.value;
    const barPreset = document.getElementById('abx-period-preset');
    if (barPreset) barPreset.value = currentPeriodPreset;
  }
  if (modalStartDate && modalEndDate) {
    currentStartDate = modalStartDate.value;
    currentEndDate = modalEndDate.value;
    const barStart = document.getElementById('abx-start-date');
    const barEnd = document.getElementById('abx-end-date');
    if (barStart) barStart.value = currentStartDate;
    if (barEnd) barEnd.value = currentEndDate;
  }

  closeAntibiogramOptionsModal();
  toast('Antibiogram deduplication options updated', 'info');
  loadAntibiogram();
}

// ── Export Functions ──

export function exportAntibiogramCsv() {
  if (!currentReportData || !currentReportData.organisms) return toast('No antibiogram data to export', 'error');

  const { organisms, antibiotics } = currentReportData;
  const activeOrgs = hideUnderMinIsolates ? organisms.filter(o => o.meetsThreshold) : organisms;

  const metricLabel = currentMetric === 'R' ? '% Resistant' : '% Susceptible';
  const headers = ['Organism Code', 'Organism Name', 'Total Isolates (N)', ...antibiotics.map(a => `${a.name} (${a.code}${a.isUrineOnly ? ' - Urine Only' : ''}) [${metricLabel}]`)];
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
      else if (stats.isIntrinsic) row.push(currentMetric === 'R' ? '"100% (R)"' : '"R"');
      else row.push(currentMetric === 'R' ? `"${stats.pctR}%"` : `"${stats.pctS}%"`);
    }
    rows.push(row.join(','));
  }

  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Antibiogram_${state.currentDb || 'WHONET'}_${currentDedupMode}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Antibiogram CSV exported successfully!', 'success');
}

export function copyAntibiogramTsv() {
  if (!currentReportData || !currentReportData.organisms) return toast('No antibiogram data to copy', 'error');

  const { organisms, antibiotics } = currentReportData;
  const activeOrgs = hideUnderMinIsolates ? organisms.filter(o => o.meetsThreshold) : organisms;

  const metricLabel = currentMetric === 'R' ? '%R' : '%S';
  const headers = ['Organism Code', 'Organism Name', 'Total Isolates (N)', ...antibiotics.map(a => `${a.name} (${a.code}${a.isUrineOnly ? ' - Urine' : ''}) ${metricLabel}`)];
  const rows = [headers.join('\t')];

  for (const org of activeOrgs) {
    const row = [org.orgCode, org.orgName, org.totalCount];
    for (const drug of antibiotics) {
      const stats = org.drugStats[drug.code];
      if (!stats) row.push('');
      else if (stats.isIntrinsic) row.push(currentMetric === 'R' ? '100% (R)' : 'R');
      else row.push(currentMetric === 'R' ? `${stats.pctR}%` : `${stats.pctS}%`);
    }
    rows.push(row.join('\t'));
  }

  navigator.clipboard.writeText(rows.join('\n'))
    .then(() => toast('Antibiogram copied to clipboard (TSV formatted for Excel)', 'success'))
    .catch(() => toast('Could not copy to clipboard', 'error'));
}
