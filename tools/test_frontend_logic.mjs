// tools/test_frontend_logic.mjs
// Runs the browser P/E and P/B maths (frontend/lib/valuation.ts, compiled to /tmp/tsout) against known answers.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { prepareFilings, valuationSeries } = createRequire(import.meta.url)("/tmp/tsout/valuation.js");

const Q = (end, pub, ni, eq = 1000, sh = 100) => ({ period_end: end, published: pub, net_income_parent: ni, equity_parent: eq, shares: sh });
const four = [Q("2024-03-31", "2024-04-20", 10), Q("2024-06-30", "2024-07-20", 20), Q("2024-09-30", "2024-10-20", 30), Q("2024-12-31", "2025-01-30", 40), Q("2025-03-31", "2025-04-20", 50)];

let f = prepareFilings(four);
assert.equal(f.length, 5);
assert.equal(f[3].niTtm, 100);                       // 10+20+30+40
assert.equal(f[4].niTtm, 140);                       // 20+30+40+50
assert.equal(f[2].niTtm, null);                      // fewer than 4 quarters -> unknown, not guessed

f = prepareFilings([four[0], four[1], four[3], four[4]]);
assert.ok(f.every((x) => x.niTtm === null), "a missing quarter must break the TTM sum");

f = prepareFilings(four);
const v = valuationSeries(["2025-01-29", "2025-01-30", "2025-04-19", "2025-04-20"], [10, 10, 10, 10], f, 1);
assert.equal(v[0].pe, null);                         // annual report not public yet on 29 Jan (no look-ahead)
assert.equal(v[1].ni, 100);
assert.equal(v[2].ni, 100);
assert.equal(v[3].ni, 140);                          // Q1 filing public from 20 Apr
assert.equal(v[1].mcap, 10 * 1 * 100);               // price x unit x shares
assert.equal(v[1].pe, 1000 / 100);
assert.equal(v[1].pb, 1000 / 1000);

// impossible dates must never collapse the history into one quarter (the 1970 bug)
const broken = four.map((q) => ({ ...q, period_end: "1970-01-01" }));
assert.equal(prepareFilings(broken).length, 0);
const mixed = prepareFilings([...four, Q("1970-01-01", "1970-04-01", 999)]);
assert.equal(mixed.length, 5);

// loss-making: no P/E, P/B still works
const loss = prepareFilings(four.map((q) => ({ ...q, net_income_parent: -5 })));
const lv = valuationSeries(["2025-02-10"], [10], loss, 1);
assert.equal(lv[0].pe, null);
assert.equal(lv[0].pb, 1);

// stale filing (older than 400 days) -> no valuation
assert.equal(valuationSeries(["2026-06-01"], [10], prepareFilings(four), 1)[0].pe, null);
console.log("frontend valuation logic: all checks passed");
