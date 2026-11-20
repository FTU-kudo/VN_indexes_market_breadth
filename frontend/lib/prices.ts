import { getJSON, PriceYear } from "./data";

/** All stored daily bars for a stock (falls back to an index code), oldest first. */
export async function loadPrices(sym: string): Promise<{ bars: PriceYear; kind: string } | null> {
  for (const kind of ["stocks", "indexes"]) {
    const years = Array.from({ length: new Date().getFullYear() - 2019 }, (_, i) => 2020 + i);
    const parts = (await Promise.all(years.map((y) => getJSON<PriceYear>(`prices/${kind}/${sym}/${y}.json`)))).filter(Boolean) as PriceYear[];
    if (parts.length) {
      const bars: PriceYear = { d: [], o: [], h: [], l: [], c: [], v: [] };
      parts.forEach((p) => (["d", "o", "h", "l", "c", "v"] as const).forEach((k) => (bars[k] as unknown[]).push(...p[k])));
      return { bars, kind };
    }
  }
  return null;
}
