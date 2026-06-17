// Sidebar: view-mode toggle, zoom, two policy sliders, burst spend, years slider, End Turn,
// and live player stats. Acts only on the player market.

import type { Snapshot } from '../render/snapshot';
import type { ViewMode } from '../render/canvas';
import { formatNumber } from '../render/format';
import { CONFIG } from '../config';

export interface SidebarCallbacks {
  onPolicyChange(p: { laborToFoodFrac: number; rawToResearchFrac: number }): void;
  onViewMode(m: ViewMode): void;
  onBurstSpend(): void;
  onEndTurn(years: number): void;
  onZoom(z: 1 | 2): void;
}

const css = `
.sm-sidebar { width: 26%; min-width: 300px; max-width: 420px; height: 100%; overflow-y: auto;
  background: #060606; border-left: 1px solid #222; padding: 14px 16px; font-size: 13px; }
@media (orientation: portrait) { .sm-sidebar { width: 100%; max-width: none; height: 45%;
  border-left: none; border-top: 1px solid #222; } }
.sm-sidebar h1 { font-size: 15px; letter-spacing: .14em; margin: 0 0 12px; font-weight: 600; }
.sm-sec { margin: 14px 0; padding-top: 10px; border-top: 1px solid #161616; }
.sm-row { display: flex; justify-content: space-between; gap: 8px; margin: 3px 0; }
.sm-row span:last-child { color: #fff; }
.sm-row span:first-child { color: #888; }
.sm-btns { display: flex; gap: 6px; flex-wrap: wrap; }
.sm-btn { flex: 1; min-width: 64px; background: #111; color: #ccc; border: 1px solid #2a2a2a;
  padding: 7px 6px; cursor: pointer; font: inherit; border-radius: 3px; }
.sm-btn.active { background: #1d3a4d; color: #fff; border-color: #2f6e92; }
.sm-btn:hover { border-color: #3a3a3a; }
.sm-end { width: 100%; background: #1d4d2a; color: #fff; border: 1px solid #2f9250; padding: 11px;
  font: inherit; font-weight: 600; cursor: pointer; border-radius: 3px; margin-top: 6px; letter-spacing: .05em; }
.sm-end:hover { background: #246034; }
.sm-burst { width: 100%; background: #4d3a1d; color: #fff; border: 1px solid #92702f; padding: 9px;
  font: inherit; cursor: pointer; border-radius: 3px; }
.sm-burst:hover { background: #604a24; }
.sm-slider { width: 100%; margin: 4px 0 2px; }
.sm-lbl { color: #888; font-size: 12px; }
.sm-lbl b { color: #cfe; font-weight: 600; }
.sm-ends { font-size: 11px; color: #666; display: flex; justify-content: space-between; }
`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  html?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export function mountSidebar(
  root: HTMLElement,
  cb: SidebarCallbacks,
): { update(snap: Snapshot): void } {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  root.className = 'sm-sidebar';
  root.innerHTML = '';
  root.appendChild(el('h1', undefined, 'SYNTHETIC MARKETS'));

  // view mode + zoom
  const viewSec = el('div', 'sm-sec');
  viewSec.appendChild(el('div', 'sm-lbl', 'View'));
  const viewBtns = el('div', 'sm-btns');
  const modes: ViewMode[] = ['peoples', 'food', 'raw'];
  const modeLabels = ['Peoples', 'Food', 'Raw'];
  const modeButtons: HTMLButtonElement[] = [];
  modes.forEach((m, i) => {
    const b = el('button', 'sm-btn' + (i === 0 ? ' active' : ''), modeLabels[i]);
    b.onclick = () => {
      modeButtons.forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      cb.onViewMode(m);
    };
    modeButtons.push(b);
    viewBtns.appendChild(b);
  });
  viewSec.appendChild(viewBtns);
  const zoomBtns = el('div', 'sm-btns');
  zoomBtns.style.marginTop = '6px';
  ([1, 2] as const).forEach((z) => {
    const b = el('button', 'sm-btn' + (z === 1 ? ' active' : ''), `Zoom ${z}\u00d7`);
    b.onclick = () => {
      [...zoomBtns.children].forEach((x) => (x as HTMLElement).classList.remove('active'));
      b.classList.add('active');
      cb.onZoom(z);
    };
    zoomBtns.appendChild(b);
  });
  viewSec.appendChild(zoomBtns);
  root.appendChild(viewSec);

  // policy sliders
  const polSec = el('div', 'sm-sec');
  polSec.appendChild(el('div', 'sm-lbl', 'Policy (applies to every batched year)'));

  let laborFrac: number = CONFIG.LABOR_TO_FOOD_DEFAULT;
  let researchFrac: number = CONFIG.RAW_TO_RESEARCH_DEFAULT;

  const laborLbl = el('div', 'sm-lbl');
  const laborSlider = el('input', 'sm-slider');
  laborSlider.type = 'range';
  laborSlider.min = '0';
  laborSlider.max = '100';
  laborSlider.value = String(laborFrac * 100);
  const researchLbl = el('div', 'sm-lbl');
  const researchSlider = el('input', 'sm-slider');
  researchSlider.type = 'range';
  researchSlider.min = '0';
  researchSlider.max = '100';
  researchSlider.value = String(researchFrac * 100);

  const renderPolLabels = () => {
    laborLbl.innerHTML = `Labor: <b>${Math.round(laborFrac * 100)}% food</b> / ${Math.round(
      (1 - laborFrac) * 100,
    )}% raw`;
    researchLbl.innerHTML = `Raw: <b>${Math.round(researchFrac * 100)}% research</b> / ${Math.round(
      (1 - researchFrac) * 100,
    )}% market`;
  };
  renderPolLabels();
  const emitPolicy = () =>
    cb.onPolicyChange({ laborToFoodFrac: laborFrac, rawToResearchFrac: researchFrac });
  laborSlider.oninput = () => {
    laborFrac = Number(laborSlider.value) / 100;
    renderPolLabels();
    emitPolicy();
  };
  researchSlider.oninput = () => {
    researchFrac = Number(researchSlider.value) / 100;
    renderPolLabels();
    emitPolicy();
  };
  polSec.appendChild(laborLbl);
  polSec.appendChild(laborSlider);
  polSec.appendChild(researchLbl);
  polSec.appendChild(researchSlider);
  root.appendChild(polSec);

  // burst + years + end turn
  const turnSec = el('div', 'sm-sec');
  const burstBtn = el('button', 'sm-burst', 'Burst Spend');
  burstBtn.onclick = () => cb.onBurstSpend();
  turnSec.appendChild(burstBtn);

  let years: number = CONFIG.DEFAULT_YEARS_PER_TURN;
  const yearsLbl = el('div', 'sm-lbl');
  yearsLbl.style.marginTop = '10px';
  const yearsSlider = el('input', 'sm-slider');
  yearsSlider.type = 'range';
  yearsSlider.min = '1';
  yearsSlider.max = String(CONFIG.MAX_YEARS_PER_TURN);
  yearsSlider.value = String(years);
  const renderYears = () => (yearsLbl.innerHTML = `Years per turn: <b>${years}</b>`);
  renderYears();
  yearsSlider.oninput = () => {
    years = Number(yearsSlider.value);
    renderYears();
  };
  turnSec.appendChild(yearsLbl);
  turnSec.appendChild(yearsSlider);

  const endBtn = el('button', 'sm-end', 'END TURN');
  endBtn.onclick = () => cb.onEndTurn(years);
  turnSec.appendChild(endBtn);
  root.appendChild(turnSec);

  // stats
  const statSec = el('div', 'sm-sec');
  statSec.appendChild(el('div', 'sm-lbl', 'Player market'));
  const stats = el('div');
  statSec.appendChild(stats);
  root.appendChild(statSec);

  const rowsSpec: Array<[string, (s: Snapshot) => string]> = [
    ['Year', (s) => String(s.year)],
    ['Technology', (s) => s.markets[0].techName],
    [
      'Research',
      (s) =>
        s.markets[0].researchCostNext > 0
          ? `${formatNumber(s.markets[0].techProgress)} / ${formatNumber(
              s.markets[0].researchCostNext,
            )} \u2192 ${s.markets[0].nextTechName}`
          : 'max',
    ],
    ['Population', (s) => formatNumber(s.markets[0].population)],
    ['Deaths (cumulative)', (s) => formatNumber(s.markets[0].cumulativeDead)],
    ['Deaths (this year)', (s) => formatNumber(s.markets[0].diedThisYear)],
    ['Market size', (s) => `${formatNumber(s.markets[0].cells)} cells`],
    ['Capital Wealth', (s) => formatNumber(s.markets[0].capitalWealth)],
    ['Goods / cycle', (s) => formatNumber(s.markets[0].goodsProduced)],
    [
      'Consumed / capita',
      (s) =>
        s.markets[0].population > 0
          ? formatNumber(s.markets[0].goodsConsumed / s.markets[0].population)
          : '0',
    ],
    ['Orientation', (s) => s.markets[0].orientation.toFixed(2)],
  ];

  return {
    update(snap: Snapshot) {
      stats.innerHTML = rowsSpec
        .map(
          ([label, fn]) =>
            `<div class="sm-row"><span>${label}</span><span>${fn(snap)}</span></div>`,
        )
        .join('');
    },
  };
}
