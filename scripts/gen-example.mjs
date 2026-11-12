// Regenerates examples/results-example.csv: node scripts/gen-example.mjs > examples/results-example.csv
// Deterministic example data (made up, for demonstration only).
let s = 20261112;
const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const points = ['Imin-PF1', 'Itr-PF1', 'Iref-PF1', 'Iref-PF0.5L', 'Imax-PF1'];
const sd = { 'Imin-PF1': 0.35, 'Itr-PF1': 0.2, 'Iref-PF1': 0.12, 'Iref-PF0.5L': 0.18, 'Imax-PF1': 0.15 };
const rows = ['serial,lot,station,point,error_pct,tested_at'];
let t = Date.parse('2026-11-10T08:00:00+08:00');
const iso = (ms) => new Date(ms + 8 * 3600e3).toISOString().slice(0, 19) + '+08:00';
for (const [lot, count, base] of [['L2611-A', 24, 1000], ['L2611-B', 16, 2000]]) {
  for (let i = 1; i <= count; i++) {
    const serial = `KF${base + i}`;
    const station = `EOL-${(i % 3) + 1}`;
    const bias = station === 'EOL-3' && lot === 'L2611-A' ? 0.5 : 0;
    for (const p of points) {
      if (lot === 'L2611-B' && i === 7 && p === 'Imax-PF1') continue; // incomplete meter
      let e = gauss() * sd[p] + (p === 'Imin-PF1' ? bias : 0);
      if (lot === 'L2611-A' && i === 5 && p === 'Iref-PF0.5L') e = 1.214; // fails, passes on retest
      if (lot === 'L2611-A' && i === 11 && p === 'Imin-PF1') e = -1.62; // fails, still fails
      rows.push(`${serial},${lot},${station},${p},${e.toFixed(3)},${iso((t += 4000))}`);
    }
  }
}
rows.push(`KF1005,L2611-A,EOL-1,Iref-PF0.5L,0.402,${iso((t += 60000))}`);
rows.push(`KF1011,L2611-A,EOL-2,Imin-PF1,-1.551,${iso((t += 60000))}`);
console.log(rows.join('\n'));
