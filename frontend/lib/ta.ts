// Client-side indicator maths for chart overlays. Mirrors backend/indicators.py (same seeding / min_periods).
export type N = number | null;

export function sma(x: number[], n: number): N[] {
  const out: N[] = new Array(x.length).fill(null);
  let s = 0;
  for (let i = 0; i < x.length; i++) {
    s += x[i];
    if (i >= n) s -= x[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}

// pandas ewm(adjust=False, min_periods=n): seeded with the first valid value, emits after n valid observations.
export function ema(x: N[], n: number, alpha = 2 / (n + 1)): N[] {
  const out: N[] = new Array(x.length).fill(null);
  let prev: number | null = null, seen = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    if (v === null) continue;
    prev = prev === null ? v : alpha * v + (1 - alpha) * prev;
    seen++;
    if (seen >= n) out[i] = prev;
  }
  return out;
}

export function rsi(c: number[], n = 14): N[] {
  const out: N[] = new Array(c.length).fill(null);
  const a = 1 / n;
  let ag = 0, al = 0;
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1], g = Math.max(d, 0), l = Math.max(-d, 0);
    if (i === 1) { ag = g; al = l; } else { ag = a * g + (1 - a) * ag; al = a * l + (1 - a) * al; }
    if (i >= n) out[i] = al === 0 ? (ag > 0 ? 100 : 50) : 100 - 100 / (1 + ag / al);
  }
  return out;
}

export function macd(c: number[], fast = 12, slow = 26, sig = 9) {
  const ef = ema(c, fast), es = ema(c, slow);
  const line: N[] = c.map((_, i) => (ef[i] !== null && es[i] !== null ? (ef[i] as number) - (es[i] as number) : null));
  const signal = ema(line, sig);
  const hist: N[] = line.map((v, i) => (v !== null && signal[i] !== null ? v - (signal[i] as number) : null));
  return { line, signal, hist };
}

export function bollinger(c: number[], n = 20, k = 2) {
  const mid = sma(c, n);
  const up: N[] = [], lo: N[] = [];
  for (let i = 0; i < c.length; i++) {
    const m = mid[i];
    if (m === null) { up.push(null); lo.push(null); continue; }
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += (c[j] - m) ** 2;
    const sd = Math.sqrt(s / n);
    up.push(m + k * sd); lo.push(m - k * sd);
  }
  return { mid, up, lo };
}
