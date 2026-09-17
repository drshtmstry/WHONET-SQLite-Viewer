import { state } from "../state/store.js";
import { api } from "../api/client.js";
import { toast } from "../ui/toast.js";
import { renderSortHeader, renderPagination } from "../ui/table.js";
import { fmtDate, debounce } from "../utils/formatters.js";
import { renderOrgBadge } from "../utils/organisms.js";

export function setDupMode(mode) {
  if (state.dupMode === mode) return;
  state.dupMode = mode;
  document
    .getElementById("mode-btn-spec")
    ?.classList.toggle("active", mode === "spec");
  document
    .getElementById("mode-btn-patient")
    ?.classList.toggle("active", mode === "patient");

  const searchInput = document.getElementById("dup-search");
  if (searchInput) {
    searchInput.placeholder =
      mode === "patient"
        ? "Search by Patient ID or Name…"
        : "Search by Specimen # or Name…";
    searchInput.value = "";
  }

  if (state.stats) {
    const activeCount =
      mode === "patient"
        ? state.stats.dupPtRows || 0
        : state.stats.dupRows || 0;
    const badge = document.getElementById("dup-badge");
    if (badge) badge.textContent = activeCount;
  }

  loadDuplicates(1);
}

export function sortDuplicates(column) {
  if (state.dupSortCol === column) {
    state.dupSortDir = state.dupSortDir === "asc" ? "desc" : "asc";
  } else {
    state.dupSortCol = column;
    state.dupSortDir = "asc";
  }
  loadDuplicates(1);
}

export function groupRows(rows, mode = state.dupMode) {
  const groups = {};
  for (const r of rows) {
    const val = mode === "patient" ? r.PATIENT_ID || "" : r.SPEC_NUM || "";
    const key = val.trim().toUpperCase() || "(BLANK)";
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  }
  return groups;
}

export async function loadDuplicates(page = 1) {
  const dupBody = document.getElementById("dup-table-body");
  const countEl = document.getElementById("dup-count");
  const casingBanner = document.getElementById("casing-banner");
  if (!state.currentDb) {
    if (casingBanner) casingBanner.style.display = "none";
    if (countEl) countEl.textContent = "Open a database to view duplicates";
    if (dupBody) dupBody.innerHTML = '<div class="empty"><div class="empty-title">No database loaded</div></div>';
    return;
  }

  state.dupsPage = page;
  const datasetVersion = state.datasetVersion;
  const databaseName = state.currentDb;
  const search = encodeURIComponent(
    document.getElementById("dup-search")?.value || "",
  );
  const mode = state.dupMode;
  const sortParam = state.dupSortCol
    ? `&sortCol=${encodeURIComponent(state.dupSortCol)}&sortDir=${encodeURIComponent(state.dupSortDir)}`
    : "";

  // Check for mixed-case SPEC_NUMs and show/hide warning banner
  if (casingBanner) casingBanner.style.display = "none";
  if (dupBody) dupBody.innerHTML = '<div class="loading"><div class="spinner"></div>Loading duplicates…</div>';

  const casingCheck = await api("/api/custom-sql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sql: "SELECT COUNT(*) as c FROM Isolates WHERE SPEC_NUM != UPPER(SPEC_NUM) AND SPEC_NUM != ''",
    }),
  });
  if (datasetVersion !== state.datasetVersion || databaseName !== state.currentDb || !state.currentDb) {
    if (casingBanner) casingBanner.style.display = "none";
    return;
  }
  const hasMixedCase = (casingCheck?.rows?.[0]?.c || 0) > 0;
  if (casingBanner) {
    casingBanner.style.display = (hasMixedCase && state.currentDb) ? "flex" : "none";
  }

  const data = await api(
    `/api/duplicates?page=${page}&pageSize=50&search=${search}&mode=${mode}${sortParam}`,
  );
  if (datasetVersion !== state.datasetVersion || databaseName !== state.currentDb) return;
  if (data.error) return toast(data.error, "error");

  const modeLabel = mode === "patient" ? "Patient ID" : "Specimen ID";
  const groupCount = Object.keys(groupRows(data.rows, mode)).length;
  const totalGroups =
    mode === "patient"
      ? state.stats?.dupPtGroups || groupCount
      : state.stats?.dupGroups || groupCount;

  if (countEl) {
    countEl.textContent = `${data.totalCount.toLocaleString()} duplicate records across ${totalGroups.toLocaleString()} groups (ordered by ${modeLabel})`;
  }

  if (dupBody) {
    dupBody.innerHTML = renderDuplicatesTable(data.rows, mode);
    dupBody.scrollTop = 0;
    dupBody.scrollLeft = 0;
  }
  updateDupSelectedState();
  renderPagination("dup-pagination", page, data.totalCount, 50, loadDuplicates);
}

export function renderDuplicatesTable(rows, mode = state.dupMode) {
  const modeLabel = mode === "patient" ? "Patient ID" : "Specimen ID";
  if (!rows || !rows.length) {
    return `<div class="empty"><div class="empty-icon" style="color:var(--green)"><i class="fa-solid fa-circle-check"></i></div><div class="empty-title">No duplicates found by ${modeLabel}!</div></div>`;
  }

  let lastGroupKey = null;
  let clusterIdx = 0;
  const sCol = state.dupSortCol;
  const sDir = state.dupSortDir;
  const matchedLabel = mode === "patient" ? "Patient ID" : "Specimen #";
  const otherLabel = mode === "patient" ? "Specimen #" : "Patient ID";

  return `
    <table class="dup-table">
      <thead>
        <tr>
          <th class="col-check" style="text-align: center;">
            <input type="checkbox" id="dup-select-all" onchange="toggleSelectAllDups(this.checked)" title="Select all on this page" />
          </th>
          ${renderSortHeader("Row", "ROW_IDX", sCol, sDir, "sortDuplicates", 'class="col-row"')}
          ${renderSortHeader(matchedLabel, "MATCHED", sCol, sDir, "sortDuplicates", 'class="col-matched"')}
          ${renderSortHeader(otherLabel, "OTHER", sCol, sDir, "sortDuplicates", 'class="col-other"')}
          ${renderSortHeader("Patient Name", "FULL_NAME", sCol, sDir, "sortDuplicates", 'class="col-name"')}
          ${renderSortHeader("Date", "SPEC_DATE", sCol, sDir, "sortDuplicates", 'class="col-date"')}
          ${renderSortHeader("Type", "SPEC_TYPE", sCol, sDir, "sortDuplicates", 'class="col-type"')}
          ${renderSortHeader("Organism", "ORGANISM", sCol, sDir, "sortDuplicates", 'class="col-org"')}
          ${renderSortHeader("Sex", "SEX", sCol, sDir, "sortDuplicates", 'class="col-sex"')}
          ${renderSortHeader("Age", "AGE", sCol, sDir, "sortDuplicates", 'class="col-age"')}
          ${renderSortHeader("Ward", "WARD", sCol, sDir, "sortDuplicates", 'class="col-ward"')}
          <th class="col-actions">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map((r, idx) => {
            const keyVal =
              mode === "patient" ? r.PATIENT_ID || "" : r.SPEC_NUM || "";
            const groupKey = keyVal.trim().toUpperCase() || "(BLANK)";
            const isNewGroup = idx > 0 && groupKey !== lastGroupKey;
            if (idx === 0 || groupKey !== lastGroupKey) {
              clusterIdx++;
              lastGroupKey = groupKey;
            }

            const clusterClass = `dup-cluster-${clusterIdx % 2}`;
            const startClass = isNewGroup ? "dup-group-start" : "";

            const matchedVal =
              mode === "patient" ? r.PATIENT_ID || "—" : r.SPEC_NUM || "—";
            const otherVal =
              mode === "patient" ? r.SPEC_NUM || "—" : r.PATIENT_ID || "—";
            const safeSpecNum = (r.SPEC_NUM || "").replace(/'/g, "\\'");
            const fullName = r.FULL_NAME || "—";
            const specType = r.SPEC_TYPE || "—";
            const ward = r.WARD || "—";

            return `
            <tr class="dup-row ${clusterClass} ${startClass}">
              <td class="col-check" style="text-align: center;">
                <input type="checkbox" class="dup-row-check" value="${r.ROW_IDX}" onchange="updateDupSelectedState()" />
              </td>
              <td class="mono col-row" style="color:var(--text3);font-size:11px">#${r.ROW_IDX}</td>
              <td class="mono col-matched" style="font-size:11.5px;font-weight:700;color:var(--accent)" title="${matchedVal}"><span class="cell-truncate">${matchedVal}</span></td>
              <td class="mono col-other" style="font-size:11.5px;color:var(--text2)" title="${otherVal}"><span class="cell-truncate">${otherVal}</span></td>
              <td class="pt-name col-name" title="${fullName}"><span class="cell-truncate">${fullName}</span></td>
              <td class="col-date" style="white-space:nowrap;font-size:11.5px">${fmtDate(r.SPEC_DATE)}</td>
              <td class="col-type" title="${specType}"><span class="cell-truncate">${specType}</span></td>
              <td class="col-org">${renderOrgBadge(r.ORGANISM)}</td>
              <td class="col-sex" style="text-align:center;">${r.SEX || "—"}</td>
              <td class="col-age" style="text-align:center;">${r.AGE || "—"}</td>
              <td class="col-ward" title="${ward}"><span class="cell-truncate">${ward}</span></td>
              <td class="col-actions" style="text-align: right; white-space: nowrap;">
                <div class="dup-actions-group">
                  <button class="btn btn-ghost btn-xs" onclick="openEditModal(${r.ROW_IDX})" title="Edit / correct this isolate">Edit</button>
                  <button class="btn btn-ghost btn-xs" onclick="viewDetail(${r.ROW_IDX})" title="View isolate details">View</button>
                  <button class="btn btn-danger btn-xs" onclick="confirmDeleteRow(${r.ROW_IDX}, '${safeSpecNum}')" title="Delete this isolate">Del</button>
                </div>
              </td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table>`;
}

export function toggleSelectAllDups(checked) {
  const checkboxes = document.querySelectorAll(".dup-row-check");
  checkboxes.forEach((cb) => {
    cb.checked = checked;
  });
  updateDupSelectedState();
}

export function updateDupSelectedState() {
  const checkboxes = Array.from(document.querySelectorAll(".dup-row-check"));
  const checked = checkboxes.filter((cb) => cb.checked);
  const count = checked.length;

  const countEl = document.getElementById("dup-selected-count");
  if (countEl) countEl.textContent = count;

  const btn = document.getElementById("dup-delete-selected-btn");
  if (btn) {
    btn.disabled = count === 0;
    btn.style.opacity = count === 0 ? "0.5" : "1";
    btn.style.cursor = count === 0 ? "not-allowed" : "pointer";
  }

  const selectAll = document.getElementById("dup-select-all");
  if (selectAll && checkboxes.length > 0) {
    selectAll.checked = count === checkboxes.length;
    selectAll.indeterminate = count > 0 && count < checkboxes.length;
  } else if (selectAll) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
  }
}

export const debouncedLoadDups = debounce(() => loadDuplicates(1), 350);
