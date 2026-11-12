import { parseMicro } from './decimal.js';
import { InputError } from './errors.js';

export interface PointLimit {
  point: string;
  /** Lower and upper error limits in micro-percent (inclusive). */
  lower: number;
  upper: number;
}

export interface Limits {
  name: string;
  /** Points in the order the profile lists them. */
  points: PointLimit[];
  /** Minimum first-pass yield in percent (0-100), if the profile sets one. */
  minFirstPassYieldPct?: number;
}

const POINT_ID = /^[A-Za-z0-9][A-Za-z0-9_.:/+-]{0,39}$/;

function limitText(value: unknown, what: string): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'string') {
    return value;
  }
  throw new InputError(`${what} must be a number or a decimal string.`);
}

/** Validates a user-supplied limits profile (parsed JSON). */
export function parseLimits(json: unknown): Limits {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new InputError('Limits file must be a JSON object with "name" and "points".');
  }
  const raw = json as Record<string, unknown>;
  const name = typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.trim() : undefined;
  if (!name) {
    throw new InputError('Limits file: "name" must be a non-empty string.');
  }
  if (typeof raw.points !== 'object' || raw.points === null || Array.isArray(raw.points)) {
    throw new InputError('Limits file: "points" must be an object like { "Iref-PF1": { "lower": -1, "upper": 1 } }.');
  }
  const points: PointLimit[] = [];
  for (const [point, value] of Object.entries(raw.points as Record<string, unknown>)) {
    if (!POINT_ID.test(point)) {
      throw new InputError(`Limits file: point "${point}" must be 1-40 characters of letters, digits and _ . : / + -, starting with a letter or digit.`);
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new InputError(`Limits file: point "${point}" must be an object with "lower" and "upper".`);
    }
    const v = value as Record<string, unknown>;
    const lower = parseMicro(limitText(v.lower, `point "${point}" lower`), `Limits file: point "${point}" lower`);
    const upper = parseMicro(limitText(v.upper, `point "${point}" upper`), `Limits file: point "${point}" upper`);
    if (lower >= upper) {
      throw new InputError(`Limits file: point "${point}" lower must be below upper.`);
    }
    points.push({ point, lower, upper });
  }
  if (points.length === 0) {
    throw new InputError('Limits file: "points" must list at least one test point.');
  }
  const limits: Limits = { name, points };
  if (raw.minFirstPassYieldPct !== undefined) {
    const min = raw.minFirstPassYieldPct;
    if (typeof min !== 'number' || !Number.isFinite(min) || min < 0 || min > 100) {
      throw new InputError('Limits file: "minFirstPassYieldPct" must be a number from 0 to 100.');
    }
    limits.minFirstPassYieldPct = min;
  }
  return limits;
}
