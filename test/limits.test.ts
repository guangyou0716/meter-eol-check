import { describe, expect, it } from 'vitest';
import { InputError } from '../src/errors.js';
import { parseLimits } from '../src/limits.js';

const ok = { name: 'plan', points: { 'Iref-PF1': { lower: -1, upper: 1 } } };

describe('parseLimits', () => {
  it('accepts numbers or decimal strings and keeps the point order', () => {
    const l = parseLimits({ name: ' plan ', points: { B: { lower: '-0.2', upper: 0.2 }, A: { lower: -1, upper: 1 } }, minFirstPassYieldPct: 98.5 });
    expect(l.name).toBe('plan');
    expect(l.points.map((p) => p.point)).toEqual(['B', 'A']);
    expect(l.points[0]).toEqual({ point: 'B', lower: -200_000, upper: 200_000 });
    expect(l.minFirstPassYieldPct).toBe(98.5);
  });

  it('leaves the minimum out when the profile has none', () => {
    expect(parseLimits(ok).minFirstPassYieldPct).toBeUndefined();
  });

  it.each([
    [null, 'JSON object'],
    [[], 'JSON object'],
    [{ points: ok.points }, '"name"'],
    [{ name: 'p', points: [] }, '"points" must be an object'],
    [{ name: 'p', points: {} }, 'at least one'],
    [{ name: 'p', points: { 'bad point': { lower: -1, upper: 1 } } }, 'point "bad point"'],
    [{ name: 'p', points: { P: 5 } }, 'must be an object with "lower"'],
    [{ name: 'p', points: { P: { lower: 1, upper: 1 } } }, 'lower must be below upper'],
    [{ name: 'p', points: { P: { lower: 'x', upper: 1 } } }, 'lower: "x"'],
    [{ name: 'p', points: { P: { upper: 1 } } }, 'lower must be a number'],
    [{ ...ok, minFirstPassYieldPct: 101 }, 'minFirstPassYieldPct'],
    [{ ...ok, minFirstPassYieldPct: '98' }, 'minFirstPassYieldPct'],
  ])('rejects %j', (json, message) => {
    expect(() => parseLimits(json)).toThrow(InputError);
    expect(() => parseLimits(json)).toThrow(message);
  });
});
