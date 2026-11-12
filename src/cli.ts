#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { analyze } from './analyze.js';
import { InputError } from './errors.js';
import { parseLimits } from './limits.js';
import { jsonReport, markdownReport, textReport } from './report.js';
import { parseResultFiles } from './results.js';

const USAGE = `Usage: meter-eol-check <results.csv> [more.csv ...] --limits <limits.json> [options]

Lot report for smart-meter end-of-line accuracy tests: first-pass and final yield, per-point statistics and Cpk
(first attempts), station yield and bias, and the meters that failed. Offline; reads local files only.

results.csv columns: serial,lot,station,point,error_pct[,tested_at]. One row per meter, test point and attempt;
a repeated serial+point is a retest (ordered by tested_at when given, else by file order). Several results files
(for example one per shift or bench) are read as one set, in the order given.

limits.json: { "name": "...", "points": { "<point>": { "lower": -1.0, "upper": 1.0 } }, "minFirstPassYieldPct": 98 }
You supply the limits for your meter class and test plan; the tool ships no standard limit tables.

Options:
  --limits <file>       limits profile JSON (required)
  --lot <id>            only this lot
  --min-fpy <percent>   minimum first-pass yield (overrides the profile)
  --bias-flag <frac>    flag a station whose mean differs from the other stations by more than this
                        fraction of half the tolerance band (default 0.25)
  --json                JSON report
  --md                  Markdown report
  -h, --help            show this help

Exit codes: 0 ok, 1 a lot's first-pass yield is under the minimum, 2 input error.
`;

function number(text: string | undefined, flag: string): number | undefined {
  if (text === undefined) {
    return undefined;
  }
  const value = Number(text);
  if (text.trim() === '' || !Number.isFinite(value)) {
    throw new InputError(`${flag} must be a number.`);
  }
  return value;
}

function read(path: string, what: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (e) {
    throw new InputError(`Cannot read ${what} ${path}: ${(e as NodeJS.ErrnoException).code ?? String(e)}`);
  }
}

export function main(argv: string[]): number {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        limits: { type: 'string' },
        lot: { type: 'string' },
        'min-fpy': { type: 'string' },
        'bias-flag': { type: 'string' },
        json: { type: 'boolean', default: false },
        md: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
    if (values.help) {
      process.stdout.write(USAGE);
      return 0;
    }
    if (positionals.length === 0) {
      throw new InputError('Give at least one results CSV.');
    }
    const seen = new Set<string>();
    for (const path of positionals) {
      if (seen.has(resolve(path))) {
        throw new InputError(`Results CSV ${path} is given twice (its rows would count as retests).`);
      }
      seen.add(resolve(path));
    }
    if (!values.limits) {
      throw new InputError('--limits <limits.json> is required.');
    }
    if (values.json && values.md) {
      throw new InputError('Use either --json or --md, not both.');
    }
    const minFpy = number(values['min-fpy'], '--min-fpy');
    if (minFpy !== undefined && (minFpy < 0 || minFpy > 100)) {
      throw new InputError('--min-fpy must be from 0 to 100.');
    }
    const biasFlag = number(values['bias-flag'], '--bias-flag');
    let json: unknown;
    try {
      json = JSON.parse(read(values.limits, 'limits file'));
    } catch (e) {
      if (e instanceof InputError) {
        throw e;
      }
      throw new InputError(`Limits file ${values.limits} is not valid JSON: ${(e as Error).message}`);
    }
    const limits = parseLimits(json);
    let attempts = parseResultFiles(positionals.map((path) => ({ name: path, text: read(path, 'results CSV') })));
    if (values.lot !== undefined) {
      const lot = values.lot;
      // Check points and lot membership on the whole file first, so a typo elsewhere is not hidden.
      analyze(attempts, limits, { biasFlag, minFirstPassYieldPct: minFpy });
      attempts = attempts.filter((a) => a.lot === lot);
      if (attempts.length === 0) {
        throw new InputError(`No rows for lot ${lot}.`);
      }
    }
    const report = analyze(attempts, limits, { biasFlag, minFirstPassYieldPct: minFpy });
    process.stdout.write(values.json ? jsonReport(report) : values.md ? markdownReport(report) : textReport(report));
    return report.belowMinimum ? 1 : 0;
  } catch (e) {
    if (e instanceof InputError || (e as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')) {
      process.stderr.write(`meter-eol-check: ${(e as Error).message}\n`);
      return 2;
    }
    throw e;
  }
}

function isEntryPoint(): boolean {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  process.exitCode = main(process.argv.slice(2));
}
