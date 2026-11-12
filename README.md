# meter-eol-check

Offline CLI and TypeScript library that turns smart-meter **end-of-line (EOL) accuracy test** results into a lot
report: first-pass and final yield, per-point statistics with Cpk, station (fixture) bias, and the list of meters
that failed. No network, no runtime dependencies, reads two local files.

> Status: v0.1, private. The limits come from you: the tool ships **no standard limit tables** (meter-class
> limits are defined in paid standards and in your own test plan). `examples/` holds made-up example data.

## Input

**Results CSV** (long form, one row per meter, test point and attempt; extra columns are ignored):

```csv
serial,lot,station,point,error_pct,tested_at
KF1001,L2611-A,EOL-2,Iref-PF1,0.083,2026-11-10T08:00:04+08:00
```

- `error_pct` is the meter's error in percent, a plain decimal (`-0.125`, up to 6 decimals).
- A repeated `serial` + `point` is a **retest**. Attempts are ordered by `tested_at` when the column is filled on
  every row, else by file order (use one time convention per file: either all with a UTC offset or all
  local times). First pass uses each point's first attempt, final yield the last attempt.
- A meter missing any point of the profile counts as **incomplete** and fails both yields.
- A meter in two lots, or a point the profile does not list, is an input error (catches typos).

**Limits profile JSON** (yours):

```json
{
  "name": "Single-phase class 1 plan rev C",
  "points": {
    "Imin-PF1": { "lower": -1.5, "upper": 1.5 },
    "Iref-PF1": { "lower": -1.0, "upper": 1.0 }
  },
  "minFirstPassYieldPct": 98
}
```

Limits are inclusive and compared exactly on the decimal text (a reading of `1.000` against `1.0` passes; no float
rounding surprises).

## Usage

```sh
npm ci && npm run build
node dist/cli.js examples/results-example.csv --limits examples/limits-example.json
node dist/cli.js results.csv --limits plan.json --lot L2611-A --md > L2611-A.md
node dist/cli.js results.csv --limits plan.json --json | jq '.lots[].firstPassYieldPct'
```

Options: `--lot <id>`, `--min-fpy <percent>` (overrides the profile), `--bias-flag <fraction>` (default 0.25),
`--json`, `--md`.

Exit codes: `0` ok, `1` a lot's first-pass yield is under the minimum (handy as a gate in a script), `2` input error.

Example output (made-up data):

```text
Lot L2611-A: 24 meters, first-pass yield 91.7% (22/24) BELOW minimum 92%, final yield 95.8% (23/24), retested 2, incomplete 0
  Point (first attempts)      limits            n     mean    sd     min     max    Cpk  fails
  Imin-PF1                   -1.500..+1.500     24  +0.073  0.481  -1.620  +1.002   0.99     1
  ...
  Stations: EOL-1, EOL-2, EOL-3; 1 bias flag(s) over 25% of half tolerance
    EOL-3 @ Itr-PF1: bias -0.254% vs other stations (25.4% of half tolerance, n=8)
  Failed first pass (2):
    KF1005: first: Iref-PF0.5L +1.214% (0.214 outside) | passed on retest
    KF1011: first: Imin-PF1 -1.620% (0.120 outside) | still failing after retest
```

## What is computed

- **First-pass yield**: meters complete and inside the limits on every point's first attempt / meters in the lot.
- **Final yield**: the same on the last attempt of each point.
- **Point statistics** (first attempts, i.e. the process before retest): n, mean, sample standard deviation, min,
  max, fails and `Cpk = min(upper - mean, mean - lower) / (3 sd)` (n/a for n < 2 or zero spread). Cpk uses the
  overall sample sd (strictly that is Ppk-style; there is no subgrouping).
- **Station bias**: per point, a station's mean minus the mean of all other stations' first attempts, flagged when
  its size exceeds `--bias-flag` x half the tolerance band. Needs at least two stations in the lot.

## Library

```ts
import { analyze, parseLimits, parseResults, textReport } from './src/index.js';
const report = analyze(parseResults(csvText), parseLimits(JSON.parse(limitsText)), { biasFlag: 0.25 });
```

## Development

`npm run check` (lint, typecheck, tests), `npm run build`, `npm run smoke` (built CLI incl. a 20,000-meter lot).
CI runs all of them on Node 20 and 22.

## Not in v0.1

Standard limit tables, test-bench vendor file formats (need real samples), SPC charts, subgrouped Cpk.

## License

MIT
