// Live per-turn mini line-charts for the player market, plotting per-year history since epoch.
//
// X-axis windowing:
//  - Always shows a window of AT LEAST 100 years (early game: the right side is mostly empty).
//  - The visible span grows up to 1000 years as time passes (whole history compressed to fit).
//  - Once history exceeds 1000 years we plot ONLY the trailing 1000 years and hide older data
//    (no horizontal scrollbar — it disrupted the overlay layout).
//
// A chart can overlay multiple series on a SHARED y-scale (e.g. wealth concentration and the
// starvation index, both percentages) so two same-scale metrics can be compared directly.
//
// Each chart's label reports `now` (latest year), `avg10` (trailing 10-year mean) and `peak`
// (all-time max over the full history). Multi-series charts show one colored chip per series.
// Hovering a chart shows a crosshair + tooltip with the exact year and value(s) under the cursor.

import type { YearLog } from '../world/state';
import { formatNumber } from '../render/format';

const MIN_WINDOW = 100;
const MAX_WINDOW = 1000;
const CHART_H = 46;
const TRAIL_AVG = 10; // trailing-average window (years)

interface Series {
  name: string; // full name (legend / tooltip)
  short: string; // compact name (stats chip)
  color: string;
  pick: (l: YearLog) => number;
}

interface ChartDef {
  label: string;
  series: Series[]; // 1+ overlaid lines sharing the y-scale
  fmt?: (v: number) => string; // value formatter (default formatNumber)
}

const s = (name: string, short: string, color: string, pick: (l: YearLog) => number): Series => ({
  name,
  short,
  color,
  pick,
});
const DEFS: ChartDef[] = [
  { label: 'Population', series: [s('Population', 'Population', '#6fd9d9', (l) => l.population)] },
  { label: 'Raw mined / yr', series: [s('Raw mined', 'Raw', '#d9a86f', (l) => l.rawMined)] },
  { label: 'Food produced / yr', series: [s('Food produced', 'Food', '#6fd98a', (l) => l.food)] },
  { label: 'Market goods / yr', series: [s('Market goods', 'Goods', '#d9c46f', (l) => l.goods)] },
  {
    label: 'Tech invested / yr',
    series: [s('Tech invested', 'Tech', '#9a6fd9', (l) => l.techInvested)],
  },
  {
    // Social Stability (0..100): the new composite of wealth concentration, food insecurity and
    // tech disruption that drives labor efficiency + market coverage (see sim/stability.ts).
    label: 'Social stability',
    fmt: (v) => `${Math.round(v)}`,
    series: [s('Social stability', 'Stability', '#6fd99a', (l) => l.socialStability ?? 100)],
  },
];

const css = `
.sm-chart { margin-top: 10px; }
.sm-chart-lbl { display: flex; justify-content: space-between; gap: 6px; color: #9aa; font-size: 11px; margin-bottom: 2px; }
.sm-chart-lbl .sm-chart-name { color: #9aa; white-space: nowrap; }
.sm-chart-lbl .sm-chart-stats { color: #788; text-align: right; }
.sm-chart-lbl b { color: #fff; font-weight: 600; }
.sm-chart-plot { width: 100%; overflow: hidden; background: #0a0a0a;
  border: 1px solid #1c1c1c; border-radius: 4px; }
.sm-chart-plot canvas { display: block; width: 100%; height: ${CHART_H}px; cursor: crosshair; }
.sm-chart-tip { position: fixed; pointer-events: none; z-index: 40; display: none;
  background: rgba(8,8,8,0.96); border: 1px solid #333; border-radius: 4px; padding: 4px 7px;
  font: 11px ui-monospace, Menlo, monospace; color: #ddd; line-height: 1.45; white-space: nowrap;
  box-shadow: 0 2px 10px rgba(0,0,0,0.6); }
.sm-chart-tip b { color: #fff; }
`;

export function mountCharts(root: HTMLElement): { update(log: YearLog[]): void } {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // One shared tooltip (fixed-position, on body) so it is never clipped by the overlay panel.
  const tip = document.createElement('div');
  tip.className = 'sm-chart-tip';
  document.body.appendChild(tip);

  interface ChartEls {
    def: ChartDef;
    stats: HTMLElement;
    canvas: HTMLCanvasElement;
    // last-drawn layout (for hover mapping + crosshair redraw)
    log: YearLog[];
    start: number; // first visible log index
    pxPerYear: number;
    windowMax: number; // max over the VISIBLE window across all series (drives y-axis scaling)
  }

  const charts: ChartEls[] = DEFS.map((def) => {
    const wrap = document.createElement('div');
    wrap.className = 'sm-chart';
    const lbl = document.createElement('div');
    lbl.className = 'sm-chart-lbl';
    const name = document.createElement('span');
    name.className = 'sm-chart-name';
    name.textContent = def.label;
    const stats = document.createElement('span');
    stats.className = 'sm-chart-stats';
    lbl.appendChild(name);
    lbl.appendChild(stats);
    const plot = document.createElement('div');
    plot.className = 'sm-chart-plot';
    const canvas = document.createElement('canvas');
    plot.appendChild(canvas);
    wrap.appendChild(lbl);
    wrap.appendChild(plot);
    root.appendChild(wrap);

    const c: ChartEls = {
      def,
      stats,
      canvas,
      log: [],
      start: 0,
      pxPerYear: 1,
      windowMax: 1,
    };

    // Hover -> crosshair + tooltip with the exact year/value(s) under the cursor.
    const onMove = (ev: MouseEvent) => {
      const total = c.log.length;
      if (total === 0) {
        tip.style.display = 'none';
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const localX = ev.clientX - rect.left;
      const visIdx = Math.round(localX / c.pxPerYear);
      const i = Math.max(c.start, Math.min(total - 1, c.start + visIdx));
      const entry = c.log[i];
      const fmt = c.def.fmt ?? formatNumber;
      draw(c, i); // redraw with crosshair at i
      let html = `yr <b>${entry.year}</b>`;
      for (const sd of c.def.series) {
        html += `<br/><span style="color:${sd.color}">${sd.name}</span> <b>${fmt(sd.pick(entry))}</b>`;
      }
      tip.innerHTML = html;
      tip.style.display = 'block';
      const tw = tip.offsetWidth;
      const th = tip.offsetHeight;
      let left = ev.clientX + 12;
      let top = ev.clientY + 12;
      if (left + tw > window.innerWidth) left = ev.clientX - tw - 12;
      if (top + th > window.innerHeight) top = ev.clientY - th - 12;
      tip.style.left = `${Math.max(0, left)}px`;
      tip.style.top = `${Math.max(0, top)}px`;
    };
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', () => {
      tip.style.display = 'none';
      draw(c); // redraw without crosshair
    });

    return c;
  });

  // Render one chart. With a hoverIdx, overlays a vertical crosshair + a dot per series at that year.
  function draw(c: ChartEls, hoverIdx?: number): void {
    const log = c.log;
    const total = log.length;
    const ctx = c.canvas.getContext('2d')!;
    const cssW = Math.max(120, c.canvas.clientWidth || 300);
    c.canvas.width = cssW; // 1:1 with CSS px (canvas stretches to 100% width)
    c.canvas.height = CHART_H;

    ctx.clearRect(0, 0, cssW, CHART_H);
    if (total === 0) return;

    // Plot only the trailing MAX_WINDOW years; early on, span at least MIN_WINDOW so a handful of
    // points don't stretch across the whole width.
    const visibleCount = Math.min(total, MAX_WINDOW);
    const start = total - visibleCount;
    const span = Math.max(MIN_WINDOW, visibleCount);
    const pxPerYear = cssW / span;

    // Shared y-scale: the max over the visible window across EVERY series on this chart.
    let windowMax = 1;
    for (let i = start; i < total; i++) {
      for (const sd of c.def.series) {
        const v = sd.pick(log[i]);
        if (v > windowMax) windowMax = v;
      }
    }

    c.start = start;
    c.pxPerYear = pxPerYear;
    c.windowMax = windowMax;

    const yOf = (v: number) => CHART_H - 3 - (v / windowMax) * (CHART_H - 10);
    const xOf = (i: number) => (i - start) * pxPerYear;

    for (const sd of c.def.series) {
      ctx.strokeStyle = sd.color;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      for (let i = start; i < total; i++) {
        const x = xOf(i);
        const y = yOf(sd.pick(log[i]));
        if (i === start) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    if (hoverIdx !== undefined && hoverIdx >= start && hoverIdx < total) {
      const x = xOf(hoverIdx);
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, CHART_H);
      ctx.stroke();
      for (const sd of c.def.series) {
        ctx.fillStyle = sd.color;
        ctx.beginPath();
        ctx.arc(x, yOf(sd.pick(log[hoverIdx])), 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function updateStats(c: ChartEls): void {
    const log = c.log;
    const total = log.length;
    if (total === 0) {
      c.stats.innerHTML = '';
      return;
    }
    const fmt = c.def.fmt ?? formatNumber;
    if (c.def.series.length === 1) {
      const sd = c.def.series[0];
      const now = sd.pick(log[total - 1]);
      const n = Math.min(TRAIL_AVG, total);
      let sum = 0;
      let peak = 0;
      for (let i = 0; i < total; i++) {
        const v = sd.pick(log[i]);
        if (v > peak) peak = v;
        if (i >= total - n) sum += v;
      }
      c.stats.innerHTML =
        `now <b>${fmt(now)}</b> \u00b7 avg10 <b>${fmt(sum / n)}</b> ` +
        `\u00b7 peak <b>${fmt(peak)}</b>`;
      return;
    }
    // Multi-series: one colored chip per series (now + all-time peak) — the chips double as a legend.
    c.stats.innerHTML = c.def.series
      .map((sd) => {
        const now = sd.pick(log[total - 1]);
        let peak = 0;
        for (let i = 0; i < total; i++) peak = Math.max(peak, sd.pick(log[i]));
        return `<span style="color:${sd.color}">${sd.short} <b>${fmt(now)}</b>\u00b7pk <b>${fmt(peak)}</b></span>`;
      })
      .join(' \u00b7 ');
  }

  return {
    update(log: YearLog[]) {
      for (const c of charts) {
        c.log = log;
        draw(c);
        updateStats(c);
      }
    },
  };
}
