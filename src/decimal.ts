import { InputError } from './errors.js';

/** Fixed scale for error percentages and limits: 6 decimal places (micro-percent). */
export const SCALE = 1_000_000;
const DECIMAL = /^([+-]?)(\d{1,6})(?:\.(\d{1,6}))?$/;

/**
 * Parses a decimal string such as "-0.125" or "+1" into an integer number of micro-units.
 * Pass/fail checks compare these integers, so a reading of "1.000" against a limit of "1.0" is exact.
 */
export function parseMicro(text: string, what: string): number {
  const match = DECIMAL.exec(text.trim());
  if (!match) {
    throw new InputError(`${what}: "${text}" is not a decimal number (up to 6 digits before and after the point).`);
  }
  const [, sign, whole, frac = ''] = match;
  const micro = Number(whole) * SCALE + Number(frac.padEnd(6, '0'));
  return sign === '-' && micro !== 0 ? -micro : micro;
}

export const toNumber = (micro: number): number => micro / SCALE;

/** Formats a float with a fixed number of decimals and an explicit sign for non-zero values. */
export function signed(value: number, decimals = 3): string {
  const text = value.toFixed(decimals);
  if (Number(text) === 0) {
    return (0).toFixed(decimals);
  }
  return value > 0 ? `+${text}` : text;
}
