// End-game summary overlay (win/loss): totals + per-year line charts from the player log.

import type { YearLog } from '../world/state';
import { formatNumber } from '../render/format';

function lineChart(
  title: string,
  log: YearLog[],
  pick: (l: YearLog) => number,
  color: string,
): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 420;
  c.height = 120;
  c.style.width = '100%';
  c.style.maxWidth = '420px';
  c.style.display = 'block';
  c.style.margin = '6px 0';
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, c.width, c.height);
  const vals = log.map(pick);
  const max = Math.max(1, ...vals);
  const n = vals.length;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  vals.forEach((v, i) => {
    const x = n > 1 ? (i / (n - 1)) * (c.width - 8) + 4 : 4;
    const y = c.height - 16 - (v / max) * (c.height - 24);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.fillStyle = '#888';
  ctx.font = '11px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`${title} (peak ${formatNumber(max)})`, 6, 12);
  return c;
}

export function showSummary(root: HTMLElement, outcome: 'win' | 'loss', log: YearLog[]): void {
  const totalBorn = log.reduce((a, l) => a + l.born, 0);
  const totalDead = log.reduce((a, l) => a + l.died, 0);
  const totalFood = log.reduce((a, l) => a + l.food, 0);
  const totalGoods = log.reduce((a, l) => a + l.goods, 0);
  const peakPop = log.reduce((a, l) => Math.max(a, l.population), 0);
  const finalYear = log.length ? log[log.length - 1].year : 0;

  const overlay = document.createElement('div');
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:50;
    display:flex;align-items:center;justify-content:center;padding:20px;overflow:auto;`;
  const card = document.createElement('div');
  card.style.cssText = `max-width:480px;width:100%;border:1px solid #333;background:#080808;
    padding:24px;border-radius:6px;font-family:ui-monospace,monospace;color:#ccc;`;
  const win = outcome === 'win';
  card.innerHTML = `
    <h1 style="margin:0 0 4px;letter-spacing:.1em;color:${win ? '#6fd98a' : '#d96f6f'}">
      ${win ? 'CIVILIZATION COMPLETE' : 'CIVILIZATION COLLAPSED'}</h1>
    <div style="color:#777;margin-bottom:14px">${
      win ? 'You researched every technology.' : 'Your market reached zero.'
    } Year ${finalYear}.</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 16px;font-size:13px">
      <div style="display:flex;justify-content:space-between"><span style="color:#888">Peak population</span><b>${formatNumber(
        peakPop,
      )}</b></div>
      <div style="display:flex;justify-content:space-between"><span style="color:#888">Years elapsed</span><b>${formatNumber(
        finalYear,
      )}</b></div>
      <div style="display:flex;justify-content:space-between"><span style="color:#888">Total born</span><b>${formatNumber(
        totalBorn,
      )}</b></div>
      <div style="display:flex;justify-content:space-between"><span style="color:#888">Total died</span><b>${formatNumber(
        totalDead,
      )}</b></div>
      <div style="display:flex;justify-content:space-between"><span style="color:#888">Total food</span><b>${formatNumber(
        totalFood,
      )}</b></div>
      <div style="display:flex;justify-content:space-between"><span style="color:#888">Total goods</span><b>${formatNumber(
        totalGoods,
      )}</b></div>
    </div>
  `;
  card.appendChild(lineChart('Population', log, (l) => l.population, '#6fd9d9'));
  card.appendChild(lineChart('Born / yr', log, (l) => l.born, '#6fd98a'));
  card.appendChild(lineChart('Died / yr', log, (l) => l.died, '#d96f6f'));
  card.appendChild(lineChart('Capital Wealth', log, (l) => l.capitalWealth, '#d9c46f'));

  const again = document.createElement('button');
  again.textContent = 'New World';
  again.style.cssText = `margin-top:16px;width:100%;padding:11px;background:#1d3a4d;color:#fff;
    border:1px solid #2f6e92;border-radius:3px;font:inherit;cursor:pointer;`;
  again.onclick = () => {
    localStorage.removeItem('SYNTH_MARKETS_SAVE');
    location.reload();
  };
  card.appendChild(again);
  overlay.appendChild(card);
  root.appendChild(overlay);
}
