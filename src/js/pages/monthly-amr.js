import { state } from "../state/store.js";
import { api } from "../api/client.js";
import { toast } from "../ui/toast.js";
import { formatAmrMonthLabel, copyTableHtmlAndTsv } from "../utils/formatters.js";

export const AMR_HEADERS = [
  "Month, Year",
  "Total samples (Source: OPD)",
  "Total samples (Source: IPD)",
  "Total samples (Source: ICU)",
  "Total samples (Source: Others)",
  "Total samples (Source: Total)",
  "Culture Positive (Source: OPD)",
  "Culture Positive (Source: IPD)",
  "Culture Positive (Source: ICU)",
  "Culture Positive (Source: Others)",
  "Culture Positive (Source: Total)",
  "Total samples (Type: Blood)",
  "Total samples (Type: Pus)",
  "Total samples (Type: Sputum)",
  "Total samples (Type: Urine)",
  "Total samples (Type: Others)",
  "Total samples (Type: Total)",
  "Culture Positive (Type: Blood)",
  "Culture Positive (Type: Pus)",
  "Culture Positive (Type: Sputum)",
  "Culture Positive (Type: Urine)",
  "Culture Positive (Type: Others)",
  "Culture Positive (Type: Total)",
];

export async function loadMonthlyAmrData() {
  if (!state.currentDb) return;
  const datasetVersion = state.datasetVersion;
  const databaseName = state.currentDb;
  const data = await api("/api/monthly-amr");
  if (
    datasetVersion !== state.datasetVersion ||
    databaseName !== state.currentDb
  )
    return;
  if (data.error) return toast(data.error, "error");

  state.monthlyAmrData = data;
  renderAmrTable();
}

export function renderAmrTable() {
  const data = state.monthlyAmrData;
  const tableBody = document.getElementById("amr-table-body");
  if (!tableBody) return;

  if (!data || !data.monthlyData || !data.monthlyData.length) {
    tableBody.innerHTML = `
      <tr><td colspan="23" style="padding:24px;text-align:center;color:var(--text3);">No monthly records found</td></tr>
    `;
    return;
  }

  const totals = {
    srcSamples: { opd: 0, ipd: 0, icu: 0, others: 0, total: 0 },
    srcPositives: { opd: 0, ipd: 0, icu: 0, others: 0, total: 0 },
    typeSamples: { blood: 0, pus: 0, sputum: 0, urine: 0, others: 0, total: 0 },
    typePositives: {
      blood: 0,
      pus: 0,
      sputum: 0,
      urine: 0,
      others: 0,
      total: 0,
    },
  };

  const rowsHtml = data.monthlyData
    .map((m) => {
      totals.srcSamples.opd += m.srcSamples.opd;
      totals.srcSamples.ipd += m.srcSamples.ipd;
      totals.srcSamples.icu += m.srcSamples.icu;
      totals.srcSamples.others += m.srcSamples.others;
      totals.srcSamples.total += m.srcSamples.total;

      totals.srcPositives.opd += m.srcPositives.opd;
      totals.srcPositives.ipd += m.srcPositives.ipd;
      totals.srcPositives.icu += m.srcPositives.icu;
      totals.srcPositives.others += m.srcPositives.others;
      totals.srcPositives.total += m.srcPositives.total;

      totals.typeSamples.blood += m.typeSamples.blood;
      totals.typeSamples.pus += m.typeSamples.pus;
      totals.typeSamples.sputum += m.typeSamples.sputum;
      totals.typeSamples.urine += m.typeSamples.urine;
      totals.typeSamples.others += m.typeSamples.others;
      totals.typeSamples.total += m.typeSamples.total;

      totals.typePositives.blood += m.typePositives.blood;
      totals.typePositives.pus += m.typePositives.pus;
      totals.typePositives.sputum += m.typePositives.sputum;
      totals.typePositives.urine += m.typePositives.urine;
      totals.typePositives.others += m.typePositives.others;
      totals.typePositives.total += m.typePositives.total;

      const monthLabel = formatAmrMonthLabel(m.month);

      return `
      <tr class="amr-data-row">
        <td class="td-month">
          <a href="javascript:void(0)" onclick="showPage('isolates');const mf=document.getElementById('isolates-month-filter');if(mf){mf.value='${m.month}';loadIsolates(1);}" style="color:var(--primary);text-decoration:underline;cursor:pointer;" title="View isolates for ${monthLabel}">${monthLabel}</a>
        </td>

        <!-- Source of Sample -->
        <td class="td-num">${m.srcSamples.opd}</td>
        <td class="td-num">${m.srcSamples.ipd}</td>
        <td class="td-num">${m.srcSamples.icu}</td>
        <td class="td-num">${m.srcSamples.others}</td>
        <td class="td-num td-total">${m.srcSamples.total}</td>

        <!-- Positive by Source -->
        <td class="td-num">${m.srcPositives.opd}</td>
        <td class="td-num">${m.srcPositives.ipd}</td>
        <td class="td-num">${m.srcPositives.icu}</td>
        <td class="td-num">${m.srcPositives.others}</td>
        <td class="td-num td-total-pos">${m.srcPositives.total}</td>

        <!-- Type of sample -->
        <td class="td-num">${m.typeSamples.blood}</td>
        <td class="td-num">${m.typeSamples.pus}</td>
        <td class="td-num">${m.typeSamples.sputum}</td>
        <td class="td-num">${m.typeSamples.urine}</td>
        <td class="td-num">${m.typeSamples.others}</td>
        <td class="td-num td-total">${m.typeSamples.total}</td>

        <!-- Positive by Type -->
        <td class="td-num">${m.typePositives.blood}</td>
        <td class="td-num">${m.typePositives.pus}</td>
        <td class="td-num">${m.typePositives.sputum}</td>
        <td class="td-num">${m.typePositives.urine}</td>
        <td class="td-num">${m.typePositives.others}</td>
        <td class="td-num td-total-pos">${m.typePositives.total}</td>
      </tr>
    `;
    })
    .join("");

  const totalRowHtml = `
    <tr class="amr-summary-row">
      <td class="td-summary-label">Total</td>

      <!-- Source of Sample -->
      <td class="td-num">${totals.srcSamples.opd}</td>
      <td class="td-num">${totals.srcSamples.ipd}</td>
      <td class="td-num">${totals.srcSamples.icu}</td>
      <td class="td-num">${totals.srcSamples.others}</td>
      <td class="td-num td-summary-total">${totals.srcSamples.total}</td>

      <!-- Positive by Source -->
      <td class="td-num">${totals.srcPositives.opd}</td>
      <td class="td-num">${totals.srcPositives.ipd}</td>
      <td class="td-num">${totals.srcPositives.icu}</td>
      <td class="td-num">${totals.srcPositives.others}</td>
      <td class="td-num td-summary-pos">${totals.srcPositives.total}</td>

      <!-- Type of sample -->
      <td class="td-num">${totals.typeSamples.blood}</td>
      <td class="td-num">${totals.typeSamples.pus}</td>
      <td class="td-num">${totals.typeSamples.sputum}</td>
      <td class="td-num">${totals.typeSamples.urine}</td>
      <td class="td-num">${totals.typeSamples.others}</td>
      <td class="td-num td-summary-total">${totals.typeSamples.total}</td>

      <!-- Positive by Type -->
      <td class="td-num">${totals.typePositives.blood}</td>
      <td class="td-num">${totals.typePositives.pus}</td>
      <td class="td-num">${totals.typePositives.sputum}</td>
      <td class="td-num">${totals.typePositives.urine}</td>
      <td class="td-num">${totals.typePositives.others}</td>
      <td class="td-num td-summary-pos">${totals.typePositives.total}</td>
    </tr>
  `;

  tableBody.innerHTML = rowsHtml + totalRowHtml;
}

export function getAmrRowsData() {
  const data = state.monthlyAmrData;
  if (!data || !data.monthlyData) return [];
  return data.monthlyData.map((m) => [
    formatAmrMonthLabel(m.month),
    m.srcSamples.opd,
    m.srcSamples.ipd,
    m.srcSamples.icu,
    m.srcSamples.others,
    m.srcSamples.total,
    m.srcPositives.opd,
    m.srcPositives.ipd,
    m.srcPositives.icu,
    m.srcPositives.others,
    m.srcPositives.total,
    m.typeSamples.blood,
    m.typeSamples.pus,
    m.typeSamples.sputum,
    m.typeSamples.urine,
    m.typeSamples.others,
    m.typeSamples.total,
    m.typePositives.blood,
    m.typePositives.pus,
    m.typePositives.sputum,
    m.typePositives.urine,
    m.typePositives.others,
    m.typePositives.total,
  ]);
}

export function copyAmrTableTsv() {
  const rows = getAmrRowsData();
  if (!rows.length) return toast("No AMR data loaded", "error");

  const allRows = [AMR_HEADERS, ...rows];
  const tsv = allRows.map((r) => r.join("\t")).join("\n");

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard
      .writeText(tsv)
      .then(() => {
        toast(
          "Copied all monthly AMR data to clipboard (ready for Excel / Sheets)",
          "success",
        );
      })
      .catch(() => {
        prompt("Copy this TSV table:", tsv);
      });
  } else {
    prompt("Copy this TSV table:", tsv);
  }
}

export async function copyAmrTableFormatted() {
  const table = document.querySelector(".amr-report-table");
  const rows = getAmrRowsData();
  if (!table || !rows.length) return toast("No AMR data loaded", "error");

  const clone = table.cloneNode(true);

  // Strip interactive links (e.g. Month links) and replace with clean text
  clone.querySelectorAll("a").forEach((a) => {
    a.replaceWith(a.textContent.trim());
  });

  clone.setAttribute("border", "1");
  clone.setAttribute("cellpadding", "6");
  clone.setAttribute("cellspacing", "0");
  clone.style.borderCollapse = "collapse";
  clone.style.fontFamily = "Calibri, Arial, sans-serif";
  clone.style.fontSize = "10pt";
  clone.style.width = "100%";

  // Format headers
  clone.querySelectorAll("thead tr").forEach((tr, rowIdx) => {
    tr.querySelectorAll("th").forEach((th) => {
      const cls = th.className || "";
      let bg = "#f1f5f9";
      let color = "#0f172a";

      if (cls.includes("th-group-pos")) {
        bg = "#d1fae5";
        color = "#065f46";
      } else if (cls.includes("th-total-col")) {
        bg = "#e0f2fe";
        color = "#0369a1";
      } else if (cls.includes("th-total-pos-col")) {
        bg = "#dcfce7";
        color = "#15803d";
      } else if (rowIdx === 1) {
        bg = "#f8fafc";
        color = "#334155";
      }

      th.style.backgroundColor = bg;
      th.style.color = color;
      th.style.fontWeight = "bold";
      th.style.border = "1px solid #cbd5e1";
      th.style.padding = "6px 8px";
      th.style.textAlign = "center";
      th.style.whiteSpace = "normal";
      th.style.wordBreak = "break-word";
    });
  });

  // Format body
  clone.querySelectorAll("tbody tr").forEach((tr) => {
    const isSummary = tr.classList.contains("amr-summary-row");
    tr.querySelectorAll("td").forEach((td, colIdx) => {
      const cls = td.className || "";
      let bg = isSummary ? "#f1f5f9" : "#ffffff";
      let color = isSummary ? "#0f172a" : "#1e293b";
      let weight = isSummary ? "bold" : "normal";

      if (cls.includes("td-summary-pos")) {
        bg = "#bbf7d0";
        color = "#16a34a";
        weight = "bold";
      } else if (cls.includes("td-summary-total")) {
        bg = "#bae6fd";
        color = "#0284c7";
        weight = "bold";
      } else if (cls.includes("td-total-pos")) {
        bg = "#dcfce7";
        color = "#15803d";
        weight = "bold";
      } else if (cls.includes("td-total")) {
        bg = "#e0f2fe";
        color = "#0369a1";
        weight = "bold";
      }

      td.style.backgroundColor = bg;
      td.style.color = color;
      td.style.fontWeight = weight;
      td.style.border = "1px solid #cbd5e1";
      td.style.padding = "6px 8px";
      td.style.textAlign = colIdx === 0 ? "left" : "center";
      td.style.whiteSpace = "normal";
      td.style.wordBreak = "break-word";
    });
  });

  const allRows = [AMR_HEADERS, ...rows];
  const tsv = allRows.map((r) => r.join("\t")).join("\n");

  const success = await copyTableHtmlAndTsv(clone.outerHTML, tsv);
  if (success) {
    toast(
      "Monthly AMR table copied with formatting! Ready for Excel, Word, or Sheets.",
      "success",
    );
  } else {
    toast("Could not copy table to clipboard", "error");
  }
}
