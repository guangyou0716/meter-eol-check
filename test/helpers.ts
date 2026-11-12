import { fileURLToPath } from 'node:url';
import { parseLimits } from '../src/limits.js';

export const root = fileURLToPath(new URL('..', import.meta.url));

export const limits = () =>
  parseLimits({ name: 'test plan', points: { P1: { lower: -1, upper: 1 }, P2: { lower: '-0.5', upper: '0.5' } } });

/** Results CSV from rows of [serial, lot, station, point, error_pct, tested_at?]. */
export function csv(rows: string[][]): string {
  const header = rows.some((r) => r.length > 5) ? 'serial,lot,station,point,error_pct,tested_at' : 'serial,lot,station,point,error_pct';
  return [header, ...rows.map((r) => r.join(','))].join('\n');
}
