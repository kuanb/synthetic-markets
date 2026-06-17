// End-game summary overlay (win/loss): totals + per-year line charts from the player log.

import type { YearLog } from '../world/state';
import { formatNumber } from '../render/format';

function lineChart(
  title: string,
  log: YearLog[],
  pick: (l: YearLog) => number,
  color: string,
  tip: HTMLElement,
): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 420;
  c.height = 120;
  c.style.width = '100%';
  c.style.maxWidth = '420px';
  c.style.display = 'block';
  c.style.margin = '6px 0';
  c.style.cursor = 'crosshair';
  const ctx = c.getContext('2d')!;
  const vals = log.map(pick);
  const max = Math.max(1, ...vals);
  const n = vals.length;

  const xOf = (i: number) => (n > 1 ? (i / (n - 1)) * (c.width - 8) + 4 : 4);
  const yOf = (v: number) => c.height - 16 - (v / max) * (c.height - 24);

  function draw(hoverIdx?: number): void {
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    vals.forEach((v, i) => {
      const x = xOf(i);
      const y = yOf(v);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    if (hoverIdx !== undefined && hoverIdx >= 0 && hoverIdx < n) {
      const x = xOf(hoverIdx);
      const y = yOf(vals[hoverIdx]);
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 14);
      ctx.lineTo(x + 0.5, c.height);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#888';
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${title} (peak ${formatNumber(max)})`, 6, 12);
  }

  draw();

  c.addEventListener('mousemove', (ev) => {
    if (n === 0) return;
    const rect = c.getBoundingClientRect();
    // map screen x -> canvas-internal x (the canvas is CSS-scaled to the container width)
    const cx = ((ev.clientX - rect.left) * c.width) / Math.max(1, rect.width);
    const i = n > 1 ? Math.round(((cx - 4) / (c.width - 8)) * (n - 1)) : 0;
    const idx = Math.max(0, Math.min(n - 1, i));
    draw(idx);
    tip.innerHTML = `${title}<br/>yr <b>${log[idx].year}</b> \u00b7 <b>${formatNumber(vals[idx])}</b>`;
    tip.style.display = 'block';
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let left = ev.clientX + 12;
    let top = ev.clientY + 12;
    if (left + tw > window.innerWidth) left = ev.clientX - tw - 12;
    if (top + th > window.innerHeight) top = ev.clientY - th - 12;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${Math.max(0, top)}px`;
  });
  c.addEventListener('mouseleave', () => {
    tip.style.display = 'none';
    draw();
  });

  return c;
}

export function showSummary(root: HTMLElement, outcome: 'win' | 'loss', log: YearLog[]): void {
  const totalBorn = log.reduce((a, l) => a + l.born, 0);
  const totalDead = log.reduce((a, l) => a + l.died, 0);
  const totalFood = log.reduce((a, l) => a + l.food, 0);
  const totalGoods = log.reduce((a, l) => a + l.goods, 0);
  const peakPop = log.reduce((a, l) => Math.max(a, l.population), 0);
  const finalYear = log.length ? log[log.length - 1].year : 0;
  const peakWealthConc = log.reduce((a, l) => Math.max(a, l.wealthConcentration ?? 0), 0);
  const finalWealthConc = log.length ? (log[log.length - 1].wealthConcentration ?? 0) : 0;

  const overlay = document.createElement('div');
  overlay.setAttribute('data-sm-overlay', '');
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
    <div style="margin:0 0 14px;padding:10px 12px;border:1px solid #5a3a3a;border-radius:5px;
      background:#1a0f0f">
      <div style="color:#e6a06f;font-size:11px;letter-spacing:.08em;text-transform:uppercase">
        Wealth concentration</div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:3px">
        <span style="font-size:20px;font-weight:600;color:#fff">${peakWealthConc.toFixed(0)}%</span>
        <span style="color:#9aa;font-size:12px">peak \u00b7 ${finalWealthConc.toFixed(0)}% final</span>
      </div>
      <div style="color:#7d8590;font-size:11px;margin-top:4px">Food-land the densest 10% of the
        population required, as a share of total capacity. Higher = more unbalanced.</div>
    </div>
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
  // Shared hover tooltip for the mini-charts (fixed-position so it isn't clipped by the card).
  const tip = document.createElement('div');
  tip.setAttribute('data-sm-overlay', '');
  tip.style.cssText = `position:fixed;pointer-events:none;z-index:60;display:none;
    background:rgba(8,8,8,0.96);border:1px solid #333;border-radius:4px;padding:4px 7px;
    font:11px ui-monospace,Menlo,monospace;color:#ddd;line-height:1.45;white-space:nowrap;
    box-shadow:0 2px 10px rgba(0,0,0,0.6);`;
  document.body.appendChild(tip);

  card.appendChild(lineChart('Population', log, (l) => l.population, '#6fd9d9', tip));
  card.appendChild(lineChart('Born / yr', log, (l) => l.born, '#6fd98a', tip));
  card.appendChild(lineChart('Died / yr', log, (l) => l.died, '#d96f6f', tip));
  card.appendChild(lineChart('Capital Wealth', log, (l) => l.capitalWealth, '#d9c46f', tip));
  card.appendChild(
    lineChart('Wealth concentration %', log, (l) => l.wealthConcentration ?? 0, '#e6a06f', tip),
  );

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
