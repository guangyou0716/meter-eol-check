import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from '../src/cli.js';
import { csv, root } from './helpers.js';

const results = join(root, 'examples', 'results-example.csv');
const limitsFile = join(root, 'examples', 'limits-example.json');

function capture() {
  let out = '';
  let err = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => ((out += String(chunk)), true));
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => ((err += String(chunk)), true));
  return { out: () => out, err: () => err };
}

function tmp(name: string, text: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'eol-')), name);
  writeFileSync(path, text);
  return path;
}

afterEach(() => vi.restoreAllMocks());

describe('cli', () => {
  it('prints the text report of the example and exits 1 when a lot is under the minimum', () => {
    const io = capture();
    expect(main([results, '--limits', limitsFile])).toBe(1);
    expect(io.out()).toContain('Lot L2611-A: 24 meters, first-pass yield 91.7% (22/24) BELOW minimum 92%, final yield 95.8% (23/24), retested 2, incomplete 0');
    expect(io.out()).toContain('Lot L2611-B: 16 meters, first-pass yield 93.8% (15/16) (minimum 92% met)');
    expect(io.out()).toContain('KF1005: first: Iref-PF0.5L +1.214% (0.214 outside) | passed on retest');
    expect(io.out()).toContain('KF1011: first: Imin-PF1 -1.620% (0.120 outside) | still failing after retest');
    expect(io.out()).toContain('KF2007: missing Imax-PF1 | not retested');
    expect(io.out()).toContain('All lots: 40 meters, first-pass yield 92.5%, final yield 95.0%');
  });

  it('exits 0 with --min-fpy override and filters one lot', () => {
    const io = capture();
    expect(main([results, '--limits', limitsFile, '--lot', 'L2611-B', '--min-fpy', '90'])).toBe(0);
    expect(io.out()).toContain('Lot L2611-B');
    expect(io.out()).not.toContain('L2611-A');
    expect(io.out()).not.toContain('All lots');
  });

  it('prints JSON with rounded numbers', () => {
    const io = capture();
    main([results, '--limits', limitsFile, '--json']);
    const data = JSON.parse(io.out());
    expect(data.totals).toEqual({ meters: 40, firstPassed: 37, finalPassed: 38, firstPassYieldPct: 92.5, finalYieldPct: 95 });
    expect(data.lots[0].firstPassYieldPct).toBe(91.67);
    expect(data.lots[0].points[0].point).toBe('Imin-PF1');
    expect(data.lots[0].stationCpk).toHaveLength(15);
    expect(data.lots[0].stationCpk[2]).toEqual({ station: 'EOL-3', point: 'Imin-PF1', n: 8, mean: expect.any(Number), stdDev: expect.any(Number), cpk: expect.any(Number) });
    expect(String(data.lots[0].stationCpk[2].cpk).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(3);
    expect(data.belowMinimum).toBe(true);
  });

  it('prints Markdown', () => {
    const io = capture();
    main([results, '--limits', limitsFile, '--md']);
    expect(io.out()).toMatch(/^# EOL accuracy report: /);
    expect(io.out()).toContain('| Point | Limits % | n | Mean % | SD | Min % | Max % | Cpk | Fails |');
    expect(io.out()).toContain('- KF2007: missing Imax-PF1 | not retested');
  });

  it('shows help', () => {
    const io = capture();
    expect(main(['--help'])).toBe(0);
    expect(io.out()).toContain('Usage: meter-eol-check');
  });

  it.each([
    [[results], '--limits <limits.json> is required'],
    [['--limits', limitsFile], 'at least one results CSV'],
    [[results, results, '--limits', limitsFile], 'is given twice'],
    [[results, '--limits', limitsFile, '--json', '--md'], 'either --json or --md'],
    [[results, '--limits', limitsFile, '--min-fpy', '101'], '--min-fpy must be from 0 to 100'],
    [[results, '--limits', limitsFile, '--min-fpy', 'abc'], '--min-fpy must be a number'],
    [[results, '--limits', limitsFile, '--bias-flag', '0'], 'Bias flag must be a positive number'],
    [[results, '--limits', limitsFile, '--lot', 'NOPE'], 'No rows for lot NOPE'],
    [[results, '--limits', '/nonexistent/limits.json'], 'Cannot read limits file /nonexistent/limits.json: ENOENT'],
    [['/nonexistent.csv', '--limits', limitsFile], 'Cannot read results CSV'],
    [[results, '--limits', limitsFile, '--bogus'], "Unknown option '--bogus'"],
  ])('exits 2 on %j', (argv, message) => {
    const io = capture();
    expect(main(argv as string[])).toBe(2);
    expect(io.err()).toContain(message);
    expect(io.out()).toBe('');
  });

  it('exits 2 on invalid limits JSON', () => {
    const io = capture();
    expect(main([results, '--limits', tmp('l.json', '{ nope')])).toBe(2);
    expect(io.err()).toContain('is not valid JSON');
  });

  it('checks the whole file even when --lot picks one lot', () => {
    const file = tmp('r.csv', csv([['M1', 'A', 'S1', 'Imin-PF1', '0'], ['M2', 'B', 'S1', 'Typo', '0']]));
    const io = capture();
    expect(main([file, '--limits', limitsFile, '--lot', 'A'])).toBe(2);
    expect(io.err()).toContain('point "Typo" is not in the limits profile');
  });

  it('reads several results files as one set (same report as one combined file)', () => {
    const header = 'serial,lot,station,point,error_pct';
    const day1 = ['M1,A,S1,P1,0.1', 'M1,A,S1,P2,0.1', 'M2,A,S2,P1,1.2', 'M2,A,S2,P2,0'];
    const day2 = ['M2,A,S1,P1,0.4', 'M3,A,S2,P1,-0.2', 'M3,A,S2,P2,0.6'];
    const limits = tmp('limits.json', JSON.stringify({ name: 'plan', points: { P1: { lower: -1, upper: 1 }, P2: { lower: -0.5, upper: 0.5 } } }));
    const one = tmp('all.csv', [header, ...day1, ...day2].join('\n'));
    const a = tmp('day1.csv', [header, ...day1].join('\n'));
    const b = tmp('day2.csv', [header, ...day2].join('\n'));
    const io = capture();
    main([one, '--limits', limits, '--json']);
    const combined = JSON.parse(io.out());
    vi.restoreAllMocks();
    const io2 = capture();
    main([a, b, '--limits', limits, '--json']);
    const split = JSON.parse(io2.out());
    expect(split).toEqual(combined);
    expect(split.lots[0]).toMatchObject({ meters: 3, firstPassed: 1, finalPassed: 2, retested: 1 });
    expect(split.lots[0].stationYield).toEqual([
      { station: 'S1', meters: 1, firstPassed: 1, firstPassYieldPct: 100 },
      { station: 'S2', meters: 2, firstPassed: 0, firstPassYieldPct: 0 },
    ]);
  });

  it('names the file in errors when several results files are given', () => {
    const a = tmp('good.csv', 'serial,lot,station,point,error_pct\nM1,A,S1,P1,0.1\n');
    const b = tmp('bad.csv', 'serial,lot,station,point,error_pct\nM2,A,S1,P1,abc\n');
    const io = capture();
    expect(main([a, b, '--limits', limitsFile])).toBe(2);
    expect(io.err()).toContain(`Results CSV ${b} line 2: error_pct`);
  });

  it('prints the station first-pass yield in text and Markdown', () => {
    const io = capture();
    main([results, '--limits', limitsFile]);
    expect(io.out()).toContain('Station first-pass yield: EOL-1 100.0% (8/8), EOL-2 100.0% (8/8), EOL-3 75.0% (6/8)');
    expect(io.out()).toContain('  Station Cpk (first attempts):\n    Imin-PF1                 EOL-1 2.27 (n=8), EOL-2 2.03 (n=8), EOL-3 0.55 (n=8)');
    vi.restoreAllMocks();
    const io2 = capture();
    main([results, '--limits', limitsFile, '--md']);
    expect(io2.out()).toContain('| Station | Meters | First passed | First-pass yield |');
    expect(io2.out()).toContain('| Point | Station | n | Mean % | SD | Cpk |');
    expect(io2.out()).toContain('| Imin-PF1 | EOL-3 | 8 | +0.195 | 0.791 | 0.55 |');
    expect(io2.out()).toContain('| EOL-3 | 8 | 6 | 75.0% |');
  });
});
