import { describe, expect, it } from 'vitest';
import { parseMicro, signed } from '../src/decimal.js';
import { InputError } from '../src/errors.js';

describe('parseMicro', () => {
  it('parses decimals exactly into micro-units', () => {
    expect(parseMicro('1.000', 'x')).toBe(1_000_000);
    expect(parseMicro('1', 'x')).toBe(parseMicro('1.0', 'x'));
    expect(parseMicro('-0.125', 'x')).toBe(-125_000);
    expect(parseMicro('+0.000001', 'x')).toBe(1);
    expect(parseMicro(' 2.5 ', 'x')).toBe(2_500_000);
    expect(Object.is(parseMicro('-0', 'x'), 0)).toBe(true);
  });

  it('rejects other notations', () => {
    for (const bad of ['', '1e3', '.5', '1.', '1.1234567', 'abc', '1,5', '1234567']) {
      expect(() => parseMicro(bad, 'field')).toThrow(InputError);
    }
    expect(() => parseMicro('x', 'Results CSV line 3: error_pct')).toThrow('Results CSV line 3: error_pct: "x"');
  });
});

describe('signed', () => {
  it('adds a plus sign to positive values and never prints -0', () => {
    expect(signed(0.5)).toBe('+0.500');
    expect(signed(-0.25)).toBe('-0.250');
    expect(signed(-0.0001)).toBe('0.000');
    expect(signed(0)).toBe('0.000');
  });
});
