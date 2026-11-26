/**
 * Pure-ESM Monthly AMR Surveillance Aggregator
 * Shared between Node server (server.js) and In-Browser WASM Emulator (wasm-emulator.js).
 */

const BLOOD_NO_GROWTH = new Set(['xxx', 'xpa', 'nor', 'scn', '']);
const OTHERS_NO_GROWTH = new Set(['xxx', 'xpa', 'xep', 'xsg', 'nor', 'ora', 'vag', '']);

/**
 * Aggregates raw isolate rows into monthly source-of-sample and specimen-type
 * surveillance counts with culture-positivity classification.
 *
 * @param {Array<object>} rows
 * @returns {{ months: string[], monthlyData: Array<object> }}
 */
export function aggregateMonthlyAmr(rows = []) {
  const monthMap = {};

  for (const r of rows) {
    const ym = (r.SPEC_DATE || '').substring(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;

    if (!monthMap[ym]) {
      monthMap[ym] = {
        month: ym,
        totalRows: 0,
        srcSamples: { opd: 0, ipd: 0, icu: 0, others: 0, total: 0 },
        srcPositives: { opd: 0, ipd: 0, icu: 0, others: 0, total: 0 },
        typeSamples: { blood: 0, pus: 0, sputum: 0, urine: 0, others: 0, total: 0 },
        typePositives: { blood: 0, pus: 0, sputum: 0, urine: 0, others: 0, total: 0 },
      };
    }

    const m = monthMap[ym];
    m.totalRows++;

    const wt = (r.WARD_TYPE || '').toLowerCase();
    const st = (r.SPEC_TYPE || '').toLowerCase();
    const org = (r.ORGANISM || '').toLowerCase().trim();

    const isPos = st === 'bl' ? !BLOOD_NO_GROWTH.has(org) : !OTHERS_NO_GROWTH.has(org);

    if (wt === 'out') {
      m.srcSamples.opd++;
      if (isPos) m.srcPositives.opd++;
    } else if (wt === 'in') {
      m.srcSamples.ipd++;
      if (isPos) m.srcPositives.ipd++;
    } else if (wt === 'icu') {
      m.srcSamples.icu++;
      if (isPos) m.srcPositives.icu++;
    } else {
      m.srcSamples.others++;
      if (isPos) m.srcPositives.others++;
    }

    if (st === 'bl') {
      m.typeSamples.blood++;
      if (isPos) m.typePositives.blood++;
    } else if (st === 'ps') {
      m.typeSamples.pus++;
      if (isPos) m.typePositives.pus++;
    } else if (st === 'sp') {
      m.typeSamples.sputum++;
      if (isPos) m.typePositives.sputum++;
    } else if (st === 'ur') {
      m.typeSamples.urine++;
      if (isPos) m.typePositives.urine++;
    } else {
      m.typeSamples.others++;
      if (isPos) m.typePositives.others++;
    }
  }

  const sortedMonths = Object.keys(monthMap).sort((a, b) => a.localeCompare(b));
  const monthlyData = sortedMonths.map((ym) => {
    const m = monthMap[ym];
    m.srcSamples.total =
      m.srcSamples.opd + m.srcSamples.ipd + m.srcSamples.icu + m.srcSamples.others;
    m.srcPositives.total =
      m.srcPositives.opd + m.srcPositives.ipd + m.srcPositives.icu + m.srcPositives.others;
    m.typeSamples.total =
      m.typeSamples.blood +
      m.typeSamples.pus +
      m.typeSamples.sputum +
      m.typeSamples.urine +
      m.typeSamples.others;
    m.typePositives.total =
      m.typePositives.blood +
      m.typePositives.pus +
      m.typePositives.sputum +
      m.typePositives.urine +
      m.typePositives.others;
    return m;
  });

  return {
    months: sortedMonths,
    monthlyData,
  };
}
