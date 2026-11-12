import { parseCsv } from './csv.js';
import { parseMicro } from './decimal.js';
import { InputError } from './errors.js';

export interface Attempt {
  serial: string;
  lot: string;
  station: string;
  point: string;
  /** Measured error in micro-percent. */
  error: number;
  /** Optional test time as given (ISO 8601); used to order retests. */
  testedAt?: string;
  testedAtMs?: number;
  /** 1-based CSV line number of the row (header is line 1). */
  line: number;
  /** Source file name, set when several results files are read as one set. */
  file?: string;
  /** Position across all files read as one set (file order, then row order); orders retests without tested_at. */
  seq?: number;
}

/** "Results CSV line 3" or "Results CSV day2.csv line 3": where a row came from, for error messages. */
export function where(a: Pick<Attempt, 'line' | 'file'>): string {
  return `Results CSV${a.file === undefined ? '' : ` ${a.file}`} line ${a.line}`;
}

const REQUIRED = ['serial', 'lot', 'station', 'point', 'error_pct'] as const;
const ISO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * Parses an end-of-line results CSV in long form: one row per meter, test point and attempt.
 * Columns: serial,lot,station,point,error_pct and optionally tested_at. Extra columns are ignored.
 */
export function parseResults(text: string, file?: string): Attempt[] {
  const label = file === undefined ? 'Results CSV' : `Results CSV ${file}`;
  let rows: string[][];
  try {
    rows = parseCsv(text);
  } catch (e) {
    if (e instanceof InputError && file !== undefined) {
      throw new InputError(`${file}: ${e.message}`);
    }
    throw e;
  }
  if (rows.length === 0) {
    throw new InputError(`${label} is empty.`);
  }
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const index = new Map<string, number>();
  header.forEach((h, i) => {
    if (index.has(h)) {
      throw new InputError(`${label}: column "${h}" appears twice in the header.`);
    }
    index.set(h, i);
  });
  const missing = REQUIRED.filter((c) => !index.has(c));
  if (missing.length > 0) {
    throw new InputError(`${label}: missing column(s) ${missing.join(', ')}. Expected header: serial,lot,station,point,error_pct[,tested_at].`);
  }
  const at = index.get('tested_at');
  const attempts: Attempt[] = [];
  let withTime = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const line = r + 1;
    const cell = (name: string) => (row[index.get(name)!] ?? '').trim();
    const attempt: Attempt = {
      serial: cell('serial'),
      lot: cell('lot'),
      station: cell('station'),
      point: cell('point'),
      error: 0,
      line,
    };
    if (file !== undefined) {
      attempt.file = file;
    }
    for (const name of ['serial', 'lot', 'station', 'point'] as const) {
      if (attempt[name] === '') {
        throw new InputError(`${where(attempt)}: ${name} is empty.`);
      }
    }
    attempt.error = parseMicro(cell('error_pct'), `${where(attempt)}: error_pct`);
    const time = at === undefined ? '' : (row[at] ?? '').trim();
    if (time !== '') {
      const ms = Date.parse(time.replace(' ', 'T'));
      if (!ISO.test(time) || Number.isNaN(ms)) {
        throw new InputError(`${where(attempt)}: tested_at "${time}" is not an ISO 8601 date-time.`);
      }
      attempt.testedAt = time;
      attempt.testedAtMs = ms;
      withTime++;
    }
    attempts.push(attempt);
  }
  if (attempts.length === 0) {
    throw new InputError(`${label} has a header but no rows.`);
  }
  if (withTime !== 0 && withTime !== attempts.length) {
    throw new InputError(`${label}: tested_at must be filled on every row or on none (it orders retests).`);
  }
  return attempts;
}

/**
 * Reads several results files as one set (for example one file per shift, day or bench). Retests are ordered by
 * tested_at when every row of every file has it, else by file order then row order. Error messages name the file.
 */
export function parseResultFiles(files: { name: string; text: string }[]): Attempt[] {
  if (files.length === 0) {
    throw new InputError('Give at least one results CSV.');
  }
  const names = new Set<string>();
  const all: Attempt[] = [];
  let timed = 0;
  for (const { name, text } of files) {
    if (names.has(name)) {
      throw new InputError(`Results CSV ${name} is given twice (its rows would count as retests).`);
    }
    names.add(name);
    const attempts = parseResults(text, files.length > 1 ? name : undefined);
    if (attempts[0].testedAtMs !== undefined) {
      timed++;
    }
    for (const a of attempts) {
      a.seq = all.length;
      all.push(a);
    }
  }
  if (timed !== 0 && timed !== files.length) {
    throw new InputError('Results CSVs: tested_at must be filled in every file or in none (it orders retests across files).');
  }
  return all;
}
