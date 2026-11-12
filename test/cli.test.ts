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
    [['--limits', limitsFile], 'exactly one results CSV'],
    [[results, results, '--limits', limitsFile], 'exactly one results CSV'],
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
});
