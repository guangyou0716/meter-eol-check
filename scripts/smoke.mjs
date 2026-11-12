#!/usr/bin/env node
// End-to-end check of the built CLI (dist/cli.js), run directly and through a symlink like an npm bin.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = join(root, 'dist', 'cli.js');
const example = (name) => join(root, 'examples', name);
const fail = (message) => {
  console.error(`smoke: FAIL ${message}`);
  process.exit(1);
};
const run = (bin, args) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' });

const dir = mkdtempSync(join(tmpdir(), 'eol-smoke-'));
const link = join(dir, 'meter-eol-check');
symlinkSync(cli, link);
for (const bin of [cli, link]) {
  const res = run(bin, [example('results-example.csv'), '--limits', example('limits-example.json'), '--json']);
  const data = res.stdout ? JSON.parse(res.stdout) : {};
  if (res.status !== 1 || data.totals?.meters !== 40 || data.totals?.firstPassed !== 37 || data.totals?.finalPassed !== 38) {
    fail(`example via ${bin}: status ${res.status} ${JSON.stringify(data.totals)} ${res.stderr}`);
  }
}
console.log('smoke: ok example (direct and via symlink) 40 meters, FPY 37/40, final 38/40, exit 1 (lot under minimum)');

// A large lot: 20000 meters x 5 points, all inside the limits.
const points = ['Imin-PF1', 'Itr-PF1', 'Iref-PF1', 'Iref-PF0.5L', 'Imax-PF1'];
const rows = ['serial,lot,station,point,error_pct'];
for (let i = 0; i < 20000; i++) {
  for (const [k, p] of points.entries()) {
    rows.push(`SN${i},BIG,EOL-${i % 4},${p},${(((i * 7 + k * 13) % 101) - 50) / 100}`);
  }
}
const big = join(dir, 'big.csv');
writeFileSync(big, `${rows.join('\n')}\n`);
const started = Date.now();
const res = run(cli, [big, '--limits', example('limits-example.json'), '--json']);
const data = res.stdout ? JSON.parse(res.stdout) : {};
if (res.status !== 0 || data.lots?.[0]?.meters !== 20000 || data.lots[0].firstPassYieldPct !== 100) {
  fail(`big lot: status ${res.status} ${JSON.stringify(data.totals)} ${res.stderr}`);
}
console.log(`smoke: ok big lot 20000 meters x 5 points in ${Date.now() - started} ms, FPY 100%`);

const bad = run(cli, [example('results-example.csv'), '--limits', example('results-example.csv')]);
if (bad.status !== 2 || !bad.stderr.includes('not valid JSON')) {
  fail(`bad limits: status ${bad.status} ${bad.stderr}`);
}
console.log('smoke: ok bad limits file -> exit 2');

// The example split into two files (first half, second half) must give the same report as the whole file.
const [head, ...body] = readFileSync(example('results-example.csv'), 'utf8').trimEnd().split('\n');
const half = Math.floor(body.length / 2);
const part1 = join(dir, 'part1.csv');
const part2 = join(dir, 'part2.csv');
writeFileSync(part1, `${[head, ...body.slice(0, half)].join('\n')}\n`);
writeFileSync(part2, `${[head, ...body.slice(half)].join('\n')}\n`);
const whole = run(cli, [example('results-example.csv'), '--limits', example('limits-example.json'), '--json']);
const split = run(cli, [part1, part2, '--limits', example('limits-example.json'), '--json']);
if (split.status !== 1 || split.stdout !== whole.stdout || !JSON.parse(split.stdout).lots[0].stationYield?.length) {
  fail(`split files: status ${split.status} ${split.stderr}`);
}
console.log('smoke: ok example split into two files -> identical report incl. station yield');
