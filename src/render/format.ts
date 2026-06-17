// Number formatters.
// - formatNumber: readable K/M/B/T for the sidebar / tooltip ("82.0M").
// - formatCell: ultra-compact lowercase for in-cell text that must fit a 16-32px square
//   (max ~4 glyphs, minimal fractions): 359.23 -> "359", 1500 -> "1.5k", 1.154e8 -> "115m".

export function formatCell(n: number): string {
  if (!isFinite(n)) return '\u221e';
  const neg = n < 0;
  const a = Math.abs(n);
  let out: string;
  if (a === 0) {
    out = '0';
  } else if (a < 1) {
    out = a.toFixed(1).replace(/^0/, ''); // ".4"
    if (out === '.0') out = '0';
  } else if (a < 1000) {
    out = String(Math.round(a)); // up to 3 digits, no fractions
  } else {
    const units: Array<[number, string]> = [
      [1e12, 't'],
      [1e9, 'b'],
      [1e6, 'm'],
      [1e3, 'k'],
    ];
    out = a.toExponential(0);
    for (const [d, suf] of units) {
      if (a >= d) {
        const v = a / d;
        const s = (v < 10 ? v.toFixed(1) : String(Math.round(v))).replace(/\.0$/, '');
        out = s + suf;
        break;
      }
    }
  }
  return neg ? '-' + out : out;
}

export function formatNumber(n: number): string {
  if (!isFinite(n)) return '\u221e';
  const neg = n < 0;
  const abs = Math.abs(n);
  let out: string;
  if (abs < 1000) {
    out = abs < 10 && !Number.isInteger(abs) ? abs.toFixed(1) : String(Math.round(abs));
  } else if (abs < 1e6) {
    out = (abs / 1e3).toFixed(1) + 'K';
  } else if (abs < 1e9) {
    out = (abs / 1e6).toFixed(1) + 'M';
  } else if (abs < 1e12) {
    out = (abs / 1e9).toFixed(1) + 'B';
  } else if (abs < 1e15) {
    out = (abs / 1e12).toFixed(1) + 'T';
  } else {
    out = abs.toExponential(1);
  }
  return neg ? '-' + out : out;
}
