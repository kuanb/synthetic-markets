// K/M/B/T number formatter. Raw integers like 82,000,000 are unreadable in a 32px cell.

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
