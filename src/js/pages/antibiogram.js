import { state } from '../state/store.js';
import { api } from '../api/client.js';
import { toast } from '../ui/toast.js';
import { getSpecimenName } from '../utils/specimens.js';
import { escapeHtml } from '../utils/formatters.js';

let currentReportData = null;
let currentGroupByClass = true; // default CLSI Appendix E2 (By Drug Class)
let currentMetric = 'S'; // 'S' = % Susceptible, 'R' = % Resistant
let hideUnderMinIsolates = true; // default CLSI M39 threshold filter (hide organisms < threshold)
let hideEmptyAbx = true; // default: hide antibiotics without any data / % for displayed organisms

export function toggleHideEmptyAbx(checked) {
  hideEmptyAbx = checked !== undefined ? checked : !hideEmptyAbx;
  renderAntibiogramTable();
}

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
  loadAntibiogram();
}

export function toggleHideUnderMinIsolates(checkbox) {
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
  if (currentAntibiogramViewMode === 'trends') {
    renderAmrTrendChart();
  } else if (currentAntibiogramViewMode === 'locations') {
    populateLocationOrgDropdown();
    renderLocationStratificationChart();
  }
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

  const cutoffBadge = `
    <div style="display: flex; align-items: center; gap: 6px;">
      <span style="font-weight: 700; color: var(--text);"><i class="fa-solid fa-chart-pie" style="color: var(--accent);"></i> Cutoff:</span>
      <span class="badge" style="background: var(--bg3); color: var(--text); border: 1px solid var(--border); padding: 3px 8px; border-radius: 4px; font-weight: 600;">&ge; ${threshold} isolates</span>
    </div>
  `;

  const orgAnalysisLabel = `Showing <strong style="color:var(--text);">${qualifiedCount}</strong> with ≥ ${threshold} isolates (${orgCount} total)`;

  metaEl.innerHTML = `
    <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; font-size: 12px;">
      <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 10px;">
        <div style="display: flex; align-items: center; gap: 7px;">
          <span style="font-weight: 700; color: var(--text);"><i class="fa-solid fa-microscope" style="color: var(--accent);"></i> Lab Rules:</span>
          <span class="badge" style="background: var(--accent-light); color: var(--accent); padding: 3px 8px; border-radius: 4px; font-weight: 600;">${labLabel}</span>
        </div>
        ${dedupBadge}
        ${cutoffBadge}
        ${dateBadge}
        ${specBadge}
      </div>

      <div style="display: flex; flex-wrap: wrap; gap: 10px; color: var(--text3); align-items: center; font-size: 12px; margin-left: auto;">
        <span>Analyzed: <strong style="color:var(--text);">${data.totalFirstIsolates || 0}</strong></span>
        <span>•</span>
        <span>Raw: <strong style="color:var(--text);">${data.totalRawIsolates || data.totalFirstIsolates || 0}</strong></span>
        <span>•</span>
        <span>${orgAnalysisLabel}</span>
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

  // Filter organisms by configured threshold (CLSI M39)
  const filteredOrgs = organisms.filter(o => o.meetsThreshold);

  if (!filteredOrgs.length) {
    container.innerHTML = `
      <div style="padding: 40px; text-align: center; color: var(--text3);">
        <div>No organisms meet the threshold of ≥ ${currentReportData.minIsolatesThreshold} isolates. Adjust the Minimum Isolates Cutoff in Deduplication Settings or choose a lower threshold.</div>
      </div>
    `;
    return;
  }

  // Prepare antibiotic columns (grouped by class or alphabetical)
  let abxList = [...antibiotics];
  if (hideEmptyAbx) {
    abxList = abxList.filter(drug => {
      return filteredOrgs.some(org => {
        const stats = org.drugStats[drug.code];
        return stats && (stats.testedCount > 0 || stats.isIntrinsic);
      });
    });
  }

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
      <th style="min-width: 95px; text-align: center; padding: 8px 6px; border-bottom: 2px solid var(--border);" title="${escapeHtml(drug.name)} (${escapeHtml(drug.code)})${drug.class ? ' — ' + escapeHtml(drug.class) : ''}${isUrine ? ' — CLSI M39: Calculated strictly from urine isolates' : ''}">
        <div style="font-weight: 700; color: var(--text);">${escapeHtml(drug.name)}</div>
        <div style="font-size: 10px; color: var(--text3); font-weight: normal; margin-top: 2px;">(${escapeHtml(drug.code)})${drug.class ? ' ' + escapeHtml(drug.class) : ''}</div>
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
        <td style="padding: 10px 14px; font-weight: 600; color: var(--text); position: sticky; left: 0; background: var(--bg2); z-index: 2; border-right: 1px solid var(--border);">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            <div>
              <div style="display: flex; align-items: center; gap: 6px;">
                <span>${escapeHtml(org.orgName)}</span>
                ${isUnderThreshold ? `<span title="Fewer than ${currentReportData.minIsolatesThreshold} isolates: CLSI suggests cautious interpretation" style="color: var(--yellow); font-size: 12px; font-weight: bold;">*</span>` : ''}
              </div>
              <div style="font-size: 10.5px; color: var(--text3); font-family: monospace;">${escapeHtml(org.orgCode)}</div>
            </div>
            <button
              class="abx-chart-btn"
              onclick="event.stopPropagation(); openOrganismSpectrumModal('${escapeHtml(org.orgCode)}')"
              title="View %S / %I / %R Susceptibility Spectrum Chart for ${escapeHtml(org.orgName)}"
              aria-label="Spectrum Chart for ${escapeHtml(org.orgName)}"
            >
              <i class="fa-solid fa-chart-column" style="pointer-events: none;"></i>
            </button>
          </div>
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
          <td style="text-align: center; background: var(--red-bg); color: var(--red); font-weight: 800; font-family: 'JetBrains Mono', monospace;" title="CLSI Intrinsic Resistance: Inherently resistant (${stats.rCount} of ${stats.testedCount} tested resistant)">
            <span style="border: 1px solid var(--red-border); padding: 2px 6px; border-radius: 4px; font-size: 11px;">${currentMetric === 'R' ? '100% (R)' : 'R'}</span>
            ${stats.testedCount > 0 ? `<div style="font-size: 9.5px; color: var(--red); font-weight: normal; margin-top: 2px;">(${stats.rCount}/${stats.testedCount})</div>` : ''}
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

export function setModalMinCutoff(cutoff) {
  const input = document.getElementById('abx-modal-min-isolates');
  if (input) {
    input.value = cutoff;
  }
  document.querySelectorAll('.abx-cutoff-pill').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.cutoff, 10) === cutoff);
  });
}

export function handleModalMinCutoffChange() {
  const input = document.getElementById('abx-modal-min-isolates');
  const val = input ? parseInt(input.value, 10) : 30;
  document.querySelectorAll('.abx-cutoff-pill').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.cutoff, 10) === val);
  });
}

export function handleModalPeriodPreset(preset) {
  const startEl = document.getElementById('abx-modal-start-date');
  const endEl = document.getElementById('abx-modal-end-date');
  if (!startEl || !endEl) return;
  if (preset === 'all') {
    startEl.value = '';
    endEl.value = '';
  } else {
    const now = new Date();
    let days = 365;
    if (preset === '30d') days = 30;
    else if (preset === '90d') days = 90;
    else if (preset === '6m') days = 180;
    endEl.value = now.toISOString().slice(0, 10);
    startEl.value = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
  }
}

export function resetAntibiogramOptionsDefaults() {
  const radioByPatientFirst = document.getElementById('abx-opt-by-patient-first');
  if (radioByPatientFirst) radioByPatientFirst.checked = true;

  const episodeDaysInput = document.getElementById('abx-opt-episode-days');
  if (episodeDaysInput) episodeDaysInput.value = 30;

  const modalPeriodPreset = document.getElementById('abx-modal-period-preset');
  if (modalPeriodPreset) modalPeriodPreset.value = 'all';

  const modalStartDate = document.getElementById('abx-modal-start-date');
  if (modalStartDate) modalStartDate.value = '';

  const modalEndDate = document.getElementById('abx-modal-end-date');
  if (modalEndDate) modalEndDate.value = '';

  const hideEmptyInput = document.getElementById('abx-modal-hide-empty-abx');
  if (hideEmptyInput) hideEmptyInput.checked = true;
  hideEmptyAbx = true;

  setModalMinCutoff(30);
  toast('Antibiogram options reset to CLSI M39 defaults', 'info');
}

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
  const hideEmptyInput = document.getElementById('abx-modal-hide-empty-abx');

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
  if (hideEmptyInput) hideEmptyInput.checked = hideEmptyAbx;

  // Sync cutoff pills highlight
  const curCutoff = parseInt(modalMinIsolatesInput ? modalMinIsolatesInput.value : currentMinIsolates, 10);
  document.querySelectorAll('.abx-cutoff-pill').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.cutoff, 10) === curCutoff);
  });

  modal.classList.add('open');
}

export function closeAntibiogramOptionsModal() {
  const modal = document.getElementById('antibiogram-options-modal');
  if (modal) {
    modal.classList.remove('open');
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

  const hideEmptyInput = document.getElementById('abx-modal-hide-empty-abx');
  if (hideEmptyInput) {
    hideEmptyAbx = hideEmptyInput.checked;
  }

  closeAntibiogramOptionsModal();
  toast('Antibiogram options updated', 'info');
  loadAntibiogram();
}

// ── Export Functions ──

export function exportAntibiogramCsv() {
  if (!currentReportData || !currentReportData.organisms) return toast('No antibiogram data to export', 'error');

  const { organisms, antibiotics } = currentReportData;
  const activeOrgs = organisms.filter(o => o.meetsThreshold);

  let activeAbxList = [...antibiotics];
  if (hideEmptyAbx) {
    activeAbxList = activeAbxList.filter(drug => {
      return activeOrgs.some(org => {
        const stats = org.drugStats[drug.code];
        return stats && (stats.testedCount > 0 || stats.isIntrinsic);
      });
    });
  }

  const metricLabel = currentMetric === 'R' ? '% Resistant' : '% Susceptible';
  const headers = ['Organism Code', 'Organism Name', 'Total Isolates (N)', ...activeAbxList.map(a => `${a.name} (${a.code}${a.isUrineOnly ? ' - Urine Only' : ''}) [${metricLabel}]`)];
  const rows = [headers.join(',')];

  for (const org of activeOrgs) {
    const row = [
      `"${org.orgCode}"`,
      `"${org.orgName.replace(/"/g, '""')}"`,
      org.totalCount
    ];
    for (const drug of activeAbxList) {
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
  const activeOrgs = organisms.filter(o => o.meetsThreshold);

  let activeAbxList = [...antibiotics];
  if (hideEmptyAbx) {
    activeAbxList = activeAbxList.filter(drug => {
      return activeOrgs.some(org => {
        const stats = org.drugStats[drug.code];
        return stats && (stats.testedCount > 0 || stats.isIntrinsic);
      });
    });
  }

  const metricLabel = currentMetric === 'R' ? '%R' : '%S';
  const headers = ['Organism Code', 'Organism Name', 'Total Isolates (N)', ...activeAbxList.map(a => `${a.name} (${a.code}${a.isUrineOnly ? ' - Urine' : ''}) ${metricLabel}`)];
  const rows = [headers.join('\t')];

  for (const org of activeOrgs) {
    const row = [org.orgCode, org.orgName, org.totalCount];
    for (const drug of activeAbxList) {
      const stats = org.drugStats[drug.code];
      if (!stats) row.push('');
      else if (stats.isIntrinsic) row.push(currentMetric === 'R' ? '100% (R)' : 'R');
      else row.push(currentMetric === 'R' ? `${stats.pctR}%` : `${stats.pctS}%`);
    }
    rows.push(row.join('\t'));
  }

  navigator.clipboard.writeText(rows.join('\n'))
    .then(() => toast('Antibiogram table copied to clipboard (ready to paste into Excel or Word)', 'success'))
    .catch(() => toast('Could not copy to clipboard', 'error'));
}

// ── Organism Susceptibility Spectrum Chart (%S / %I / %R) ──

let spectrumChartInstance = null;
let activeSpectrumOrgCode = null;

export function openOrganismSpectrumModal(orgCode) {
  if (!currentReportData || !currentReportData.organisms) {
    return toast('Please generate or load an antibiogram first', 'warning');
  }
  const org = currentReportData.organisms.find(o => o.orgCode.toLowerCase() === (orgCode || '').toLowerCase());
  if (!org) return toast(`Organism data for '${orgCode}' not found`, 'error');

  activeSpectrumOrgCode = orgCode;

  const modal = document.getElementById('organism-spectrum-modal');
  if (!modal) {
    console.error('Modal #organism-spectrum-modal not found');
    return;
  }

  const titleEl = document.getElementById('spectrum-modal-title');
  const subtitleEl = document.getElementById('spectrum-modal-subtitle');
  if (titleEl) {
    titleEl.textContent = `${org.orgName} (${org.orgCode.toUpperCase()})`;
  }
  if (subtitleEl) {
    subtitleEl.textContent = `Analyzed: ${org.totalCount} isolates • Guideline: ${currentReportData.guideline || 'CLSI'} • AMRIE Interpretation`;
  }

  modal.classList.add('open');
  requestAnimationFrame(() => {
    renderOrganismSpectrumChart();
  });
}

export function closeOrganismSpectrumModal() {
  const modal = document.getElementById('organism-spectrum-modal');
  if (modal) {
    modal.classList.remove('open');
  }
  if (spectrumChartInstance) {
    try { spectrumChartInstance.destroy(); } catch (_) {}
    spectrumChartInstance = null;
  }
  activeSpectrumOrgCode = null;
}

export function renderOrganismSpectrumChart() {
  if (!activeSpectrumOrgCode || !currentReportData || !currentReportData.organisms) return;
  const org = currentReportData.organisms.find(o => o.orgCode.toLowerCase() === activeSpectrumOrgCode.toLowerCase());
  if (!org) return;

  const sortSelect = document.getElementById('spectrum-sort-select');
  const sortMode = sortSelect ? sortSelect.value : 'susc_desc';
  const hideUntested = document.getElementById('spectrum-hide-untested')?.checked ?? true;
  const metric = document.getElementById('spectrum-metric-select')?.value || 'all';
  const orientation = document.getElementById('spectrum-orientation-select')?.value || 'horizontal';
  const isVertical = orientation === 'vertical';

  const allAntibiotics = currentReportData.antibiotics || [];

  // Update dynamic modal subtitle & legend badges based on selected metric
  const subtitleEl = document.getElementById('spectrum-modal-subtitle');
  if (subtitleEl) {
    const metricText = metric === 'S'
      ? '% Susceptible (%S) Profile'
      : metric === 'R'
      ? '% Resistant (%R) Profile'
      : 'Cumulative AST Profile (%S / %I / %R)';
    subtitleEl.textContent = `${metricText} • Analyzed: ${org.totalCount} isolates • Guideline: ${currentReportData.guideline || 'CLSI'} • AMRIE Interpretation`;
  }

  const bS = document.getElementById('spectrum-badge-s');
  const bI = document.getElementById('spectrum-badge-i');
  const bR = document.getElementById('spectrum-badge-r');
  const bIntr = document.getElementById('spectrum-badge-intrinsic');
  if (bS) bS.style.display = (metric === 'all' || metric === 'S') ? 'inline-flex' : 'none';
  if (bI) bI.style.display = (metric === 'all') ? 'inline-flex' : 'none';
  if (bR) bR.style.display = (metric === 'all' || metric === 'R') ? 'inline-flex' : 'none';
  if (bIntr) bIntr.style.display = (metric === 'all' || metric === 'R') ? 'inline-flex' : 'none';

  // Build drug list for this organism
  let items = [];
  for (const drug of allAntibiotics) {
    const stats = org.drugStats[drug.code];
    const isTested = stats && (stats.testedCount > 0 || stats.isIntrinsic);

    if (hideUntested && !isTested) continue;

    let pctS = 0;
    let pctI = 0;
    let pctR = 0;
    let isIntrinsic = false;
    let testedCount = 0;
    let sCount = 0;
    let iCount = 0;
    let rCount = 0;

    if (stats) {
      pctS = stats.pctS || 0;
      pctI = stats.pctI || 0;
      pctR = stats.pctR || 0;
      isIntrinsic = !!stats.isIntrinsic;
      testedCount = stats.testedCount || 0;
      sCount = stats.sCount || 0;
      iCount = stats.iCount || 0;
      rCount = stats.rCount || 0;
    }

    items.push({
      code: drug.code,
      name: drug.name || drug.code || 'Unknown',
      drugClass: drug.class || 'Other',
      isUrineOnly: !!drug.isUrineOnly,
      pctS,
      pctI,
      pctR,
      isIntrinsic,
      testedCount,
      sCount,
      iCount,
      rCount,
      isTested
    });
  }

  // Sort items according to active sort mode
  if (sortMode === 'susc_desc') {
    items.sort((a, b) => b.pctS - a.pctS || a.name.localeCompare(b.name));
  } else if (sortMode === 'susc_asc') {
    items.sort((a, b) => a.pctS - b.pctS || a.name.localeCompare(b.name));
  } else if (sortMode === 'res_desc') {
    items.sort((a, b) => b.pctR - a.pctR || a.name.localeCompare(b.name));
  } else if (sortMode === 'res_asc') {
    items.sort((a, b) => a.pctR - b.pctR || a.name.localeCompare(b.name));
  } else if (sortMode === 'class') {
    items.sort((a, b) => a.drugClass.localeCompare(b.drugClass) || (metric === 'R' ? b.pctR - a.pctR : b.pctS - a.pctS) || a.name.localeCompare(b.name));
  } else if (sortMode === 'alpha') {
    items.sort((a, b) => a.name.localeCompare(b.name));
  }

  const statsEl = document.getElementById('spectrum-modal-stats');
  if (statsEl) {
    const testedDrugsCount = items.filter(i => i.isTested).length;
    statsEl.textContent = `Displaying ${items.length} antimicrobial agents (${testedDrugsCount} tested on this species, N = ${org.totalCount} isolates)`;
  }

  const canvas = document.getElementById('spectrum-chart-canvas');
  const container = document.getElementById('spectrum-canvas-container');
  if (!canvas || !container) return;

  // Dynamically size container based on orientation so all bars and labels have generous room
  if (isVertical) {
    const minWidth = Math.max(760, items.length * 38 + 60);
    container.style.width = `${minWidth}px`;
    container.style.height = '480px';
  } else {
    container.style.width = '100%';
    const dynamicHeight = Math.max(420, items.length * 36 + 60);
    container.style.height = `${dynamicHeight}px`;
  }

  if (typeof Chart === 'undefined') {
    console.warn('Chart.js is not loaded');
    return;
  }

  if (spectrumChartInstance) {
    try { spectrumChartInstance.destroy(); } catch (_) {}
    spectrumChartInstance = null;
  }

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const textColor = isDark ? '#e2e8f0' : '#334155';
  const mutedColor = isDark ? '#94a3b8' : '#64748b';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(226, 232, 240, 0.8)';
  const tooltipBg = isDark ? 'rgba(18, 24, 38, 0.96)' : 'rgba(15, 23, 42, 0.95)';

  const labels = items.map(d => {
    let lbl = d.name || d.code || 'Unknown';
    if (d.isUrineOnly) lbl += ' [Urine]';
    return lbl;
  });

  const ctx = canvas.getContext('2d');

  const rBgColors = items.map(d => d.isIntrinsic ? '#991b1b' : '#ef4444');
  const rBorderColors = items.map(d => d.isIntrinsic ? '#7f1d1d' : '#dc2626');

  // Build datasets according to metric mode
  let datasets = [];
  if (metric === 'all') {
    datasets = [
      {
        label: '% Susceptible (%S)',
        data: items.map(d => d.pctS),
        backgroundColor: '#10b981',
        borderColor: '#059669',
        borderWidth: 1,
        hoverBackgroundColor: '#059669',
        barThickness: isVertical ? 20 : 16,
        maxBarThickness: isVertical ? 26 : 18,
        borderRadius: isVertical
          ? { topLeft: 0, topRight: 0, bottomLeft: 4, bottomRight: 4 }
          : { topLeft: 4, bottomLeft: 4, topRight: 0, bottomRight: 0 }
      },
      {
        label: '% Intermediate / SDD (%I)',
        data: items.map(d => d.pctI),
        backgroundColor: '#f59e0b',
        borderColor: '#d97706',
        borderWidth: 1,
        hoverBackgroundColor: '#d97706',
        barThickness: isVertical ? 20 : 16,
        maxBarThickness: isVertical ? 26 : 18,
        borderRadius: 0
      },
      {
        label: '% Resistant (%R)',
        data: items.map(d => d.pctR),
        backgroundColor: rBgColors,
        borderColor: rBorderColors,
        borderWidth: 1,
        hoverBackgroundColor: '#dc2626',
        barThickness: isVertical ? 20 : 16,
        maxBarThickness: isVertical ? 26 : 18,
        borderRadius: isVertical
          ? { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 }
          : { topRight: 4, bottomRight: 4, topLeft: 0, bottomLeft: 0 }
      }
    ];
  } else if (metric === 'S') {
    datasets = [
      {
        label: '% Susceptible (%S)',
        data: items.map(d => d.pctS),
        backgroundColor: '#10b981',
        borderColor: '#059669',
        borderWidth: 1,
        hoverBackgroundColor: '#059669',
        barThickness: isVertical ? 22 : 16,
        maxBarThickness: isVertical ? 28 : 20,
        borderRadius: 4
      }
    ];
  } else if (metric === 'R') {
    datasets = [
      {
        label: '% Resistant (%R)',
        data: items.map(d => d.pctR),
        backgroundColor: rBgColors,
        borderColor: rBorderColors,
        borderWidth: 1,
        hoverBackgroundColor: '#dc2626',
        barThickness: isVertical ? 22 : 16,
        maxBarThickness: isVertical ? 28 : 20,
        borderRadius: 4
      }
    ];
  }

  const isStacked = metric === 'all';

  const scales = isVertical ? {
    x: {
      stacked: isStacked,
      grid: { display: false },
      ticks: {
        autoSkip: false,
        maxRotation: 55,
        minRotation: 45,
        color: textColor,
        font: { family: 'Plus Jakarta Sans', size: 11, weight: '600' },
        padding: 6
      }
    },
    y: {
      stacked: isStacked,
      min: 0,
      max: 100,
      grid: { color: gridColor },
      ticks: {
        color: mutedColor,
        font: { family: 'JetBrains Mono', size: 11, weight: '500' },
        callback: v => `${v}%`
      },
      title: {
        display: true,
        text: metric === 'S' ? '% Susceptible' : metric === 'R' ? '% Resistant' : '% Susceptible / Intermediate / Resistant',
        color: mutedColor,
        font: { family: 'Plus Jakarta Sans', size: 11, weight: '600' }
      }
    }
  } : {
    x: {
      stacked: isStacked,
      min: 0,
      max: 100,
      grid: { color: gridColor },
      ticks: {
        color: mutedColor,
        font: { family: 'JetBrains Mono', size: 11, weight: '500' },
        callback: v => `${v}%`
      }
    },
    y: {
      stacked: isStacked,
      grid: { display: false },
      ticks: {
        autoSkip: false,
        color: textColor,
        font: { family: 'Plus Jakarta Sans', size: 11.5, weight: '600' },
        padding: 8
      }
    }
  };

  const layoutPadding = isVertical
    ? { left: 14, right: 20, top: 12, bottom: 16 }
    : { left: 12, right: 24, top: 10, bottom: 12 };

  spectrumChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets
    },
    options: {
      indexAxis: isVertical ? 'x' : 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      layout: {
        padding: layoutPadding
      },
      scales,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: tooltipBg,
          titleFont: { family: 'Plus Jakarta Sans', size: 12, weight: 'bold' },
          bodyFont: { family: 'Plus Jakarta Sans', size: 11.5 },
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            title: tooltipItems => {
              const idx = tooltipItems[0].dataIndex;
              const d = items[idx];
              return `${d.name} (${d.code}) • ${d.drugClass}${d.isUrineOnly ? ' [Urine only]' : ''}`;
            },
            label: ctx => {
              const idx = ctx.dataIndex;
              const d = items[idx];
              if (!d.isTested) return 'Untested on this species';
              if (d.isIntrinsic) return 'CLSI Intrinsic Resistance: Inherently resistant (100% R)';
              if (metric === 'S') {
                return `Susceptible (%S): ${d.pctS}% (${d.sCount} / ${d.testedCount} isolates)`;
              }
              if (metric === 'R') {
                return `Resistant (%R): ${d.pctR}% (${d.rCount} / ${d.testedCount} isolates)`;
              }
              if (ctx.datasetIndex === 0) return `Susceptible (%S): ${d.pctS}% (${d.sCount} / ${d.testedCount} isolates)`;
              if (ctx.datasetIndex === 1) return `Intermediate / SDD (%I): ${d.pctI}% (${d.iCount} / ${d.testedCount} isolates)`;
              if (ctx.datasetIndex === 2) return `Resistant (%R): ${d.pctR}% (${d.rCount} / ${d.testedCount} isolates)`;
              return '';
            }
          }
        }
      }
    }
  });
}

async function copyCanvasToClipboard(canvas, chartTitle = 'Chart') {
  if (!canvas) return toast('No chart canvas found', 'error');

  try {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const bgColor = isDark ? '#121826' : '#ffffff';

    const offscreen = document.createElement('canvas');
    offscreen.width = canvas.width;
    offscreen.height = canvas.height;
    const ctx = offscreen.getContext('2d');

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, offscreen.width, offscreen.height);
    ctx.drawImage(canvas, 0, 0);

    const blob = await new Promise((resolve) => offscreen.toBlob(resolve, 'image/png', 1.0));
    if (!blob) throw new Error('Could not generate image blob');

    if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
      const item = new ClipboardItem({ 'image/png': blob });
      await navigator.clipboard.write([item]);
      toast(`${chartTitle} copied to clipboard! Paste directly into Word or Excel (Ctrl + V)`, 'success');
    } else {
      throw new Error('ClipboardItem API not supported in this browser');
    }
  } catch (err) {
    console.warn('Could not copy image to clipboard directly:', err);
    toast('Direct clipboard image copy not supported by your browser. Please use Download PNG.', 'info');
  }
}

export function copySpectrumChartData() {
  if (!activeSpectrumOrgCode || !currentReportData || !currentReportData.organisms) {
    return toast('No chart data available to copy', 'error');
  }
  const org = currentReportData.organisms.find(o => o.orgCode.toLowerCase() === activeSpectrumOrgCode.toLowerCase());
  if (!org) return toast('Organism data not found', 'error');

  const sortSelect = document.getElementById('spectrum-sort-select');
  const sortMode = sortSelect ? sortSelect.value : 'susc_desc';
  const hideUntested = document.getElementById('spectrum-hide-untested')?.checked ?? true;
  const metric = document.getElementById('spectrum-metric-select')?.value || 'all';

  const allAntibiotics = currentReportData.antibiotics || [];
  let items = [];
  for (const drug of allAntibiotics) {
    const stats = org.drugStats[drug.code];
    const isTested = stats && (stats.testedCount > 0 || stats.isIntrinsic);
    if (hideUntested && !isTested) continue;

    items.push({
      code: drug.code,
      name: drug.name || drug.code || 'Unknown',
      drugClass: drug.class || 'Other',
      isUrineOnly: !!drug.isUrineOnly,
      pctS: stats?.pctS || 0,
      pctI: stats?.pctI || 0,
      pctR: stats?.pctR || 0,
      isIntrinsic: !!stats?.isIntrinsic,
      testedCount: stats?.testedCount || 0,
      sCount: stats?.sCount || 0,
      iCount: stats?.iCount || 0,
      rCount: stats?.rCount || 0,
      isTested
    });
  }

  // Sort identical to chart
  if (sortMode === 'susc_desc') {
    items.sort((a, b) => b.pctS - a.pctS || a.name.localeCompare(b.name));
  } else if (sortMode === 'susc_asc') {
    items.sort((a, b) => a.pctS - b.pctS || a.name.localeCompare(b.name));
  } else if (sortMode === 'res_desc') {
    items.sort((a, b) => b.pctR - a.pctR || a.name.localeCompare(b.name));
  } else if (sortMode === 'res_asc') {
    items.sort((a, b) => a.pctR - b.pctR || a.name.localeCompare(b.name));
  } else if (sortMode === 'class') {
    items.sort((a, b) => a.drugClass.localeCompare(b.drugClass) || (metric === 'R' ? b.pctR - a.pctR : b.pctS - a.pctS) || a.name.localeCompare(b.name));
  } else if (sortMode === 'alpha') {
    items.sort((a, b) => a.name.localeCompare(b.name));
  }

  if (!items.length) {
    return toast('No antibiotic data to copy for this selection', 'warning');
  }

  // Build TSV and HTML table
  let headers = [];
  if (metric === 'S') {
    headers = ['Antibiotic', 'Code', 'Class', '% Susceptible (%S)', 'Susceptible (n)', 'Tested (N)'];
  } else if (metric === 'R') {
    headers = ['Antibiotic', 'Code', 'Class', '% Resistant (%R)', 'Resistant (n)', 'Tested (N)', 'Intrinsic Resistance'];
  } else {
    headers = ['Antibiotic', 'Code', 'Class', '% Susceptible (%S)', '% Intermediate (%I)', '% Resistant (%R)', 'Tested (N)'];
  }

  const tsvRows = [headers.join('\t')];
  let htmlRows = `<tr>${headers.map(h => `<th style="background:#f1f5f9;border:1px solid #cbd5e1;padding:6px 10px;font-weight:bold;text-align:center;">${h}</th>`).join('')}</tr>`;

  for (const d of items) {
    let drugDisplayName = d.name;
    if (d.isUrineOnly) drugDisplayName += ' [Urine]';

    let row = [];
    if (metric === 'S') {
      row = [drugDisplayName, d.code, d.drugClass, `${d.pctS}%`, d.sCount, d.testedCount];
    } else if (metric === 'R') {
      row = [drugDisplayName, d.code, d.drugClass, `${d.pctR}%`, d.rCount, d.testedCount, d.isIntrinsic ? 'Yes' : 'No'];
    } else {
      row = [drugDisplayName, d.code, d.drugClass, `${d.pctS}%`, `${d.pctI}%`, `${d.pctR}%`, d.testedCount];
    }

    tsvRows.push(row.join('\t'));
    htmlRows += `<tr>${row.map(c => `<td style="border:1px solid #e2e8f0;padding:5px 8px;text-align:${typeof c === 'number' || (typeof c === 'string' && c.endsWith('%')) ? 'center' : 'left'};">${c}</td>`).join('')}</tr>`;
  }

  const tsvText = tsvRows.join('\n');
  const htmlTable = `<table border="1" style="border-collapse:collapse;font-family:sans-serif;font-size:12px;">${htmlRows}</table>`;

  if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
    const textBlob = new Blob([tsvText], { type: 'text/plain' });
    const htmlBlob = new Blob([htmlTable], { type: 'text/html' });
    navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': textBlob,
        'text/html': htmlBlob
      })
    ]).then(() => {
      toast('Chart data copied to clipboard! Paste into Excel (Ctrl + V) and press Alt + F1 to create a native editable chart.', 'success');
    }).catch(() => {
      navigator.clipboard.writeText(tsvText)
        .then(() => toast('Chart data copied to clipboard (TSV format for Excel)', 'success'))
        .catch(() => toast('Failed to copy data', 'error'));
    });
  } else {
    navigator.clipboard.writeText(tsvText)
      .then(() => toast('Chart data copied to clipboard (TSV format for Excel)', 'success'))
      .catch(() => toast('Failed to copy data', 'error'));
  }
}

export function copySpectrumChartImage() {
  if (!spectrumChartInstance) return toast('No spectrum chart to copy', 'error');
  const canvas = document.getElementById('spectrum-chart-canvas');
  const metric = document.getElementById('spectrum-metric-select')?.value || 'all';
  const metricTitle = metric === 'S' ? '%S' : metric === 'R' ? '%R' : 'Spectrum';
  copyCanvasToClipboard(canvas, `${activeSpectrumOrgCode || 'Organism'} AST ${metricTitle} Chart`);
}

export function downloadSpectrumChartPng() {
  if (!spectrumChartInstance) return toast('No spectrum chart to download', 'error');
  const canvas = document.getElementById('spectrum-chart-canvas');
  if (!canvas) return;

  const metric = document.getElementById('spectrum-metric-select')?.value || 'all';
  const orientation = document.getElementById('spectrum-orientation-select')?.value || 'horizontal';

  const url = canvas.toDataURL('image/png', 1.0);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Spectrum_${activeSpectrumOrgCode || 'Organism'}_${metric}_${orientation}_${new Date().toISOString().slice(0, 10)}.png`;
  a.click();
  toast('Spectrum chart downloaded as PNG image', 'success');
}

// Close spectrum modal on backdrop click
document.getElementById('organism-spectrum-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'organism-spectrum-modal') {
    closeOrganismSpectrumModal();
  }
});

// ── Longitudinal AMR Trends State & Controller ──

export let currentAntibiogramViewMode = 'table'; // 'table' | 'trends' | 'locations'
let currentTrendIndicator = 'mrsa'; // 'mrsa' | 'cre' | 'esbl' | 'crab' | 'crpa' | 'vre' | 'fq_gn' | 'custom'
let currentTrendMetric = 'R'; // 'R' | 'S'
let trendChartInstance = null;

let currentLocationMetric = 'S'; // 'S' | 'R'
let currentLocationOrgCode = null;
let locationChartInstance = null;

export function setAntibiogramViewMode(mode) {
  currentAntibiogramViewMode = mode;
  const btnTable = document.getElementById('btn-abx-view-table');
  const btnTrends = document.getElementById('btn-abx-view-trends');
  const btnLocations = document.getElementById('btn-abx-view-locations');
  const tableView = document.getElementById('antibiogram-table-view');
  const trendsView = document.getElementById('antibiogram-trends-view');
  const locationsView = document.getElementById('antibiogram-locations-view');
  const btnCopyTable = document.getElementById('btn-abx-copy-table');

  if (btnTable) btnTable.classList.toggle('active', mode === 'table');
  if (btnTrends) btnTrends.classList.toggle('active', mode === 'trends');
  if (btnLocations) btnLocations.classList.toggle('active', mode === 'locations');

  if (tableView) tableView.style.display = mode === 'table' ? 'block' : 'none';
  if (trendsView) trendsView.style.display = mode === 'trends' ? 'block' : 'none';
  if (locationsView) locationsView.style.display = mode === 'locations' ? 'block' : 'none';

  if (btnCopyTable) btnCopyTable.style.display = mode === 'table' ? 'inline-flex' : 'none';

  if (mode === 'trends') {
    renderAmrTrendChart();
  } else if (mode === 'locations') {
    populateLocationOrgDropdown();
    renderLocationStratificationChart();
  }
}

export function setAmrTrendIndicator(indicator) {
  currentTrendIndicator = indicator;
  document.querySelectorAll('.abx-trend-pill').forEach(btn => {
    btn.classList.toggle('active', btn.id === `pill-trend-${indicator}` || (indicator === 'fq_gn' && btn.id === 'pill-trend-fq'));
  });

  const customRow = document.getElementById('trend-custom-controls');
  if (customRow) {
    customRow.style.display = indicator === 'custom' ? 'flex' : 'none';
    if (indicator === 'custom') {
      populateTrendCustomDropdowns();
    }
  }

  renderAmrTrendChart();
}

export function setTrendMetric(metric) {
  currentTrendMetric = metric;
  const btnR = document.getElementById('btn-trend-metric-r');
  const btnS = document.getElementById('btn-trend-metric-s');
  if (btnR) btnR.classList.toggle('active', metric === 'R');
  if (btnS) btnS.classList.toggle('active', metric === 'S');
  renderAmrTrendChart();
}

function populateTrendCustomDropdowns() {
  if (!currentReportData) return;
  const orgSel = document.getElementById('trend-custom-org-select');
  const abxSel = document.getElementById('trend-custom-abx-select');
  if (!orgSel || !abxSel) return;

  if (orgSel.options.length === 0 && currentReportData.organisms) {
    orgSel.innerHTML = currentReportData.organisms.map(o =>
      `<option value="${o.orgCode}">${escapeHtml(o.orgName)} (${o.orgCode})</option>`
    ).join('');
  }

  if (abxSel.options.length === 0 && currentReportData.antibiotics) {
    abxSel.innerHTML = currentReportData.antibiotics.map(a =>
      `<option value="${a.code}">${escapeHtml(a.name)} (${a.code})</option>`
    ).join('');
  }
}

export function renderAmrTrendChart() {
  const trends = currentReportData?.trends;
  const monthlyList = trends?.monthly || [];

  const canvas = document.getElementById('amr-trends-chart-canvas');
  if (!canvas) return;

  if (typeof Chart === 'undefined') {
    console.warn('Chart.js is not loaded');
    return;
  }

  const headingEl = document.getElementById('trend-chart-heading');
  const subEl = document.getElementById('trend-chart-sub');
  const dateBadge = document.getElementById('trend-date-range-badge');
  const kpiTested = document.getElementById('trend-kpi-tested');
  const kpiTestedSub = document.getElementById('trend-kpi-tested-sub');
  const kpiAvg = document.getElementById('trend-kpi-avg');
  const kpiAvgSub = document.getElementById('trend-kpi-avg-sub');
  const kpiLatest = document.getElementById('trend-kpi-latest');
  const kpiLatestSub = document.getElementById('trend-kpi-latest-sub');
  const kpiStatus = document.getElementById('trend-kpi-status');
  const kpiStatusSub = document.getElementById('trend-kpi-status-sub');
  const tableBody = document.getElementById('trend-table-body');

  const locFilter = document.getElementById('trend-location-filter')?.value || 'all';

  const INDICATOR_META = {
    mrsa: {
      title: 'Methicillin-Resistant Staphylococcus aureus (MRSA)',
      pathogen: 'S. aureus',
      agents: 'Cefoxitin / Oxacillin',
      whoStatus: 'High Priority (WHO Priority 2)',
      whoColor: '#f59e0b'
    },
    cre: {
      title: 'Carbapenem-Resistant Enterobacterales (CRE)',
      pathogen: 'E. coli, K. pneumoniae, Enterobacter spp.',
      agents: 'Meropenem, Imipenem, Ertapenem',
      whoStatus: 'Critical Priority (WHO Priority 1)',
      whoColor: '#ef4444'
    },
    esbl: {
      title: 'Extended-Spectrum Beta-Lactamase (ESBL)',
      pathogen: 'E. coli & K. pneumoniae',
      agents: 'Ceftriaxone, Cefotaxime, Ceftazidime',
      whoStatus: 'Critical Priority (WHO Priority 1)',
      whoColor: '#ef4444'
    },
    crab: {
      title: 'Carbapenem-Resistant Acinetobacter baumannii (CRAB)',
      pathogen: 'Acinetobacter baumannii',
      agents: 'Meropenem, Imipenem',
      whoStatus: 'Critical Priority (WHO Priority 1)',
      whoColor: '#ef4444'
    },
    crpa: {
      title: 'Carbapenem-Resistant Pseudomonas aeruginosa (CRPA)',
      pathogen: 'Pseudomonas aeruginosa',
      agents: 'Meropenem, Imipenem',
      whoStatus: 'Critical Priority (WHO Priority 1)',
      whoColor: '#ef4444'
    },
    vre: {
      title: 'Vancomycin-Resistant Enterococcus (VRE)',
      pathogen: 'Enterococcus faecalis & E. faecium',
      agents: 'Vancomycin',
      whoStatus: 'High Priority (WHO Priority 2)',
      whoColor: '#f59e0b'
    },
    fq_gn: {
      title: 'Fluoroquinolone Resistance in Gram-Negatives',
      pathogen: 'Enterobacterales, A. baumannii, P. aeruginosa',
      agents: 'Ciprofloxacin, Levofloxacin',
      whoStatus: 'Medium Priority (WHO Priority 3)',
      whoColor: '#3b82f6'
    },
    custom: {
      title: 'Custom Organism & Antibiotic Longitudinal Trend',
      pathogen: 'Custom',
      agents: 'Custom',
      whoStatus: 'Custom Monitored Pair',
      whoColor: 'var(--accent)'
    }
  };

  const meta = INDICATOR_META[currentTrendIndicator] || INDICATOR_META.mrsa;

  const labels = [];
  const rateData = [];
  const volumeData = [];
  const tableRows = [];

  let sumR = 0;
  let sumS = 0;
  let sumI = 0;
  let sumTotal = 0;

  const customOrg = document.getElementById('trend-custom-org-select')?.value || 'eco';
  const customAbx = document.getElementById('trend-custom-abx-select')?.value || 'CRO';

  for (const m of monthlyList) {
    const monthLabel = formatAmrMonthLabel(m.month);
    labels.push(monthLabel);

    let stat = null;
    if (currentTrendIndicator === 'custom') {
      const pair = m.pairs?.[`${customOrg.toLowerCase()}:${customAbx.toUpperCase()}`];
      stat = pair ? {
        total: pair.total,
        R: pair.R,
        S: pair.S,
        I: pair.I,
        pctR: pair.total > 0 ? Math.round((pair.R / pair.total) * 100) : null,
        pctS: pair.total > 0 ? Math.round((pair.S / pair.total) * 100) : null
      } : { total: 0, R: 0, S: 0, I: 0, pctR: null, pctS: null };
    } else {
      stat = m[currentTrendIndicator] || { total: 0, R: 0, S: 0, I: 0, pctR: null, pctS: null };
    }

    if (locFilter !== 'all' && m.locations && stat.total > 0) {
      const locRate = m.locations[locFilter];
      const locVol = m.locations[`${locFilter}Total`] || 0;
      if (locVol > 0) {
        stat = {
          total: locVol,
          R: Math.round((locRate / 100) * locVol),
          S: locVol - Math.round((locRate / 100) * locVol),
          I: 0,
          pctR: locRate,
          pctS: 100 - locRate
        };
      } else {
        stat = { total: 0, R: 0, S: 0, I: 0, pctR: null, pctS: null };
      }
    }

    const rate = currentTrendMetric === 'R' ? stat.pctR : stat.pctS;
    rateData.push(rate);
    volumeData.push(stat.total);

    sumR += stat.R || 0;
    sumS += stat.S || 0;
    sumI += stat.I || 0;
    sumTotal += stat.total || 0;

    tableRows.push(`
      <tr style="border-bottom: 1px solid var(--border);">
        <td style="padding: 8px 12px; font-weight: 600; color: var(--text);">${monthLabel}</td>
        <td style="padding: 8px 10px; text-align: center; color: var(--text2); font-family: 'JetBrains Mono', monospace;">${stat.total}</td>
        <td style="padding: 8px 10px; text-align: center; color: var(--red); font-weight: 700; font-family: 'JetBrains Mono', monospace;">${stat.R || 0}</td>
        <td style="padding: 8px 10px; text-align: center; color: var(--green); font-weight: 700; font-family: 'JetBrains Mono', monospace;">${stat.S || 0}</td>
        <td style="padding: 8px 10px; text-align: center; color: var(--yellow); font-family: 'JetBrains Mono', monospace;">${stat.I || 0}</td>
        <td style="padding: 8px 12px; text-align: right; font-weight: 800; font-family: 'JetBrains Mono', monospace; color: ${rate !== null && rate > 40 ? 'var(--red)' : (rate !== null && rate < 20 ? 'var(--green)' : 'var(--text)')};">
          ${rate !== null ? rate + '%' : '—'}
        </td>
      </tr>
    `);
  }

  const metricName = currentTrendMetric === 'R' ? 'Resistance' : 'Susceptibility';
  if (headingEl) {
    headingEl.innerHTML = `<i class="fa-solid fa-chart-line" style="color: var(--accent);"></i> ${meta.title} — ${metricName} (%${currentTrendMetric})`;
  }
  if (subEl) {
    subEl.textContent = `Pathogen: ${meta.pathogen} • Agents: ${meta.agents} • Location: ${locFilter.toUpperCase()}`;
  }
  if (dateBadge && monthlyList.length) {
    dateBadge.textContent = `${monthlyList[0].month} through ${monthlyList[monthlyList.length - 1].month}`;
  }

  if (kpiTested) kpiTested.textContent = sumTotal.toLocaleString();
  if (kpiTestedSub) kpiTestedSub.textContent = `Isolates evaluated in period`;

  const weightedAvg = sumTotal > 0 ? Math.round((currentTrendMetric === 'R' ? sumR : sumS) / sumTotal * 100) : null;
  if (kpiAvg) {
    kpiAvg.textContent = weightedAvg !== null ? `${weightedAvg}%` : '—';
    kpiAvg.style.color = currentTrendMetric === 'R' && weightedAvg > 40 ? 'var(--red)' : (currentTrendMetric === 'S' && weightedAvg > 75 ? 'var(--green)' : 'var(--accent)');
  }
  if (kpiAvgSub) kpiAvgSub.textContent = `Weighted mean %${currentTrendMetric} (${sumTotal} tested)`;

  const validRates = rateData.filter(r => r !== null);
  const latestRate = validRates.length ? validRates[validRates.length - 1] : null;
  const priorRate = validRates.length > 1 ? validRates[validRates.length - 2] : null;

  if (kpiLatest) {
    kpiLatest.textContent = latestRate !== null ? `${latestRate}%` : '—';
  }
  if (kpiLatestSub) {
    if (latestRate !== null && priorRate !== null) {
      const diff = latestRate - priorRate;
      const arrow = diff > 0 ? '↑' : (diff < 0 ? '↓' : '→');
      const color = (currentTrendMetric === 'R' && diff > 0) || (currentTrendMetric === 'S' && diff < 0) ? 'var(--red)' : 'var(--green)';
      kpiLatestSub.innerHTML = `<span style="color: ${color}; font-weight: 700;">${arrow} ${Math.abs(diff)}%</span> vs previous month`;
    } else {
      kpiLatestSub.textContent = 'Most recent surveillance month';
    }
  }

  if (kpiStatus) {
    kpiStatus.textContent = meta.whoStatus;
    kpiStatus.style.color = meta.whoColor;
  }
  if (kpiStatusSub) {
    kpiStatusSub.textContent = currentTrendIndicator === 'custom' ? 'User-defined AST query' : 'Clinical priority benchmark';
  }

  if (tableBody) {
    tableBody.innerHTML = tableRows.length ? tableRows.join('') : '<tr><td colspan="6" style="padding:24px;text-align:center;color:var(--text3);">No records found for this indicator</td></tr>';
  }

  if (trendChartInstance) {
    try { trendChartInstance.destroy(); } catch (_) {}
    trendChartInstance = null;
  }

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const textColor = isDark ? '#e2e8f0' : '#334155';
  const mutedColor = isDark ? '#94a3b8' : '#64748b';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(226, 232, 240, 0.8)';
  const tooltipBg = isDark ? 'rgba(18, 24, 38, 0.96)' : 'rgba(15, 23, 42, 0.95)';

  const primaryLineColor = currentTrendMetric === 'R' ? '#ef4444' : '#10b981';
  const primaryAreaColor = currentTrendMetric === 'R' ? 'rgba(239, 68, 68, 0.12)' : 'rgba(16, 185, 129, 0.12)';
  const barVolumeColor = isDark ? 'rgba(148, 163, 184, 0.2)' : 'rgba(100, 116, 139, 0.15)';

  const ctx = canvas.getContext('2d');

  trendChartInstance = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        {
          type: 'line',
          label: `% ${metricName} (%${currentTrendMetric})`,
          data: rateData,
          borderColor: primaryLineColor,
          backgroundColor: primaryAreaColor,
          borderWidth: 2.5,
          tension: 0.35,
          fill: true,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: primaryLineColor,
          pointBorderColor: '#ffffff',
          pointBorderWidth: 1.5,
          yAxisID: 'y'
        },
        {
          type: 'bar',
          label: 'Isolates Tested (Volume)',
          data: volumeData,
          backgroundColor: barVolumeColor,
          borderRadius: 4,
          maxBarThickness: 28,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      interaction: {
        mode: 'index',
        intersect: false
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: mutedColor,
            font: { family: 'Plus Jakarta Sans', size: 11, weight: '600' }
          }
        },
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          min: 0,
          max: 100,
          grid: { color: gridColor },
          ticks: {
            color: textColor,
            font: { family: 'JetBrains Mono', size: 11, weight: '600' },
            callback: v => `${v}%`
          },
          title: {
            display: true,
            text: `% ${metricName} (%${currentTrendMetric})`,
            color: mutedColor,
            font: { family: 'Plus Jakarta Sans', size: 11, weight: '700' }
          }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          beginAtZero: true,
          grid: { drawOnChartArea: false },
          ticks: {
            color: mutedColor,
            font: { family: 'JetBrains Mono', size: 10.5 },
            precision: 0
          },
          title: {
            display: true,
            text: 'Tested Isolates (N)',
            color: mutedColor,
            font: { family: 'Plus Jakarta Sans', size: 11 }
          }
        }
      },
      plugins: {
        legend: {
          position: 'top',
          align: 'end',
          labels: {
            color: textColor,
            boxWidth: 12,
            boxHeight: 12,
            font: { family: 'Plus Jakarta Sans', size: 11.5, weight: '600' }
          }
        },
        tooltip: {
          backgroundColor: tooltipBg,
          titleFont: { family: 'Plus Jakarta Sans', size: 12, weight: 'bold' },
          bodyFont: { family: 'Plus Jakarta Sans', size: 11.5 },
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            label: ctx => {
              if (ctx.datasetIndex === 0) {
                const val = ctx.parsed.y;
                return val !== null ? `Rate: ${val}% (${currentTrendMetric === 'R' ? 'Resistant' : 'Susceptible'})` : 'No data in month';
              }
              return `Volume Tested: ${ctx.parsed.y} isolates`;
            }
          }
        }
      }
    }
  });
}

export function copyAmrTrendImage() {
  if (!trendChartInstance) return toast('No AMR trend chart to copy', 'error');
  const canvas = document.getElementById('amr-trends-chart-canvas');
  copyCanvasToClipboard(canvas, 'AMR Trend chart');
}

export function downloadAmrTrendPng() {
  if (!trendChartInstance) return toast('No AMR trend chart to download', 'error');
  const canvas = document.getElementById('amr-trends-chart-canvas');
  if (!canvas) return;

  const url = canvas.toDataURL('image/png', 1.0);
  const a = document.createElement('a');
  a.href = url;
  a.download = `AMR_Trend_${currentTrendIndicator}_${new Date().toISOString().slice(0, 10)}.png`;
  a.click();
  toast('AMR trend chart downloaded as PNG image', 'success');
}

export function copyTrendTableTsv() {
  const table = document.querySelector('#antibiogram-trends-view table');
  if (!table) return toast('No trend table to copy', 'error');

  const rows = [];
  table.querySelectorAll('tr').forEach(tr => {
    const cols = [];
    tr.querySelectorAll('th, td').forEach(td => cols.push(td.textContent.trim()));
    rows.push(cols.join('\t'));
  });

  navigator.clipboard.writeText(rows.join('\n'))
    .then(() => toast('Monthly AMR breakdown copied to clipboard', 'success'))
    .catch(() => toast('Could not copy to clipboard', 'error'));
}

// ── Care Location Stratification (CLSI M39 Section 6.4) Controller ──

export function setLocationMetric(metric) {
  currentLocationMetric = metric;
  const btnS = document.getElementById('btn-loc-metric-s');
  const btnR = document.getElementById('btn-loc-metric-r');
  if (btnS) btnS.classList.toggle('active', metric === 'S');
  if (btnR) btnR.classList.toggle('active', metric === 'R');
  renderLocationStratificationChart();
}

export function populateLocationOrgDropdown() {
  const select = document.getElementById('loc-org-select');
  if (!select || !currentReportData?.locations?.orgList) return;

  const orgList = currentReportData.locations.orgList;
  if (!orgList.length) {
    select.innerHTML = '<option value="">No organism data available</option>';
    return;
  }

  const prevValue = select.value || currentLocationOrgCode;
  const optionsHtml = orgList.map(o => {
    const isSelected = o.orgCode === prevValue;
    return `<option value="${o.orgCode}" ${isSelected ? 'selected' : ''}>${escapeHtml(o.orgName)} (${o.orgCode.toUpperCase()}) — ${o.totalCount} isolates</option>`;
  }).join('');

  select.innerHTML = optionsHtml;
  if (!select.value && orgList.length > 0) {
    select.value = orgList[0].orgCode;
  }
  currentLocationOrgCode = select.value;
}

export function renderLocationStratificationChart() {
  const locData = currentReportData?.locations;
  if (!locData || !locData.orgList || !locData.orgList.length) {
    const tableBody = document.getElementById('loc-table-body');
    if (tableBody) {
      tableBody.innerHTML = '<tr><td colspan="9" style="padding: 24px; text-align: center; color: var(--text3);">Load an active database to view location stratification</td></tr>';
    }
    return;
  }

  const select = document.getElementById('loc-org-select');
  if (select && (!select.options.length || select.options[0]?.value === '')) {
    populateLocationOrgDropdown();
  }

  const orgCode = (select?.value || currentLocationOrgCode || locData.orgList[0]?.orgCode || '').toLowerCase();
  currentLocationOrgCode = orgCode;

  const org = locData.byOrg[orgCode];
  if (!org) return;

  const hideEmpty = document.getElementById('loc-hide-empty')?.checked ?? true;
  const isMetricS = currentLocationMetric === 'S';

  // 1. KPI Cards
  const kpiIcu = document.getElementById('loc-kpi-icu');
  const kpiIcuSub = document.getElementById('loc-kpi-icu-sub');
  const kpiInpat = document.getElementById('loc-kpi-inpatient');
  const kpiInpatSub = document.getElementById('loc-kpi-inpatient-sub');
  const kpiOutpat = document.getElementById('loc-kpi-outpatient');
  const kpiOutpatSub = document.getElementById('loc-kpi-outpatient-sub');
  const kpiDisparity = document.getElementById('loc-kpi-disparity');
  const kpiDisparitySub = document.getElementById('loc-kpi-disparity-sub');
  const metaBadge = document.getElementById('loc-org-meta-badge');

  const icuPct = org.totalCount > 0 ? Math.round((org.icuCount / org.totalCount) * 100) : 0;
  const inpatPct = org.totalCount > 0 ? Math.round((org.inpatientCount / org.totalCount) * 100) : 0;
  const outpatPct = org.totalCount > 0 ? Math.round((org.outpatientCount / org.totalCount) * 100) : 0;

  if (kpiIcu) kpiIcu.textContent = org.icuCount.toLocaleString();
  if (kpiIcuSub) kpiIcuSub.textContent = `${icuPct}% of ${org.orgName} (${org.totalCount} total)`;

  if (kpiInpat) kpiInpat.textContent = org.inpatientCount.toLocaleString();
  if (kpiInpatSub) kpiInpatSub.textContent = `${inpatPct}% of ${org.orgName} (${org.totalCount} total)`;

  if (kpiOutpat) kpiOutpat.textContent = org.outpatientCount.toLocaleString();
  if (kpiOutpatSub) kpiOutpatSub.textContent = `${outpatPct}% of ${org.orgName} (${org.totalCount} total)`;

  if (metaBadge) {
    metaBadge.innerHTML = `Total Evaluated: <strong style="color:var(--text);">${org.totalCount} isolates</strong> (CLSI M39 §6.4)`;
  }

  // 2. Prepare Drug Items for Chart & Table
  let drugEntries = Object.values(org.drugs);
  if (hideEmpty) {
    drugEntries = drugEntries.filter(d => (d.icu.total > 0 || d.inpatient.total > 0 || d.outpatient.total > 0));
  }
  // Sort by drug class, then name
  drugEntries.sort((a, b) => a.class.localeCompare(b.class) || a.name.localeCompare(b.name));

  // Find maximum disparity
  let maxDeltaDrug = null;
  let maxDeltaVal = -1;
  for (const d of drugEntries) {
    const rawVal = isMetricS ? d.deltaS : d.deltaR;
    const absVal = Math.abs(rawVal ?? -1);
    if (absVal > maxDeltaVal && (d.icu.total > 0 || d.outpatient.total > 0)) {
      maxDeltaVal = absVal;
      maxDeltaDrug = d;
    }
  }

  if (kpiDisparity) {
    if (maxDeltaDrug && maxDeltaVal >= 0) {
      kpiDisparity.textContent = `Δ ${maxDeltaVal}% (${maxDeltaDrug.code})`;
      kpiDisparity.style.color = maxDeltaVal >= 25 ? 'var(--red)' : 'var(--accent)';
    } else {
      kpiDisparity.textContent = '—';
      kpiDisparity.style.color = 'var(--text)';
    }
  }
  if (kpiDisparitySub) {
    if (maxDeltaDrug && maxDeltaVal >= 0) {
      const metricLabel = isMetricS ? 'susceptibility delta' : 'resistance gap';
      kpiDisparitySub.textContent = `${maxDeltaDrug.name} — highest ${metricLabel}`;
    } else {
      kpiDisparitySub.textContent = 'Insufficient multi-setting data';
    }
  }

  // Headings
  const headingEl = document.getElementById('loc-chart-heading');
  const subEl = document.getElementById('loc-chart-sub');
  const metricText = isMetricS ? 'Susceptibility (%S)' : 'Resistance (%R)';
  if (headingEl) {
    headingEl.innerHTML = `<i class="fa-solid fa-hospital-user" style="color: var(--accent);"></i> ${escapeHtml(org.orgName)} (${org.orgCode.toUpperCase()}) — ${metricText} Stratification`;
  }
  if (subEl) {
    subEl.textContent = `Cross-setting analysis: ICU (${org.icuCount}) vs Inpatient Non-ICU (${org.inpatientCount}) vs Outpatient (${org.outpatientCount})`;
  }

  // 3. Render Table Rows
  const tableBody = document.getElementById('loc-table-body');
  if (tableBody) {
    if (!drugEntries.length) {
      tableBody.innerHTML = '<tr><td colspan="9" style="padding: 24px; text-align: center; color: var(--text3);">No tested antibiotics found for this organism</td></tr>';
    } else {
      const rowsHtml = drugEntries.map(d => {
        const icuRate = isMetricS ? d.icu.pctS : d.icu.pctR;
        const inpatRate = isMetricS ? d.inpatient.pctS : d.inpatient.pctR;
        const outpatRate = isMetricS ? d.outpatient.pctS : d.outpatient.pctR;
        const delta = isMetricS ? d.deltaS : d.deltaR;

        const formatRate = (rate, total, isIntrinsic) => {
          if (isIntrinsic) return `<span class="badge" style="background:var(--red-bg);color:var(--red);border:1px solid var(--red-border);padding:2px 6px;border-radius:4px;font-weight:700;">${isMetricS ? '0% (R)' : '100% (R)'}</span>`;
          if (total === 0 || rate === null) return `<span style="color:var(--text4);">—</span>`;
          const color = isMetricS
            ? (rate >= 75 ? 'var(--green)' : (rate < 50 ? 'var(--red)' : 'var(--text)'))
            : (rate >= 40 ? 'var(--red)' : (rate < 20 ? 'var(--green)' : 'var(--text)'));
          const warningNote = total < 30 ? ` <span title="Sample size < 30 (CLSI cautionary notice)" style="color:var(--yellow);font-size:10px;">⚠</span>` : '';
          return `<span style="font-weight:700;font-family:'JetBrains Mono',monospace;color:${color};">${rate}%</span>${warningNote}`;
        };

        const formatDelta = (dt) => {
          if (dt === null || dt === undefined) return '<span style="color:var(--text4);">—</span>';
          const sign = dt > 0 ? `+${dt}%` : (dt < 0 ? `${dt}%` : '0%');
          let color = 'var(--text)';
          let bg = 'var(--bg3)';
          if (Math.abs(dt) >= 20) {
            color = dt > 0 ? 'var(--red)' : 'var(--green)';
            bg = dt > 0 ? 'var(--red-bg)' : 'var(--green-bg)';
          }
          return `<span class="badge" style="background:${bg};color:${color};padding:2px 7px;border-radius:4px;font-weight:700;font-family:'JetBrains Mono',monospace;">${sign}</span>`;
        };

        const urineBadge = d.isUrineOnly ? ` <span class="badge" style="background:rgba(245,158,11,0.12);color:#f59e0b;border:1px solid rgba(245,158,11,0.25);font-size:9.5px;padding:1px 5px;border-radius:3px;">Urine</span>` : '';

        return `
          <tr style="border-bottom: 1px solid var(--border);">
            <td style="padding: 8px 12px; font-weight: 600; color: var(--text);">
              ${escapeHtml(d.name)} <span style="color:var(--text3);font-family:'JetBrains Mono',monospace;font-size:11px;">(${d.code})</span>${urineBadge}
            </td>
            <td style="padding: 8px 10px; color: var(--text3); font-size: 11px;">${escapeHtml(d.class)}</td>
            <td style="padding: 8px 10px; text-align: center; font-family: 'JetBrains Mono', monospace; border-left: 2px solid #6366f1; color: var(--text2);">${d.icu.total || '—'}</td>
            <td style="padding: 8px 10px; text-align: center;">${formatRate(icuRate, d.icu.total, d.icu.isIntrinsic)}</td>
            <td style="padding: 8px 10px; text-align: center; font-family: 'JetBrains Mono', monospace; border-left: 2px solid #10b981; color: var(--text2);">${d.inpatient.total || '—'}</td>
            <td style="padding: 8px 10px; text-align: center;">${formatRate(inpatRate, d.inpatient.total, d.inpatient.isIntrinsic)}</td>
            <td style="padding: 8px 10px; text-align: center; font-family: 'JetBrains Mono', monospace; border-left: 2px solid #f59e0b; color: var(--text2);">${d.outpatient.total || '—'}</td>
            <td style="padding: 8px 10px; text-align: center;">${formatRate(outpatRate, d.outpatient.total, d.outpatient.isIntrinsic)}</td>
            <td style="padding: 8px 12px; text-align: right; border-left: 1px solid var(--border);">${formatDelta(delta)}</td>
          </tr>
        `;
      }).join('');
      tableBody.innerHTML = rowsHtml;
    }
  }

  // 4. Render Grouped Bar Chart
  const canvas = document.getElementById('loc-comparison-canvas');
  if (!canvas || typeof Chart === 'undefined') return;

  if (locationChartInstance) {
    try { locationChartInstance.destroy(); } catch (_) {}
    locationChartInstance = null;
  }

  if (!drugEntries.length) return;

  // Dynamically size chart height so labels don't get truncated
  const canvasWrap = document.getElementById('loc-chart-wrapper');
  const neededHeight = Math.max(380, drugEntries.length * 30);
  if (canvasWrap) {
    canvasWrap.style.height = `${neededHeight}px`;
  }

  const labels = drugEntries.map(d => `${d.name} (${d.code})`);
  const icuData = drugEntries.map(d => isMetricS ? d.icu.pctS : d.icu.pctR);
  const inpatData = drugEntries.map(d => isMetricS ? d.inpatient.pctS : d.inpatient.pctR);
  const outpatData = drugEntries.map(d => isMetricS ? d.outpatient.pctS : d.outpatient.pctR);

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const textColor = isDark ? '#e2e8f0' : '#334155';
  const mutedColor = isDark ? '#94a3b8' : '#64748b';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(226, 232, 240, 0.8)';
  const tooltipBg = isDark ? 'rgba(18, 24, 38, 0.96)' : 'rgba(15, 23, 42, 0.95)';

  const ctx = canvas.getContext('2d');

  locationChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: `ICU Wards (N=${org.icuCount})`,
          data: icuData,
          backgroundColor: 'rgba(99, 102, 241, 0.85)',
          borderColor: '#6366f1',
          borderWidth: 1.5,
          borderRadius: 3
        },
        {
          label: `Inpatient Non-ICU (N=${org.inpatientCount})`,
          data: inpatData,
          backgroundColor: 'rgba(16, 185, 129, 0.85)',
          borderColor: '#10b981',
          borderWidth: 1.5,
          borderRadius: 3
        },
        {
          label: `Outpatient / OPD (N=${org.outpatientCount})`,
          data: outpatData,
          backgroundColor: 'rgba(245, 158, 11, 0.85)',
          borderColor: '#f59e0b',
          borderWidth: 1.5,
          borderRadius: 3
        }
      ]
    },
    options: {
      indexAxis: 'y', // Horizontal grouped bars for readable drug names
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      scales: {
        x: {
          min: 0,
          max: 100,
          grid: { color: gridColor },
          ticks: {
            color: textColor,
            font: { family: 'JetBrains Mono', size: 11, weight: '600' },
            callback: v => `${v}%`
          },
          title: {
            display: true,
            text: `% ${metricText}`,
            color: mutedColor,
            font: { family: 'Plus Jakarta Sans', size: 11, weight: '700' }
          }
        },
        y: {
          grid: { display: false },
          ticks: {
            color: textColor,
            font: { family: 'Plus Jakarta Sans', size: 11, weight: '600' },
            autoSkip: false
          }
        }
      },
      plugins: {
        legend: {
          position: 'top',
          align: 'end',
          labels: {
            color: textColor,
            boxWidth: 12,
            boxHeight: 12,
            font: { family: 'Plus Jakarta Sans', size: 11.5, weight: '600' }
          }
        },
        tooltip: {
          backgroundColor: tooltipBg,
          titleFont: { family: 'Plus Jakarta Sans', size: 12, weight: 'bold' },
          bodyFont: { family: 'Plus Jakarta Sans', size: 11.5 },
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            label: (ctx) => {
              const drug = drugEntries[ctx.dataIndex];
              const val = ctx.parsed.x;
              const setKey = ctx.datasetIndex === 0 ? 'icu' : (ctx.datasetIndex === 1 ? 'inpatient' : 'outpatient');
              const setName = ctx.datasetIndex === 0 ? 'ICU' : (ctx.datasetIndex === 1 ? 'Inpatient' : 'Outpatient');
              const testedN = drug[setKey]?.total || 0;
              if (val === null || val === undefined) return `${setName}: Not tested`;
              return `${setName}: ${val}% (N=${testedN})${testedN < 30 && testedN > 0 ? ' [N<30]' : ''}`;
            }
          }
        }
      }
    }
  });
}

export function copyLocationChartData() {
  const locData = currentReportData?.locations;
  const orgCode = currentLocationOrgCode || document.getElementById('loc-org-select')?.value;
  const org = locData?.byOrg?.[orgCode];
  if (!org) return toast('No location comparison data to copy', 'error');

  const hideEmpty = document.getElementById('loc-hide-empty')?.checked ?? true;
  const isMetricS = currentLocationMetric === 'S';
  const metricName = isMetricS ? '% Susceptible (%S)' : '% Resistant (%R)';

  let drugEntries = Object.values(org.drugs);
  if (hideEmpty) {
    drugEntries = drugEntries.filter(d => (d.icu.total > 0 || d.inpatient.total > 0 || d.outpatient.total > 0));
  }
  drugEntries.sort((a, b) => a.class.localeCompare(b.class) || a.name.localeCompare(b.name));

  const headers = [
    'Antibiotic',
    'Code',
    'Class',
    `ICU ${metricName}`,
    'ICU Tested (N)',
    `Inpatient ${metricName}`,
    'Inpatient Tested (N)',
    `Outpatient ${metricName}`,
    'Outpatient Tested (N)',
    'Disparity (Delta)'
  ];

  const tsvRows = [headers.join('\t')];
  let htmlRows = `<tr>${headers.map(h => `<th style="background:#f1f5f9;border:1px solid #cbd5e1;padding:6px 10px;font-weight:bold;text-align:center;">${h}</th>`).join('')}</tr>`;

  for (const d of drugEntries) {
    const icuRate = isMetricS ? d.icu.pctS : d.icu.pctR;
    const inpatRate = isMetricS ? d.inpatient.pctS : d.inpatient.pctR;
    const outpatRate = isMetricS ? d.outpatient.pctS : d.outpatient.pctR;
    const delta = isMetricS ? d.deltaS : d.deltaR;

    const row = [
      d.name + (d.isUrineOnly ? ' [Urine]' : ''),
      d.code,
      d.class,
      icuRate !== null ? `${icuRate}%` : '—',
      d.icu.total,
      inpatRate !== null ? `${inpatRate}%` : '—',
      d.inpatient.total,
      outpatRate !== null ? `${outpatRate}%` : '—',
      d.outpatient.total,
      delta !== null ? (delta > 0 ? `+${delta}%` : `${delta}%`) : '—'
    ];

    tsvRows.push(row.join('\t'));
    htmlRows += `<tr>${row.map(c => `<td style="border:1px solid #e2e8f0;padding:5px 8px;text-align:${typeof c === 'number' || (typeof c === 'string' && c.endsWith('%')) ? 'center' : 'left'};">${c}</td>`).join('')}</tr>`;
  }

  const tsvText = tsvRows.join('\n');
  const htmlTable = `<table border="1" style="border-collapse:collapse;font-family:sans-serif;font-size:12px;">${htmlRows}</table>`;

  if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
    const textBlob = new Blob([tsvText], { type: 'text/plain' });
    const htmlBlob = new Blob([htmlTable], { type: 'text/html' });
    navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': textBlob,
        'text/html': htmlBlob
      })
    ]).then(() => {
      toast('Location comparison data copied! Paste into Excel (Ctrl + V) and press Alt + F1 to create a native editable chart.', 'success');
    }).catch(() => {
      navigator.clipboard.writeText(tsvText)
        .then(() => toast('Location comparison data copied to clipboard (TSV format for Excel)', 'success'))
        .catch(() => toast('Failed to copy data', 'error'));
    });
  } else {
    navigator.clipboard.writeText(tsvText)
      .then(() => toast('Location comparison data copied to clipboard (TSV format for Excel)', 'success'))
      .catch(() => toast('Failed to copy data', 'error'));
  }
}

export function copyLocationChartImage() {
  if (!locationChartInstance) return toast('No location comparison chart to copy', 'error');
  const canvas = document.getElementById('loc-comparison-canvas');
  copyCanvasToClipboard(canvas, `${currentLocationOrgCode || 'Organism'} Care Location Comparison Chart`);
}

export function downloadLocationChartPng() {
  if (!locationChartInstance) return toast('No location comparison chart to download', 'error');
  const canvas = document.getElementById('loc-comparison-canvas');
  if (!canvas) return;

  const url = canvas.toDataURL('image/png', 1.0);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Location_Comparison_${currentLocationOrgCode || 'Organism'}_${currentLocationMetric}_${new Date().toISOString().slice(0, 10)}.png`;
  a.click();
  toast('Location comparison chart downloaded as PNG image', 'success');
}

export function copyLocationTableTsv() {
  const table = document.getElementById('loc-matrix-table');
  if (!table) return toast('No location table to copy', 'error');

  const rows = [];
  table.querySelectorAll('tr').forEach(tr => {
    const cols = [];
    tr.querySelectorAll('th, td').forEach(td => cols.push(td.textContent.trim().replace(/\s+/g, ' ')));
    rows.push(cols.join('\t'));
  });

  navigator.clipboard.writeText(rows.join('\n'))
    .then(() => toast('Location comparison matrix copied to clipboard', 'success'))
    .catch(() => toast('Could not copy to clipboard', 'error'));
}


