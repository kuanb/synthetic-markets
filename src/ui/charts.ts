// Live per-turn mini line-charts for the player market, plotting per-year history since epoch.
//
// X-axis windowing:
//  - Always shows a window of AT LEAST 100 years (early game: the right side is mostly empty).
//  - The visible span grows up to 1000 years as time passes (whole history compressed to fit).
//  - Once history exceeds 1000 years, each chart becomes a horizontally SCROLLABLE 1000-year
//    window the user can scroll back through; on each new turn it auto-scrolls fully RIGHT.

import type { YearLog } from '../world/state';
import { formatNumber } from '../render/format';

const MIN_WINDOW = 100;
const MAX_WINDOW = 1000;
const CHART_H = 46;

interface ChartDef {
  label: string;
  color: string;
  pick: (l: YearLog) => number;
}

const DEFS: ChartDef[] = [
  { label: 'Population', color: '#6fd9d9', pick: (l) => l.population },
  { label: 'Raw mined / yr', color: '#d9a86f', pick: (l) => l.rawMined },
  { label: 'Food produced / yr', color: '#6fd98a', pick: (l) => l.food },
  { label: 'Market goods / yr', color: '#d9c46f', pick: (l) => l.goods },
  { label: 'Tech invested / yr', color: '#9a6fd9', pick: (l) => l.techInvested },
];

const css = `
.sm-chart { margin-top: 10px; }
.sm-chart-lbl { display: flex; justify-content: space-between; color: #9aa; font-size: 11px; margin-bottom: 2px; }
.sm-chart-lbl b { color: #fff; font-weight: 600; }
.sm-chart-scroll { width: 100%; overflow-x: auto; overflow-y: hidden; background: #0a0a0a;
  border: 1px solid #1c1c1c; border-radius: 4px; }
.sm-chart-scroll canvas { display: block; height: ${CHART_H}px; }
`;

export function mountCharts(root: HTMLElement): { update(log: YearLog[]): void } {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  interface ChartEls {
    def: ChartDef;
    peak: HTMLElement;
    scroll: HTMLDivElement;
    canvas: HTMLCanvasElement;
  }
  const charts: ChartEls[] = DEFS.map((def) => {
    const wrap = document.createElement('div');
    wrap.className = 'sm-chart';
    const lbl = document.createElement('div');
    lbl.className = 'sm-chart-lbl';
    const name = document.createElement('span');
    name.textContent = def.label;
    const peak = document.createElement('span');
    lbl.appendChild(name);
    lbl.appendChild(peak);
    const scroll = document.createElement('div');
    scroll.className = 'sm-chart-scroll';
    const canvas = document.createElement('canvas');
    scroll.appendChild(canvas);
    wrap.appendChild(lbl);
    wrap.appendChild(scroll);
    root.appendChild(wrap);
    return { def, peak, scroll, canvas };
  });

  function drawChart(c: ChartEls, log: YearLog[]): void {
    const total = log.length;
    const outerW = Math.max(120, c.scroll.clientWidth || 320);
    const ctx = c.canvas.getContext('2d')!;

    // window mapping
    let canvasW: number;
    let pxPerYear: number;
    let scrollable: boolean;
    if (total <= MAX_WINDOW) {
      // whole history fits; x-axis spans at least MIN_WINDOW years (empty right early on)
      canvasW = outerW;
      pxPerYear = outerW / Math.max(MIN_WINDOW, total);
      scrollable = false;
    } else {
      // fixed 1000-year visible window, scroll back to inspect the past
      pxPerYear = outerW / MAX_WINDOW;
      canvasW = total * pxPerYear;
      scrollable = true;
    }
    c.canvas.width = Math.max(1, Math.round(canvasW));
    c.canvas.height = CHART_H;

    ctx.clearRect(0, 0, c.canvas.width, CHART_H);

    let max = 1;
    for (const l of log) {
      const v = c.def.pick(l);
      if (v > max) max = v;
    }
    c.peak.innerHTML = `peak <b>${formatNumber(max)}</b>`;

    if (total > 0) {
      ctx.strokeStyle = c.def.color;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      for (let i = 0; i < total; i++) {
        const x = i * pxPerYear;
        const v = c.def.pick(log[i]);
        const y = CHART_H - 3 - (v / max) * (CHART_H - 10);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // auto-scroll to the latest data on the right
    if (scrollable) c.scroll.scrollLeft = c.canvas.width;
  }

  return {
    update(log: YearLog[]) {
      for (const c of charts) drawChart(c, log);
    },
  };
}
