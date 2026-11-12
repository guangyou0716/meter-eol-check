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
}

const REQUIRED = ['serial', 'lot', 'station', 'point', 'error_pct'] as const;
const ISO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * Parses an end-of-line results CSV in long form: one row per meter, test point and attempt.
 * Columns: serial,lot,station,point,error_pct and optionally tested_at. Extra columns are ignored.
 */
export function parseResults(text: string): Attempt[] {
  const rows = parseCsv(text);
  if (rows.length === 0) {
    throw new InputError('Results CSV is empty.');
  }
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const index = new Map<string, number>();
  header.forEach((h, i) => {
    if (index.has(h)) {
      throw new InputError(`Results CSV: column "${h}" appears twice in the header.`);
    }
    index.set(h, i);
  });
  const missing = REQUIRED.filter((c) => !index.has(c));
  if (missing.length > 0) {
    throw new InputError(`Results CSV: missing column(s) ${missing.join(', ')}. Expected header: serial,lot,station,point,error_pct[,tested_at].`);
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
    for (const name of ['serial', 'lot', 'station', 'point'] as const) {
      if (attempt[name] === '') {
        throw new InputError(`Results CSV line ${line}: ${name} is empty.`);
      }
    }
    attempt.error = parseMicro(cell('error_pct'), `Results CSV line ${line}: error_pct`);
    const time = at === undefined ? '' : (row[at] ?? '').trim();
    if (time !== '') {
      const ms = Date.parse(time.replace(' ', 'T'));
      if (!ISO.test(time) || Number.isNaN(ms)) {
        throw new InputError(`Results CSV line ${line}: tested_at "${time}" is not an ISO 8601 date-time.`);
      }
      attempt.testedAt = time;
      attempt.testedAtMs = ms;
      withTime++;
    }
    attempts.push(attempt);
  }
  if (attempts.length === 0) {
    throw new InputError('Results CSV has a header but no rows.');
  }
  if (withTime !== 0 && withTime !== attempts.length) {
    throw new InputError('Results CSV: tested_at must be filled on every row or on none (it orders retests).');
  }
  return attempts;
}
