/**
 * Pure-ESM Dataset Date-Quality Profiler & Surveillance Period Suggester.
 * Runs identically in Node (server.js), Browser ES modules (antibiogram.js, wasm-emulator.js),
 * and node:test suites.
 */

const MIN_PLAUSIBLE_YEAR = 1990;

const QUARTER_DEFS = [
  { key: "q1", label: "Q1", monthsLabel: "Jan–Mar", months: ["01", "02", "03"], startSuffix: "01-01", endSuffix: "03-31" },
  { key: "q2", label: "Q2", monthsLabel: "Apr–Jun", months: ["04", "05", "06"], startSuffix: "04-01", endSuffix: "06-30" },
  { key: "q3", label: "Q3", monthsLabel: "Jul–Sep", months: ["07", "08", "09"], startSuffix: "07-01", endSuffix: "09-30" },
  { key: "q4", label: "Q4", monthsLabel: "Oct–Dec", months: ["10", "11", "12"], startSuffix: "10-01", endSuffix: "12-31" },
];

const HALF_DEFS = [
  { key: "h1", label: "H1", monthsLabel: "Jan–Jun", months: ["01", "02", "03", "04", "05", "06"], startSuffix: "01-01", endSuffix: "06-30" },
  { key: "h2", label: "H2", monthsLabel: "Jul–Dec", months: ["07", "08", "09", "10", "11", "12"], startSuffix: "07-01", endSuffix: "12-31" },
];

/**
 * Formats a Date as UTC YYYY-MM-DD.
 * @param {Date} d
 * @returns {string}
 */
export function toIsoDateUtc(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * Validates that a YYYY-MM-DD string represents an actual calendar date.
 * @param {string} str
 * @returns {boolean}
 */
export function isValidIsoDate(str) {
  if (typeof str !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const [y, m, d] = str.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/**
 * Analyzes SQL date aggregates to detect dataset span, primary year,
 * multi-year splits, and potential SPEC_DATE typos/anomalies.
 *
 * @param {object} summary
 * @param {number} [summary.totalRows]
 * @param {number} [summary.missingCount]
 * @param {number} [summary.malformedCount]
 * @param {Array<{ym: string, count: number, minDate?: string, maxDate?: string}>} [summary.monthRows]
 * @param {Array<{rowIdx?: number, specNum?: string, organism?: string, rawDate?: string}>} [summary.anomalySamples]
 * @param {Date} [referenceDate]
 */
export function analyzeDateProfile(summary = {}, referenceDate = new Date()) {
  const ref = referenceDate instanceof Date && !isNaN(referenceDate.getTime())
    ? referenceDate
    : new Date();
  const futureCutoffDate = toIsoDateUtc(new Date(ref.getTime() + 7 * 86400000));
  const currentYear = ref.getUTCFullYear();
  const maxPlausibleYear = currentYear + 1;

  const monthRows = Array.isArray(summary.monthRows) ? summary.monthRows : [];
  const totalRows = Number(summary.totalRows) || 0;
  const missingCount = Number(summary.missingCount) || 0;
  let malformedCount = Number(summary.malformedCount) || 0;

  let datedRows = 0;
  let futureDateCount = 0;
  let ancientDateCount = 0;
  let minValidDate = null;
  let maxValidDate = null;
  let minAnyDate = null;
  let maxAnyDate = null;

  const monthMap = new Map();
  const yearMap = new Map();

  for (const row of monthRows) {
    const ym = String(row.ym || "").slice(0, 7);
    const count = Number(row.count ?? row.c ?? 0);
    if (!/^\d{4}-\d{2}$/.test(ym) || count <= 0) continue;

    const yearStr = ym.slice(0, 4);
    const monthStr = ym.slice(5, 7);
    const yearNum = parseInt(yearStr, 10);
    const monthNum = parseInt(monthStr, 10);
    if (monthNum < 1 || monthNum > 12) {
      malformedCount += count;
      continue;
    }

    const rowMin = typeof row.minDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(row.minDate)
      ? row.minDate.slice(0, 10)
      : `${ym}-01`;
    const rowMax = typeof row.maxDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(row.maxDate)
      ? row.maxDate.slice(0, 10)
      : `${ym}-28`;

    datedRows += count;
    if (!minAnyDate || rowMin < minAnyDate) minAnyDate = rowMin;
    if (!maxAnyDate || rowMax > maxAnyDate) maxAnyDate = rowMax;

    const isAncient = yearNum < MIN_PLAUSIBLE_YEAR;
    const isFutureYear = yearNum > maxPlausibleYear;
    const isBeyondCutoff = rowMax > futureCutoffDate;
    const isPlausibleMonth = !isAncient && !isFutureYear && !(rowMin > futureCutoffDate);

    if (isAncient) ancientDateCount += count;
    if (isFutureYear || isBeyondCutoff) futureDateCount += count;

    if (isPlausibleMonth) {
      const clampedMax = rowMax > futureCutoffDate ? futureCutoffDate : rowMax;
      if (!minValidDate || rowMin < minValidDate) minValidDate = rowMin;
      if (!maxValidDate || clampedMax > maxValidDate) maxValidDate = clampedMax;
    }

    monthMap.set(ym, {
      ym,
      year: yearStr,
      month: monthStr,
      count,
      minDate: rowMin,
      maxDate: rowMax,
      isPlausible: isPlausibleMonth,
    });

    const existingYear = yearMap.get(yearStr) || {
      year: yearStr,
      yearNum,
      count: 0,
      months: new Set(),
      minDate: rowMin,
      maxDate: rowMax,
      isPlausible: !isAncient && !isFutureYear && rowMin <= futureCutoffDate,
    };
    existingYear.count += count;
    existingYear.months.add(monthStr);
    if (rowMin < existingYear.minDate) existingYear.minDate = rowMin;
    if (rowMax > existingYear.maxDate) existingYear.maxDate = rowMax;
    if (!isAncient && !isFutureYear && rowMin <= futureCutoffDate) {
      existingYear.isPlausible = true;
    }
    yearMap.set(yearStr, existingYear);
  }

  const allYearEntries = Array.from(yearMap.values()).map((y) => ({
    year: y.year,
    yearNum: y.yearNum,
    count: y.count,
    months: Array.from(y.months).sort(),
    minDate: y.minDate,
    maxDate: y.maxDate,
    isPlausible: y.isPlausible,
    isPrimary: false,
  }));

  const plausibleYears = allYearEntries.filter((y) => y.isPlausible);
  const poolForPrimary = plausibleYears.length > 0 ? plausibleYears : allYearEntries;

  // Pick dominant year by isolate count; break ties by most recent year.
  poolForPrimary.sort((a, b) => b.count - a.count || b.yearNum - a.yearNum);
  const primaryYearObj = poolForPrimary[0] || null;
  if (primaryYearObj) primaryYearObj.isPrimary = true;

  const primaryYear = primaryYearObj ? primaryYearObj.year : null;
  const primaryYearCount = primaryYearObj ? primaryYearObj.count : 0;
  const totalPlausibleRows = plausibleYears.reduce((acc, y) => acc + y.count, 0);
  const primaryYearShare = totalPlausibleRows > 0 ? primaryYearCount / totalPlausibleRows : 0;

  // Order yearCounts with primary first, then descending chronologically.
  const yearCounts = allYearEntries.sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return b.yearNum - a.yearNum;
  });

  const substantialPlausibleYears = plausibleYears.filter(
    (y) => y.count >= 25 || (totalPlausibleRows > 0 && y.count / totalPlausibleRows >= 0.08),
  );
  const isMultiYearFile = substantialPlausibleYears.length >= 2;
  const strayYears = plausibleYears.filter((y) => !y.isPrimary && !isMultiYearFile);
  const hasStrayOtherYears = Boolean(primaryYear && strayYears.length > 0 && primaryYearShare >= 0.85);

  const monthCounts = Array.from(monthMap.values()).sort((a, b) => b.ym.localeCompare(a.ym));

  // Build actionable date-quality warnings
  const warnings = [];
  const badFormatTotal = missingCount + malformedCount;
  if (badFormatTotal > 0) {
    const parts = [];
    if (missingCount > 0) parts.push(`${missingCount.toLocaleString()} missing`);
    if (malformedCount > 0) parts.push(`${malformedCount.toLocaleString()} invalid format`);
    warnings.push({
      code: "missing_or_malformed",
      severity: "warning",
      count: badFormatTotal,
      message: `${badFormatTotal.toLocaleString()} isolate${badFormatTotal === 1 ? "" : "s"} ${badFormatTotal === 1 ? "has" : "have"} ${parts.join(" and ")} SPEC_DATE`,
      detail: "Applying a date range will exclude records without valid collection dates.",
    });
  }

  const implausibleTotal = futureDateCount + ancientDateCount;
  if (implausibleTotal > 0) {
    const parts = [];
    if (futureDateCount > 0) parts.push(`${futureDateCount.toLocaleString()} future (>${futureCutoffDate})`);
    if (ancientDateCount > 0) parts.push(`${ancientDateCount.toLocaleString()} pre-${MIN_PLAUSIBLE_YEAR}`);
    warnings.push({
      code: "implausible_dates",
      severity: "warning",
      count: implausibleTotal,
      message: `Detected ${parts.join(" & ")} date entr${implausibleTotal === 1 ? "y" : "ies"}`,
      detail: "Check for year typos (e.g. 1900, 2099, or future month/year entry errors).",
    });
  }

  if (hasStrayOtherYears) {
    const straySummary = strayYears.map((y) => `${y.year} (${y.count})`).join(", ");
    const strayTotal = strayYears.reduce((sum, y) => sum + y.count, 0);
    warnings.push({
      code: "stray_other_years",
      severity: "warning",
      count: strayTotal,
      message: `File is predominantly ${primaryYear} (${Math.round(primaryYearShare * 100)}%), but contains ${strayTotal.toLocaleString()} isolate${strayTotal === 1 ? "" : "s"} in ${straySummary}`,
      detail: `Use Annual ${primaryYear} to exclude out-of-year or carryover records.`,
    });
  } else if (isMultiYearFile) {
    const multiSummary = substantialPlausibleYears
      .slice()
      .sort((a, b) => a.yearNum - b.yearNum)
      .map((y) => `${y.year} (${y.count.toLocaleString()})`)
      .join(", ");
    warnings.push({
      code: "multi_year_file",
      severity: "info",
      count: substantialPlausibleYears.length,
      message: `Multi-year file detected: ${multiSummary}`,
      detail: "Annual periods are separated per year below so yearly antibiograms stay unmixed.",
    });
  }

  const anomalySamples = Array.isArray(summary.anomalySamples)
    ? summary.anomalySamples.slice(0, 5)
    : [];

  return {
    totalRows,
    datedRows,
    validPlausibleRows: totalPlausibleRows,
    missingCount,
    malformedCount,
    futureDateCount,
    ancientDateCount,
    futureCutoffDate,
    primaryYear,
    primaryYearCount,
    primaryYearShare,
    isMultiYearFile,
    hasStrayOtherYears,
    isCleanSingleYear:
      Boolean(primaryYear) &&
      plausibleYears.length === 1 &&
      badFormatTotal === 0 &&
      implausibleTotal === 0,
    minValidDate: minValidDate || minAnyDate,
    maxValidDate: maxValidDate || maxAnyDate,
    yearCounts,
    monthCounts,
    warnings,
    anomalySamples,
  };
}

/**
 * Generates dataset-aware surveillance period presets (Annual, Semi-Annual H1/H2,
 * Quarterly Q1-Q4) from an analyzed dateProfile, along with a smart recommendation.
 *
 * @param {ReturnType<typeof analyzeDateProfile>} dateProfile
 */
export function suggestSurveillancePeriods(dateProfile) {
  if (!dateProfile || !Array.isArray(dateProfile.yearCounts) || dateProfile.yearCounts.length === 0) {
    return {
      recommendedPreset: "all",
      recommendationReason: "No valid specimen dates detected; showing all file rows.",
      presets: [
        {
          key: "all",
          group: "File",
          kind: "all",
          label: "All File Data",
          shortLabel: "All File Data",
          start: "",
          end: "",
          count: dateProfile?.totalRows || 0,
          recommended: true,
        },
      ],
    };
  }

  const monthLookup = new Map();
  for (const m of dateProfile.monthCounts || []) {
    monthLookup.set(m.ym, m.count);
  }

  const plausibleYears = dateProfile.yearCounts.filter((y) => y.isPlausible);
  const yearsToSuggest = (plausibleYears.length > 0 ? plausibleYears : dateProfile.yearCounts).slice(0, 4);
  const primaryYear = dateProfile.primaryYear || yearsToSuggest[0]?.year || null;

  // Determine recommended surveillance window from primary year coverage
  let recommendedPreset = primaryYear ? `annual:${primaryYear}` : "all";
  let recommendationReason = "";

  if (primaryYear) {
    const primaryObj = yearsToSuggest.find((y) => y.year === primaryYear);
    const months = primaryObj ? primaryObj.months : [];
    const h1Months = months.filter((m) => m <= "06");
    const h2Months = months.filter((m) => m >= "07");

    if (months.length >= 7 || (h1Months.length > 0 && h2Months.length > 0)) {
      recommendedPreset = `annual:${primaryYear}`;
      recommendationReason = dateProfile.isCleanSingleYear
        ? `Full ${primaryYear} dataset (${months.length} month${months.length === 1 ? "" : "s"} populated) — Annual ${primaryYear} matches entire file.`
        : `${months.length} month${months.length === 1 ? "" : "s"} populated in ${primaryYear} — Annual ${primaryYear} recommended for full-year CLSI M39 reporting.`;
    } else if (h1Months.length > 0 && h2Months.length === 0) {
      const activeQuarter = QUARTER_DEFS.find((q) => months.every((m) => q.months.includes(m)));
      if (activeQuarter && months.length <= 3) {
        recommendedPreset = `${activeQuarter.key}:${primaryYear}`;
        recommendationReason = `Data spans ${months.length} month${months.length === 1 ? "" : "s"} inside ${primaryYear} ${activeQuarter.label} (${activeQuarter.monthsLabel}).`;
      } else {
        recommendedPreset = `h1:${primaryYear}`;
        recommendationReason = `Data spans ${h1Months.length} month${h1Months.length === 1 ? "" : "s"} in H1 (Jan–Jun) ${primaryYear} — Semi-Annual H1 recommended.`;
      }
    } else if (h2Months.length > 0 && h1Months.length === 0) {
      const activeQuarter = QUARTER_DEFS.find((q) => months.every((m) => q.months.includes(m)));
      if (activeQuarter && months.length <= 3) {
        recommendedPreset = `${activeQuarter.key}:${primaryYear}`;
        recommendationReason = `Data spans ${months.length} month${months.length === 1 ? "" : "s"} inside ${primaryYear} ${activeQuarter.label} (${activeQuarter.monthsLabel}).`;
      } else {
        recommendedPreset = `h2:${primaryYear}`;
        recommendationReason = `Data spans ${h2Months.length} month${h2Months.length === 1 ? "" : "s"} in H2 (Jul–Dec) ${primaryYear} — Semi-Annual H2 recommended.`;
      }
    }
  }

  const presets = [
    {
      key: "all",
      group: "File",
      kind: "all",
      label: `Entire File (${(dateProfile.totalRows || 0).toLocaleString()} isolates)`,
      shortLabel: "Entire File",
      start: "",
      end: "",
      count: dateProfile.totalRows || 0,
      recommended: false,
    },
  ];

  // Annual options per populated year
  for (const y of yearsToSuggest) {
    const key = `annual:${y.year}`;
    const isRec = key === recommendedPreset;
    const suffix = dateProfile.isCleanSingleYear && y.isPrimary
      ? `Entire File • ${y.count.toLocaleString()}`
      : `${y.months.length} mo • ${y.count.toLocaleString()}`;
    presets.push({
      key,
      group: "Annual",
      kind: "annual",
      year: y.year,
      label: `${isRec ? "★ " : ""}Annual ${y.year} (${suffix})`,
      shortLabel: `Annual ${y.year}`,
      start: `${y.year}-01-01`,
      end: `${y.year}-12-31`,
      count: y.count,
      recommended: isRec,
    });
  }

  // Semi-Annual (H1 / H2) per populated year
  for (const y of yearsToSuggest) {
    for (const h of HALF_DEFS) {
      const count = h.months.reduce((sum, mo) => sum + (monthLookup.get(`${y.year}-${mo}`) || 0), 0);
      if (count <= 0) continue;
      const key = `${h.key}:${y.year}`;
      const isRec = key === recommendedPreset;
      presets.push({
        key,
        group: "Semi-Annual (H1 / H2)",
        kind: "semi_annual",
        year: y.year,
        label: `${isRec ? "★ " : ""}${y.year} ${h.label} (${h.monthsLabel} • ${count.toLocaleString()})`,
        shortLabel: `${y.year} ${h.label} (${h.monthsLabel})`,
        start: `${y.year}-${h.startSuffix}`,
        end: `${y.year}-${h.endSuffix}`,
        count,
        recommended: isRec,
      });
    }
  }

  // Quarterly (Q1 - Q4) per populated year
  for (const y of yearsToSuggest) {
    for (const q of QUARTER_DEFS) {
      const count = q.months.reduce((sum, mo) => sum + (monthLookup.get(`${y.year}-${mo}`) || 0), 0);
      if (count <= 0) continue;
      const key = `${q.key}:${y.year}`;
      const isRec = key === recommendedPreset;
      presets.push({
        key,
        group: "Quarterly (Q1–Q4)",
        kind: "quarterly",
        year: y.year,
        label: `${isRec ? "★ " : ""}${y.year} ${q.label} (${q.monthsLabel} • ${count.toLocaleString()})`,
        shortLabel: `${y.year} ${q.label} (${q.monthsLabel})`,
        start: `${y.year}-${q.startSuffix}`,
        end: `${y.year}-${q.endSuffix}`,
        count,
        recommended: isRec,
      });
    }
  }

  return {
    recommendedPreset,
    recommendationReason,
    presets,
  };
}

/**
 * Resolves a preset key (calendar or legacy rolling key) to explicit start/end YYYY-MM-DD dates.
 * @param {string} presetKey
 * @param {object} [dateProfile]
 * @param {string[]} [fallbackMonths]
 * @param {string|null} [fallbackMaxDate]
 */
export function resolveSurveillancePeriod(presetKey, dateProfile = null, fallbackMonths = [], fallbackMaxDate = null) {
  const key = String(presetKey || "all").trim();
  if (!key || key === "all") {
    return { presetKey: "all", start: "", end: "", label: "Entire File" };
  }

  const calMatch = key.match(/^(annual|h1|h2|q1|q2|q3|q4):(\d{4})$/);
  if (calMatch) {
    const [, kind, year] = calMatch;
    if (kind === "annual") {
      return { presetKey: key, start: `${year}-01-01`, end: `${year}-12-31`, label: `Annual ${year}` };
    }
    const half = HALF_DEFS.find((h) => h.key === kind);
    if (half) {
      return { presetKey: key, start: `${year}-${half.startSuffix}`, end: `${year}-${half.endSuffix}`, label: `${year} ${half.label}` };
    }
    const quarter = QUARTER_DEFS.find((q) => q.key === kind);
    if (quarter) {
      return { presetKey: key, start: `${year}-${quarter.startSuffix}`, end: `${year}-${quarter.endSuffix}`, label: `${year} ${quarter.label}` };
    }
  }

  // Legacy rolling fallbacks anchored to valid maxDate (never skewed by 2099 typos)
  let anchorDate = null;
  const maxDateStr = dateProfile?.maxValidDate || fallbackMaxDate;
  if (typeof maxDateStr === "string" && isValidIsoDate(maxDateStr.slice(0, 10))) {
    anchorDate = new Date(`${maxDateStr.slice(0, 10)}T00:00:00Z`);
  } else if (Array.isArray(fallbackMonths) && fallbackMonths.length > 0) {
    const [yr, mo] = String(fallbackMonths[0]).split("-").map(Number);
    if (yr && mo) anchorDate = new Date(Date.UTC(yr, mo, 0));
  }
  if (!anchorDate) anchorDate = new Date();

  const endStr = toIsoDateUtc(anchorDate);
  const pastDaysMap = { "30d": 30, "90d": 90, "6m": 180, "1y": 365 };
  const pastDays = pastDaysMap[key] || 365;
  const startStr = toIsoDateUtc(new Date(anchorDate.getTime() - pastDays * 86400000));
  return { presetKey: key, start: startStr, end: endStr, label: key };
}

/**
 * Builds a read-only SQL query to inspect isolates with missing, malformed,
 * future, pre-1990, or out-of-primary-year SPEC_DATE values in SQL Workspace.
 *
 * @param {object} [dateProfile]
 * @param {string[]} [availableCols]
 * @returns {string}
 */
export function buildBadDatesInspectSql(dateProfile = null, availableCols = []) {
  const cutoff = dateProfile?.futureCutoffDate || toIsoDateUtc(new Date(Date.now() + 7 * 86400000));
  const primaryYear = dateProfile?.primaryYear;
  const includeOtherYears = Boolean(dateProfile?.hasStrayOtherYears && primaryYear);

  const upperMap = new Map(
    (Array.isArray(availableCols) ? availableCols : []).map((c) => [String(c).toUpperCase(), c]),
  );
  const dateCol = upperMap.has("SPEC_DATE")
    ? upperMap.get("SPEC_DATE")
    : upperMap.has("DATE_DATA")
      ? upperMap.get("DATE_DATA")
      : "SPEC_DATE";

  const preferredCols = ["ROW_IDX", "SPEC_NUM", "PATIENT_ID", dateCol, "SPEC_TYPE", "ORGANISM", "WARD"];
  const selectCols = upperMap.size > 0
    ? preferredCols.map((c) => upperMap.get(c.toUpperCase())).filter(Boolean)
    : preferredCols;
  if (selectCols.length === 0) selectCols.push(dateCol);

  const trimmed = `TRIM(COALESCE(${dateCol}, ''))`;
  const iso10 = `SUBSTR(${trimmed}, 1, 10)`;
  const conditions = [
    `${trimmed} = ''`,
    `LENGTH(${trimmed}) < 10`,
    `${iso10} NOT GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'`,
    `date(${iso10}) IS NULL`,
    `date(${iso10}) != ${iso10}`,
    `SUBSTR(${trimmed}, 1, 4) < '${MIN_PLAUSIBLE_YEAR}'`,
    `${iso10} > '${cutoff}'`,
  ];

  if (includeOtherYears) {
    conditions.push(`SUBSTR(${trimmed}, 1, 4) != '${primaryYear}'`);
  }

  const orderCol = upperMap.has("ROW_IDX") ? upperMap.get("ROW_IDX") : "rowid";
  return [
    `SELECT ${selectCols.join(", ")}`,
    "FROM Isolates",
    "WHERE " + conditions.join("\n   OR "),
    `ORDER BY ${orderCol} DESC`,
    "LIMIT 500;",
  ].join("\n");
}
