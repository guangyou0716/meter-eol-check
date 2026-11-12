import type { FailedPoint, LotReport, MeterResult, Report } from './analyze.js';
import { signed } from './decimal.js';

const yieldText = (v: number) => `${v.toFixed(1)}%`;
const opt = (v: number | null, f: (x: number) => string) => (v === null ? 'n/a' : f(v));
const err = (v: number) => signed(v, 3);
const cpk = (v: number) => v.toFixed(2);
const failText = (f: FailedPoint) => `${f.point} ${err(f.error)}% (${f.excess.toFixed(3)} outside)`;

function meterLine(m: MeterResult): string {
  const parts: string[] = [];
  if (m.missingPoints.length > 0) {
    parts.push(`missing ${m.missingPoints.join(', ')}`);
  }
  if (m.firstFailures.length > 0) {
    parts.push(`first: ${m.firstFailures.map(failText).join('; ')}`);
  }
  parts.push(m.finalPass ? 'passed on retest' : m.retested ? 'still failing after retest' : 'not retested');
  return `${m.serial}: ${parts.join(' | ')}`;
}

function lotHeadline(l: LotReport, report: Report): string {
  const min = report.minFirstPassYieldPct;
  const status = min === undefined ? '' : l.belowMinimum ? ` BELOW minimum ${min}%` : ` (minimum ${min}% met)`;
  return `${l.meters} meters, first-pass yield ${yieldText(l.firstPassYieldPct)} (${l.firstPassed}/${l.meters})${status}, final yield ${yieldText(l.finalYieldPct)} (${l.finalPassed}/${l.meters}), retested ${l.retested}, incomplete ${l.incomplete}`;
}

/** Plain-text report for the terminal. */
export function textReport(report: Report): string {
  const out: string[] = [`Profile: ${report.profile} | ${report.attempts} test rows, ${report.lots.length} lot(s)`];
  for (const l of report.lots) {
    out.push('', `Lot ${l.lot}: ${lotHeadline(l, report)}`);
    out.push('  Point (first attempts)      limits            n     mean    sd     min     max    Cpk  fails');
    for (const p of l.points) {
      out.push(
        `  ${p.point.padEnd(26)} ${`${err(p.lower)}..${err(p.upper)}`.padEnd(16)} ${String(p.n).padStart(4)} ${opt(p.mean, err).padStart(7)} ${opt(p.stdDev, (v) => v.toFixed(3)).padStart(6)} ${opt(p.min, err).padStart(7)} ${opt(p.max, err).padStart(7)} ${opt(p.cpk, cpk).padStart(6)} ${String(p.fails).padStart(5)}`,
      );
    }
    const flagged = l.stationBias.filter((b) => b.flagged);
    if (l.stationYield.length > 0) {
      out.push(`  Station first-pass yield: ${l.stationYield.map((s) => `${s.station} ${yieldText(s.firstPassYieldPct)} (${s.firstPassed}/${s.meters})`).join(', ')}`);
    }
    if (l.stations.length > 1) {
      out.push(`  Stations: ${l.stations.join(', ')}; ${flagged.length} bias flag(s) over ${Math.round(report.biasFlag * 100)}% of half tolerance`);
      for (const b of flagged) {
        out.push(`    ${b.station} @ ${b.point}: bias ${err(b.bias)}% vs other stations (${(b.biasOfHalfTolerance * 100).toFixed(1)}% of half tolerance, n=${b.n})`);
      }
    }
    if (l.failedMeters.length > 0) {
      out.push(`  Failed first pass (${l.failedMeters.length}):`);
      for (const m of l.failedMeters) {
        out.push(`    ${meterLine(m)}`);
      }
    }
  }
  if (report.lots.length > 1) {
    const t = report.totals;
    out.push('', `All lots: ${t.meters} meters, first-pass yield ${yieldText(t.firstPassYieldPct)}, final yield ${yieldText(t.finalYieldPct)}`);
  }
  return `${out.join('\n')}\n`;
}

/** Markdown report (for a shift log, PR comment or wiki page). */
export function markdownReport(report: Report): string {
  const out: string[] = [`# EOL accuracy report: ${report.profile}`, '', `${report.attempts} test rows, ${report.lots.length} lot(s).`];
  for (const l of report.lots) {
    out.push('', `## Lot ${l.lot}`, '', lotHeadline(l, report) + '.', '');
    out.push('| Point | Limits % | n | Mean % | SD | Min % | Max % | Cpk | Fails |', '|---|---|--:|--:|--:|--:|--:|--:|--:|');
    for (const p of l.points) {
      out.push(
        `| ${p.point} | ${err(p.lower)}..${err(p.upper)} | ${p.n} | ${opt(p.mean, err)} | ${opt(p.stdDev, (v) => v.toFixed(3))} | ${opt(p.min, err)} | ${opt(p.max, err)} | ${opt(p.cpk, cpk)} | ${p.fails} |`,
      );
    }
    if (l.stationYield.length > 0) {
      out.push('', '| Station | Meters | First passed | First-pass yield |', '|---|--:|--:|--:|');
      for (const s of l.stationYield) {
        out.push(`| ${s.station} | ${s.meters} | ${s.firstPassed} | ${yieldText(s.firstPassYieldPct)} |`);
      }
    }
    const flagged = l.stationBias.filter((b) => b.flagged);
    if (flagged.length > 0) {
      out.push('', `Station bias flags (over ${Math.round(report.biasFlag * 100)}% of half tolerance):`, '');
      for (const b of flagged) {
        out.push(`- ${b.station} @ ${b.point}: ${err(b.bias)}% vs other stations (n=${b.n})`);
      }
    }
    if (l.failedMeters.length > 0) {
      out.push('', `Failed first pass (${l.failedMeters.length}):`, '');
      for (const m of l.failedMeters) {
        out.push(`- ${meterLine(m)}`);
      }
    }
  }
  return `${out.join('\n')}\n`;
}

const round = (v: number | null, d: number) => (v === null ? null : Number(v.toFixed(d)));

/** JSON report: numbers rounded for stable output (errors 6 dp, yields 2 dp, Cpk 3 dp). */
export function jsonReport(report: Report): string {
  const data = {
    ...report,
    totals: { ...report.totals, firstPassYieldPct: round(report.totals.firstPassYieldPct, 2), finalYieldPct: round(report.totals.finalYieldPct, 2) },
    lots: report.lots.map((l) => ({
      ...l,
      firstPassYieldPct: round(l.firstPassYieldPct, 2),
      finalYieldPct: round(l.finalYieldPct, 2),
      points: l.points.map((p) => ({ ...p, mean: round(p.mean, 6), stdDev: round(p.stdDev, 6), min: round(p.min, 6), max: round(p.max, 6), cpk: round(p.cpk, 3) })),
      stationYield: l.stationYield.map((s) => ({ ...s, firstPassYieldPct: round(s.firstPassYieldPct, 2) })),
      stationBias: l.stationBias.map((b) => ({ ...b, mean: round(b.mean, 6), bias: round(b.bias, 6), biasOfHalfTolerance: round(b.biasOfHalfTolerance, 4) })),
    })),
  };
  return `${JSON.stringify(data, null, 2)}\n`;
}
