import { describe, expect, it } from 'vitest';
import { InputError } from '../src/errors.js';
import { parseResultFiles, parseResults } from '../src/results.js';
import { csv } from './helpers.js';

describe('parseResults', () => {
  it('reads rows with line numbers, any column order and extra columns', () => {
    const rows = parseResults('\ufefflot,Serial,point,station,error_pct,operator\r\nL1,M1,P1,S1,-0.250,ann\r\nL1,M1,P2,S1,0.1,ann\r\n');
    expect(rows).toEqual([
      { serial: 'M1', lot: 'L1', station: 'S1', point: 'P1', error: -250_000, line: 2 },
      { serial: 'M1', lot: 'L1', station: 'S1', point: 'P2', error: 100_000, line: 3 },
    ]);
  });

  it('reads quoted fields', () => {
    const rows = parseResults('serial,lot,station,point,error_pct\n"M,1",L1,"EOL ""A""",P1,"0.5"\n');
    expect(rows[0]).toMatchObject({ serial: 'M,1', station: 'EOL "A"', error: 500_000 });
  });

  it('reads tested_at when every row has it', () => {
    const rows = parseResults(csv([['M1', 'L1', 'S1', 'P1', '0.1', '2026-11-10T08:00:00+08:00'], ['M1', 'L1', 'S1', 'P1', '0.2', '2026-11-10 08:01']]));
    expect(rows[0].testedAt).toBe('2026-11-10T08:00:00+08:00');
    expect(rows[0].testedAtMs).toBe(Date.parse('2026-11-10T00:00:00Z'));
    expect(rows[1].testedAtMs).toBeTypeOf('number');
  });

  it.each([
    ['', 'empty'],
    ['serial,lot,station,point,error_pct\n', 'no rows'],
    ['serial,lot,point,error_pct\nM1,L1,P1,0', 'missing column(s) station'],
    ['serial,lot,station,point,error_pct,lot\nM1,L1,S1,P1,0,L1', 'appears twice'],
    [csv([['M1', '', 'S1', 'P1', '0']]), 'line 2: lot is empty'],
    [csv([['M1', 'L1', 'S1', 'P1', '0.1%']]), 'line 2: error_pct'],
    [csv([['M1', 'L1', 'S1', 'P1', '0', '10/11/2026']]), 'not an ISO 8601'],
    [csv([['M1', 'L1', 'S1', 'P1', '0', '2026-11-10T08:00'], ['M1', 'L1', 'S1', 'P2', '0', '']]), 'every row or on none'],
  ])('rejects bad input %#', (text, message) => {
    expect(() => parseResults(text)).toThrow(InputError);
    expect(() => parseResults(text)).toThrow(message);
  });
});

describe('parseResultFiles', () => {
  const a = { name: 'a.csv', text: csv([['M1', 'L1', 'S1', 'P1', '0.1'], ['M1', 'L1', 'S1', 'P2', '0.2']]) };
  const b = { name: 'b.csv', text: csv([['M2', 'L1', 'S1', 'P1', '0.3']]) };

  it('joins files in order with a running position and the file name', () => {
    const rows = parseResultFiles([a, b]);
    expect(rows.map((r) => [r.file, r.line, r.seq])).toEqual([
      ['a.csv', 2, 0],
      ['a.csv', 3, 1],
      ['b.csv', 2, 2],
    ]);
  });

  it('leaves the file name off for a single file, so messages match parseResults', () => {
    const rows = parseResultFiles([a]);
    expect(rows[0].file).toBeUndefined();
    expect(rows[1].seq).toBe(1);
    expect(() => parseResultFiles([{ name: 'x.csv', text: 'serial,lot\n' }])).toThrow('Results CSV: missing column(s)');
  });

  it.each([
    [[], 'at least one results CSV'],
    [[a, a], 'Results CSV a.csv is given twice'],
    [[a, { name: 'c.csv', text: csv([['M3', 'L1', 'S1', 'P1', '0', '2026-11-10T08:00:00Z']]) }], 'tested_at must be filled in every file or in none'],
    [[a, { name: 'd.csv', text: 'serial,lot,station,point,error_pct\nM3,L1,S1,P1,x\n' }], 'Results CSV d.csv line 2: error_pct'],
    [[a, { name: 'e.csv', text: 'serial,lot,station,point\nM3,L1,S1,P1\n' }], 'Results CSV e.csv: missing column(s) error_pct'],
    [[a, { name: 'f.csv', text: 'serial,lot,station,point,error_pct\nM3,L"1,S1,P1,0\n' }], 'f.csv: CSV line 2'],
    [[a, { name: 'g.csv', text: '' }], 'Results CSV g.csv is empty'],
  ])('rejects bad sets %#', (files, message) => {
    expect(() => parseResultFiles(files)).toThrow(InputError);
    expect(() => parseResultFiles(files)).toThrow(message);
  });
});

