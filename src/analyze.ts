import { toNumber } from './decimal.js';
import { InputError } from './errors.js';
import type { Limits, PointLimit } from './limits.js';
import type { Attempt } from './results.js';

export interface AnalyzeOptions {
  /** Flag a station when |bias| exceeds this fraction of half the tolerance band (default 0.25). */
  biasFlag?: number;
  /** Minimum first-pass yield in percent; overrides the profile value. */
  minFirstPassYieldPct?: number;
}

export interface PointStats {
  point: string;
  lower: number;
  upper: number;
  /** First attempts only: capability of the process as it runs, before retest. */
  n: number;
  mean: number | null;
  stdDev: number | null;
  min: number | null;
  max: number | null;
  /** null when n < 2 or the spread is zero. */
  cpk: number | null;
  fails: number;
}

export interface StationBias {
  station: string;
  point: string;
  n: number;
  mean: number;
  /** Station mean minus the mean of all other stations' first attempts at this point. */
  bias: number;
  /** |bias| as a fraction of half the tolerance band. */
  biasOfHalfTolerance: number;
  flagged: boolean;
}

export interface FailedPoint {
  point: string;
  error: number;
  /** How far outside the band, in percent (positive). */
  excess: number;
}

export interface MeterResult {
  serial: string;
  firstPass: boolean;
  finalPass: boolean;
  retested: boolean;
  missingPoints: string[];
  /** First-attempt failures, worst first. */
  firstFailures: FailedPoint[];
  /** Points still failing on their last attempt, worst first. */
  finalFailures: FailedPoint[];
}

export interface LotReport {
  lot: string;
  meters: number;
  firstPassed: number;
  finalPassed: number;
  retested: number;
  incomplete: number;
  firstPassYieldPct: number;
  finalYieldPct: number;
  belowMinimum: boolean;
  points: PointStats[];
  stations: string[];
  stationBias: StationBias[];
  /** Meters that failed first pass or are incomplete. */
  failedMeters: MeterResult[];
}

export interface Report {
  profile: string;
  minFirstPassYieldPct?: number;
  biasFlag: number;
  attempts: number;
  lots: LotReport[];
  totals: { meters: number; firstPassed: number; finalPassed: number; firstPassYieldPct: number; finalYieldPct: number };
  /** True when any lot's first-pass yield is under the minimum. */
  belowMinimum: boolean;
}

const pct = (part: number, whole: number) => (whole === 0 ? 0 : (part / whole) * 100);

function failure(limit: PointLimit, attempt: Attempt): FailedPoint | undefined {
  if (attempt.error < limit.lower) {
    return { point: limit.point, error: toNumber(attempt.error), excess: toNumber(limit.lower - attempt.error) };
  }
  if (attempt.error > limit.upper) {
    return { point: limit.point, error: toNumber(attempt.error), excess: toNumber(attempt.error - limit.upper) };
  }
  return undefined;
}

const byWorst = (a: FailedPoint, b: FailedPoint) => b.excess - a.excess || a.point.localeCompare(b.point);

function stats(limit: PointLimit, firsts: Attempt[]): PointStats {
  const values = firsts.map((a) => toNumber(a.error));
  const n = values.length;
  const base = { point: limit.point, lower: toNumber(limit.lower), upper: toNumber(limit.upper), n };
  const fails = firsts.filter((a) => failure(limit, a)).length;
  if (n === 0) {
    return { ...base, mean: null, stdDev: null, min: null, max: null, cpk: null, fails };
  }
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const stdDev = n < 2 ? null : Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
  const cpk = stdDev === null || stdDev < 1e-12 ? null : Math.min(base.upper - mean, mean - base.lower) / (3 * stdDev);
  // reduce instead of Math.min(...values): spreading a very large lot would overflow the call stack.
  return { ...base, mean, stdDev, min: values.reduce((m, v) => Math.min(m, v)), max: values.reduce((m, v) => Math.max(m, v)), cpk, fails };
}

/** Orders a meter's attempts at one point: by tested_at when present, else by CSV line. */
const chronological = (a: Attempt, b: Attempt) => (a.testedAtMs ?? 0) - (b.testedAtMs ?? 0) || a.line - b.line;

function analyzeLot(lot: string, attempts: Attempt[], limits: Limits, biasFlag: number, minFpy: number | undefined): LotReport {
  // serial -> point -> attempts in order
  const meters = new Map<string, Map<string, Attempt[]>>();
  for (const a of attempts) {
    let points = meters.get(a.serial);
    if (!points) {
      points = new Map();
      meters.set(a.serial, points);
    }
    const list = points.get(a.point) ?? [];
    list.push(a);
    points.set(a.point, list);
  }

  const firstsByPoint = new Map<string, Attempt[]>(limits.points.map((p) => [p.point, []]));
  const results: MeterResult[] = [];
  for (const [serial, points] of meters) {
    const missingPoints: string[] = [];
    const firstFailures: FailedPoint[] = [];
    const finalFailures: FailedPoint[] = [];
    let retested = false;
    for (const limit of limits.points) {
      const list = points.get(limit.point);
      if (!list) {
        missingPoints.push(limit.point);
        continue;
      }
      list.sort(chronological);
      retested ||= list.length > 1;
      firstsByPoint.get(limit.point)!.push(list[0]);
      const first = failure(limit, list[0]);
      if (first) {
        firstFailures.push(first);
      }
      const last = failure(limit, list[list.length - 1]);
      if (last) {
        finalFailures.push(last);
      }
    }
    const complete = missingPoints.length === 0;
    results.push({
      serial,
      firstPass: complete && firstFailures.length === 0,
      finalPass: complete && finalFailures.length === 0,
      retested,
      missingPoints,
      firstFailures: firstFailures.sort(byWorst),
      finalFailures: finalFailures.sort(byWorst),
    });
  }

  const stations = [...new Set(attempts.map((a) => a.station))].sort();
  const stationBias: StationBias[] = [];
  if (stations.length > 1) {
    for (const limit of limits.points) {
      const firsts = firstsByPoint.get(limit.point)!;
      const halfTolerance = toNumber(limit.upper - limit.lower) / 2;
      for (const station of stations) {
        const here = firsts.filter((a) => a.station === station).map((a) => toNumber(a.error));
        const others = firsts.filter((a) => a.station !== station).map((a) => toNumber(a.error));
        if (here.length === 0 || others.length === 0) {
          continue;
        }
        const mean = here.reduce((s, v) => s + v, 0) / here.length;
        const bias = mean - others.reduce((s, v) => s + v, 0) / others.length;
        const biasOfHalfTolerance = Math.abs(bias) / halfTolerance;
        stationBias.push({ station, point: limit.point, n: here.length, mean, bias, biasOfHalfTolerance, flagged: biasOfHalfTolerance > biasFlag });
      }
    }
  }

  const firstPassed = results.filter((m) => m.firstPass).length;
  const finalPassed = results.filter((m) => m.finalPass).length;
  const firstPassYieldPct = pct(firstPassed, results.length);
  return {
    lot,
    meters: results.length,
    firstPassed,
    finalPassed,
    retested: results.filter((m) => m.retested).length,
    incomplete: results.filter((m) => m.missingPoints.length > 0).length,
    firstPassYieldPct,
    finalYieldPct: pct(finalPassed, results.length),
    belowMinimum: minFpy !== undefined && firstPassYieldPct < minFpy,
    points: limits.points.map((p) => stats(p, firstsByPoint.get(p.point)!)),
    stations,
    stationBias,
    failedMeters: results.filter((m) => !m.firstPass).sort((a, b) => a.serial.localeCompare(b.serial)),
  };
}

/** Builds the lot report. Throws InputError for points the profile does not know or a serial in two lots. */
export function analyze(attempts: Attempt[], limits: Limits, options: AnalyzeOptions = {}): Report {
  const biasFlag = options.biasFlag ?? 0.25;
  if (!(biasFlag > 0) || !Number.isFinite(biasFlag)) {
    throw new InputError('Bias flag must be a positive number (fraction of half the tolerance band).');
  }
  const minFpy = options.minFirstPassYieldPct ?? limits.minFirstPassYieldPct;
  const known = new Set(limits.points.map((p) => p.point));
  const lotOf = new Map<string, string>();
  const lots = new Map<string, Attempt[]>();
  for (const a of attempts) {
    if (!known.has(a.point)) {
      throw new InputError(`Results CSV line ${a.line}: point "${a.point}" is not in the limits profile "${limits.name}" (known: ${[...known].join(', ')}).`);
    }
    const seen = lotOf.get(a.serial);
    if (seen !== undefined && seen !== a.lot) {
      throw new InputError(`Results CSV line ${a.line}: meter ${a.serial} appears in lot ${seen} and lot ${a.lot}.`);
    }
    lotOf.set(a.serial, a.lot);
    const list = lots.get(a.lot) ?? [];
    list.push(a);
    lots.set(a.lot, list);
  }
  const lotReports = [...lots.keys()].sort().map((lot) => analyzeLot(lot, lots.get(lot)!, limits, biasFlag, minFpy));
  const meters = lotReports.reduce((s, l) => s + l.meters, 0);
  const firstPassed = lotReports.reduce((s, l) => s + l.firstPassed, 0);
  const finalPassed = lotReports.reduce((s, l) => s + l.finalPassed, 0);
  const report: Report = {
    profile: limits.name,
    biasFlag,
    attempts: attempts.length,
    lots: lotReports,
    totals: { meters, firstPassed, finalPassed, firstPassYieldPct: pct(firstPassed, meters), finalYieldPct: pct(finalPassed, meters) },
    belowMinimum: lotReports.some((l) => l.belowMinimum),
  };
  if (minFpy !== undefined) {
    report.minFirstPassYieldPct = minFpy;
  }
  return report;
}
