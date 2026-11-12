import { describe, expect, it } from 'vitest';
import { analyze } from '../src/analyze.js';
import { InputError } from '../src/errors.js';
import { parseResultFiles, parseResults } from '../src/results.js';
import { csv, limits } from './helpers.js';

// Lot X, hand-checked:
// M1 passes; M2 sits exactly on the limits (pass); M3 fails P1 by 0.001 then passes on retest; M4 has no P2 row.
const lotX = [
  ['M1', 'X', 'S1', 'P1', '0.2'],
  ['M1', 'X', 'S1', 'P2', '0.1'],
  ['M2', 'X', 'S2', 'P1', '1.000'],
  ['M2', 'X', 'S2', 'P2', '-0.5'],
  ['M3', 'X', 'S1', 'P1', '1.001'],
  ['M3', 'X', 'S1', 'P2', '0'],
  ['M4', 'X', 'S2', 'P1', '0.1'],
  ['M3', 'X', 'S2', 'P1', '0.3'],
];

describe('analyze', () => {
  const report = analyze(parseResults(csv(lotX)), limits());
  const lot = report.lots[0];

  it('counts first-pass and final yield, retests and incomplete meters', () => {
    expect(lot).toMatchObject({ lot: 'X', meters: 4, firstPassed: 2, finalPassed: 3, retested: 1, incomplete: 1, firstPassYieldPct: 50, finalYieldPct: 75 });
    expect(report.totals).toEqual({ meters: 4, firstPassed: 2, finalPassed: 3, firstPassYieldPct: 50, finalYieldPct: 75 });
    expect(report.attempts).toBe(8);
    expect(report.belowMinimum).toBe(false);
  });

  it('treats values on the limit as a pass (exact decimal compare)', () => {
    expect(lot.failedMeters.map((m) => m.serial)).toEqual(['M3', 'M4']);
  });

  it('lists first failures with the excess and the final state', () => {
    const m3 = lot.failedMeters[0];
    expect(m3.firstFailures).toEqual([{ point: 'P1', error: 1.001, excess: 0.001 }]);
    expect(m3).toMatchObject({ firstPass: false, finalPass: true, retested: true, finalFailures: [], missingPoints: [] });
    expect(lot.failedMeters[1]).toMatchObject({ serial: 'M4', missingPoints: ['P2'], firstPass: false, finalPass: false });
  });

  it('computes point statistics on first attempts only', () => {
    const [p1, p2] = lot.points;
    expect(p1).toMatchObject({ point: 'P1', lower: -1, upper: 1, n: 4, fails: 1, min: 0.1, max: 1.001 });
    expect(p1.mean).toBeCloseTo(0.57525, 10);
    expect(p2).toMatchObject({ point: 'P2', n: 3, fails: 0, min: -0.5, max: 0.1 });
    expect(p2.mean).toBeCloseTo(-0.133333, 5);
    expect(p2.stdDev).toBeCloseTo(0.321455, 5);
    // min(0.5 - mean, mean + 0.5) / (3 sd) = 0.366667 / 0.964365
    expect(p2.cpk).toBeCloseTo(0.380216, 5);
  });

  it('orders retests by tested_at when present, not by file order', () => {
    const rows = parseResults(
      csv([
        ['M1', 'X', 'S1', 'P1', '0.2', '2026-11-10T09:00:00+08:00'],
        ['M1', 'X', 'S1', 'P1', '1.5', '2026-11-10T08:00:00+08:00'],
        ['M1', 'X', 'S1', 'P2', '0', '2026-11-10T08:00:00+08:00'],
      ]),
    );
    const m = analyze(rows, limits()).lots[0];
    expect(m).toMatchObject({ firstPassed: 0, finalPassed: 1, retested: 1 });
    expect(m.failedMeters[0].firstFailures[0]).toEqual({ point: 'P1', error: 1.5, excess: 0.5 });
  });

  it('reports a meter that still fails after retest, worst point first', () => {
    const rows = parseResults(
      csv([
        ['M1', 'X', 'S1', 'P1', '-1.2'],
        ['M1', 'X', 'S1', 'P2', '0.9'],
        ['M1', 'X', 'S1', 'P1', '-1.1'],
      ]),
    );
    const m = analyze(rows, limits()).lots[0].failedMeters[0];
    expect(m.firstFailures.map((f) => f.point)).toEqual(['P2', 'P1']);
    expect(m.finalFailures).toEqual([
      { point: 'P2', error: 0.9, excess: 0.4 },
      { point: 'P1', error: -1.1, excess: expect.closeTo(0.1, 10) },
    ]);
    expect(m.finalPass).toBe(false);
  });

  it('gives no Cpk for one value or zero spread', () => {
    const one = analyze(parseResults(csv([['M1', 'X', 'S1', 'P1', '0.1'], ['M1', 'X', 'S1', 'P2', '0.1']])), limits()).lots[0];
    expect(one.points[0]).toMatchObject({ n: 1, stdDev: null, cpk: null, mean: 0.1 });
    const flat = analyze(
      parseResults(csv([['M1', 'X', 'S1', 'P1', '0.1'], ['M2', 'X', 'S1', 'P1', '0.1'], ['M1', 'X', 'S1', 'P2', '0'], ['M2', 'X', 'S1', 'P2', '0']])),
      limits(),
    ).lots[0];
    expect(flat.points[0]).toMatchObject({ n: 2, stdDev: 0, cpk: null });
  });

  it('flags a station whose mean is off from the other stations', () => {
    const rows = parseResults(
      csv([
        ['A1', 'X', 'S1', 'P1', '0.5'],
        ['A2', 'X', 'S1', 'P1', '0.5'],
        ['B1', 'X', 'S2', 'P1', '0'],
        ['B2', 'X', 'S2', 'P1', '0'],
        ['A1', 'X', 'S1', 'P2', '0'],
        ['A2', 'X', 'S1', 'P2', '0.05'],
        ['B1', 'X', 'S2', 'P2', '0'],
        ['B2', 'X', 'S2', 'P2', '0.05'],
      ]),
    );
    const l = analyze(rows, limits()).lots[0];
    expect(l.stations).toEqual(['S1', 'S2']);
    const p1 = l.stationBias.filter((b) => b.point === 'P1');
    expect(p1).toEqual([
      { station: 'S1', point: 'P1', n: 2, mean: 0.5, bias: 0.5, biasOfHalfTolerance: 0.5, flagged: true },
      { station: 'S2', point: 'P1', n: 2, mean: 0, bias: -0.5, biasOfHalfTolerance: 0.5, flagged: true },
    ]);
    expect(l.stationBias.filter((b) => b.point === 'P2').every((b) => !b.flagged && b.bias === 0)).toBe(true);
    // Raising the threshold clears the flag.
    expect(analyze(rows, limits(), { biasFlag: 0.6 }).lots[0].stationBias.some((b) => b.flagged)).toBe(false);
  });

  it('computes Cpk per point per station from first attempts only', () => {
    const rows = parseResults(
      csv([
        ['A1', 'X', 'S1', 'P1', '0.2', '2026-11-01T08:00:00Z'],
        ['A2', 'X', 'S1', 'P1', '0.4', '2026-11-01T08:01:00Z'],
        ['B1', 'X', 'S2', 'P1', '0', '2026-11-01T08:02:00Z'],
        ['B2', 'X', 'S2', 'P1', '0.9', '2026-11-01T08:03:00Z'],
        // retest of B2 at P1 on S1: ignored for capability (first attempts only)
        ['B2', 'X', 'S1', 'P1', '-0.9', '2026-11-01T09:00:00Z'],
        ['A1', 'X', 'S1', 'P2', '0.1', '2026-11-01T08:00:00Z'],
        ['B1', 'X', 'S2', 'P2', '0', '2026-11-01T08:02:00Z'],
        ['B2', 'X', 'S2', 'P2', '0', '2026-11-01T08:03:00Z'],
      ]),
    );
    const l = analyze(rows, limits()).lots[0];
    const s1p1 = l.stationCpk.find((c) => c.station === 'S1' && c.point === 'P1')!;
    // mean 0.3, sd = sqrt(0.02) ~ 0.141421, Cpk = (1 - 0.3) / (3 sd) ~ 1.6499
    expect(s1p1.n).toBe(2);
    expect(s1p1.mean).toBeCloseTo(0.3, 12);
    expect(s1p1.stdDev).toBeCloseTo(Math.sqrt(0.02), 12);
    expect(s1p1.cpk).toBeCloseTo(0.7 / (3 * Math.sqrt(0.02)), 12);
    const s2p1 = l.stationCpk.find((c) => c.station === 'S2' && c.point === 'P1')!;
    expect(s2p1.n).toBe(2);
    expect(s2p1.cpk).toBeCloseTo(0.55 / (3 * Math.sqrt(0.405)), 12);
    // n = 1 -> no sd/Cpk; zero spread -> no Cpk
    expect(l.stationCpk.find((c) => c.station === 'S1' && c.point === 'P2')).toEqual({ station: 'S1', point: 'P2', n: 1, mean: 0.1, stdDev: null, cpk: null });
    expect(l.stationCpk.find((c) => c.station === 'S2' && c.point === 'P2')).toMatchObject({ n: 2, stdDev: 0, cpk: null });
    // order: profile point order, then station
    expect(l.stationCpk.map((c) => `${c.point}/${c.station}`)).toEqual(['P1/S1', 'P1/S2', 'P2/S1', 'P2/S2']);
  });

  it('skips a station with no first attempts at a point and has no station Cpk for one station', () => {
    const rows = parseResults(csv([['A1', 'X', 'S1', 'P1', '0'], ['A2', 'X', 'S1', 'P1', '0.2'], ['B1', 'X', 'S2', 'P2', '0']]));
    const l = analyze(rows, limits()).lots[0];
    expect(l.stationCpk.map((c) => `${c.point}/${c.station}`)).toEqual(['P1/S1', 'P2/S2']);
    const one = analyze(parseResults(csv([['M1', 'X', 'S1', 'P1', '0'], ['M2', 'X', 'S1', 'P1', '0.9']])), limits()).lots[0];
    expect(one.stationCpk).toEqual([]);
  });

  it('has no station bias with a single station', () => {
    const l = analyze(parseResults(csv([['M1', 'X', 'S1', 'P1', '0'], ['M2', 'X', 'S1', 'P1', '0.9']])), limits()).lots[0];
    expect(l.stationBias).toEqual([]);
  });

  it('splits lots, sorts them and checks the minimum per lot', () => {
    const rows = parseResults(
      csv([
        ['B1', 'LB', 'S1', 'P1', '0'],
        ['B1', 'LB', 'S1', 'P2', '0'],
        ['A1', 'LA', 'S1', 'P1', '2'],
        ['A1', 'LA', 'S1', 'P2', '0'],
        ['A2', 'LA', 'S1', 'P1', '0'],
        ['A2', 'LA', 'S1', 'P2', '0'],
      ]),
    );
    const r = analyze(rows, limits(), { minFirstPassYieldPct: 60 });
    expect(r.lots.map((l) => [l.lot, l.firstPassYieldPct, l.belowMinimum])).toEqual([
      ['LA', 50, true],
      ['LB', 100, false],
    ]);
    expect(r.belowMinimum).toBe(true);
    expect(r.minFirstPassYieldPct).toBe(60);
    expect(r.totals.firstPassYieldPct).toBeCloseTo(66.6667, 3);
  });

  it('uses the profile minimum unless the option overrides it', () => {
    const l = { ...limits(), minFirstPassYieldPct: 90 };
    const rows = parseResults(csv(lotX));
    expect(analyze(rows, l).belowMinimum).toBe(true);
    expect(analyze(rows, l, { minFirstPassYieldPct: 40 }).belowMinimum).toBe(false);
  });

  it('rejects unknown points, a meter in two lots and a bad bias flag', () => {
    expect(() => analyze(parseResults(csv([['M1', 'X', 'S1', 'P9', '0']])), limits())).toThrow('point "P9" is not in the limits profile');
    expect(() => analyze(parseResults(csv([['M1', 'X', 'S1', 'P1', '0'], ['M1', 'Y', 'S1', 'P2', '0']])), limits())).toThrow(
      'line 3: meter M1 appears in lot X and lot Y',
    );
    for (const biasFlag of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => analyze(parseResults(csv(lotX)), limits(), { biasFlag })).toThrow(InputError);
    }
  });

  it('reports first-pass yield per station by the station of each meter\'s earliest first attempt', () => {
    // M3 was retested on S2 but first ran on S1, so it counts at S1.
    expect(lot.stationYield).toEqual([
      { station: 'S1', meters: 2, firstPassed: 1, firstPassYieldPct: 50 },
      { station: 'S2', meters: 2, firstPassed: 1, firstPassYieldPct: 50 },
    ]);
  });

  it('leaves station yield empty for a single station', () => {
    const one = analyze(parseResults(csv([['M1', 'Y', 'S1', 'P1', '0'], ['M1', 'Y', 'S1', 'P2', '0']])), limits());
    expect(one.lots[0].stationYield).toEqual([]);
  });

  it('orders retests across files by file order when there is no tested_at', () => {
    const fail = { name: 'a.csv', text: csv([['M1', 'Z', 'S1', 'P1', '1.5'], ['M1', 'Z', 'S1', 'P2', '0']]) };
    const pass = { name: 'b.csv', text: csv([['M1', 'Z', 'S2', 'P1', '0.5']]) };
    const forward = analyze(parseResultFiles([fail, pass]), limits()).lots[0];
    expect(forward).toMatchObject({ firstPassed: 0, finalPassed: 1, retested: 1 });
    expect(forward.stationYield).toEqual([
      { station: 'S1', meters: 1, firstPassed: 0, firstPassYieldPct: 0 },
    ]);
    const backward = analyze(parseResultFiles([pass, fail]), limits()).lots[0];
    expect(backward).toMatchObject({ firstPassed: 1, finalPassed: 0 });
  });

  it('orders retests across files by tested_at when every file has it', () => {
    const late = { name: 'a.csv', text: csv([['M1', 'Z', 'S1', 'P1', '1.5', '2026-11-10T09:00:00Z'], ['M1', 'Z', 'S1', 'P2', '0', '2026-11-10T09:00:00Z']]) };
    const early = { name: 'b.csv', text: csv([['M1', 'Z', 'S2', 'P1', '0.5', '2026-11-10T08:00:00Z']]) };
    const lotZ = analyze(parseResultFiles([late, early]), limits()).lots[0];
    expect(lotZ).toMatchObject({ firstPassed: 1, finalPassed: 0 });
    expect(lotZ.stationYield.map((y) => y.station)).toEqual(['S2']);
  });

  it('names the file when a point or lot problem is in a second file', () => {
    const a = { name: 'a.csv', text: csv([['M1', 'Z', 'S1', 'P1', '0']]) };
    const b = { name: 'b.csv', text: csv([['M1', 'W', 'S1', 'P2', '0']]) };
    expect(() => analyze(parseResultFiles([a, b]), limits())).toThrow('Results CSV b.csv line 2: meter M1 appears in lot Z and lot W.');
  });
});

