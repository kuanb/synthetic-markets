// Sidebar: view-mode toggle + Policy section (Labor box, Raw-allocation box, Forced-intervention
// checkbox) + years-per-turn (3 options) + End Turn + live player stats. Player market only.
// Zoom lives on the map overlay (see main.ts), not here.

import type { Snapshot } from '../render/snapshot';
import { formatNumber } from '../render/format';
import { CONFIG } from '../config';

export interface PolicyInput {
  laborToFoodFrac: number;
  rawToMarketFrac: number;
  rawToTechFrac: number;
  rawToReserveFrac: number;
  forcedIntervention: boolean;
  famineTolerance: number;
  marketStimulus: boolean;
}

export interface SidebarCallbacks {
  onPolicyChange(p: PolicyInput): void;
  onEndTurn(years: number): void;
  onYearsChange(years: number): void;
  onAutoPlayChange(enabled: boolean): void;
  onRestart(): void;
  onOpenSettings(): void;
  onOpenHelp(): void;
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
.sm-grp { border: 1px solid #1f1f1f; border-radius: 5px; padding: 6px 9px 7px; margin: 8px 0; background: #0a0a0a; }
.sm-grp-h { color: #6f7a85; font-size: 10px; letter-spacing: .11em; text-transform: uppercase; margin: 1px 0 4px; }
.sm-btns { display: flex; gap: 6px; flex-wrap: wrap; }
.sm-btn { flex: 1; min-width: 56px; background: #111; color: #ccc; border: 1px solid #2a2a2a;
  padding: 7px 6px; cursor: pointer; font: inherit; border-radius: 3px; }
.sm-btn.active { background: #1d3a4d; color: #fff; border-color: #2f6e92; }
.sm-btn:hover { border-color: #3a3a3a; }
.sm-end { width: 100%; background: #1d3a4d; color: #fff; border: 1px solid #2f6e92; padding: 11px;
  font: inherit; font-weight: 600; cursor: pointer; border-radius: 3px; margin-top: 8px; letter-spacing: .05em; }
.sm-end:hover { background: #244a63; }
/* Turn-mechanic buttons use a burgundy palette, distinct from the blue selection highlights. */
.sm-turn { flex: 1; background: #5a2236; color: #fff; border: 1px solid #9a3a58; padding: 11px;
  font: inherit; font-weight: 600; cursor: pointer; border-radius: 3px; letter-spacing: .05em; }
.sm-turn:hover { background: #6e2a43; }
.sm-turn:disabled { opacity: .4; cursor: not-allowed; }
.sm-toggle { flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px;
  background: #1c0f14; color: #d6a9b6; border: 1px solid #7a3148; padding: 11px;
  font: inherit; font-weight: 600; cursor: pointer; border-radius: 3px; letter-spacing: .05em; }
.sm-toggle:hover { background: #271319; }
.sm-toggle.active { background: #6e2440; color: #fff; border-color: #b04668; }
.sm-switch { display: inline-block; width: 26px; height: 14px; border-radius: 8px; flex: none;
  background: #3a2228; border: 1px solid #8a3a52; position: relative; transition: background .15s; }
.sm-switch i { position: absolute; top: 1px; left: 1px; width: 10px; height: 10px; border-radius: 50%;
  background: #b97f8d; transition: left .15s, background .15s; }
.sm-toggle.active .sm-switch { background: #c44a6e; border-color: #d96f93; }
.sm-toggle.active .sm-switch i { left: 13px; background: #fff; }
.sm-slider { width: 100%; margin: 2px 0 2px; accent-color: #8a93a0; }
.sm-head { color: #9ab; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; margin-bottom: 8px; }
.sm-box { margin-top: 10px; padding: 10px; background: #0a0a0a; border: 1px solid #1c1c1c; border-radius: 4px; }
.sm-box-h { color: #8fa0b0; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; margin-bottom: 4px; }
.sm-alloc-lbl { display: flex; justify-content: space-between; color: #aab; font-size: 12px; margin-top: 6px; }
.sm-alloc-lbl span:last-child { color: #fff; font-weight: 600; }
.sm-check { display: flex; align-items: flex-start; gap: 8px; margin-top: 10px; padding: 9px;
  background: #0a0a0a; border: 1px solid #1c1c1c; border-radius: 4px; cursor: pointer; }
.sm-check input { margin-top: 2px; }
.sm-check.disabled { opacity: .45; }
.sm-check .t { color: #cdd6e0; font-weight: 600; font-size: 12px; }
.sm-check .sub { color: #7d8590; font-size: 11px; }
.sm-danger { width: 100%; background: #3a1d1d; color: #fff; border: 1px solid #7a2f2f; padding: 10px;
  font: inherit; cursor: pointer; border-radius: 3px; letter-spacing: .05em; }
.sm-danger:hover { background: #4d2424; }
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

// Set fracs[i] = newVal and rescale the others proportionally so the group always sums to 1.
function redistribute(fracs: number[], i: number, newVal: number): number[] {
  const v = Math.max(0, Math.min(1, newVal));
  const out = fracs.slice();
  out[i] = v;
  const remain = 1 - v;
  let otherSum = 0;
  for (let j = 0; j < fracs.length; j++) if (j !== i) otherSum += fracs[j];
  for (let j = 0; j < fracs.length; j++) {
    if (j === i) continue;
    out[j] = otherSum > 1e-9 ? (fracs[j] / otherSum) * remain : remain / (fracs.length - 1);
  }
  return out;
}

// A grouped box of sliders that always sum to 100%. Returns a setter to sync from a snapshot.
function makeAllocGroup(
  parent: HTMLElement,
  title: string,
  labels: string[],
  initial: number[],
  onChange: (fracs: number[]) => void,
): { set(f: number[]): void } {
  let fracs = initial.slice();
  const box = el('div', 'sm-box');
  box.appendChild(el('div', 'sm-box-h', title));
  const lblEls: HTMLDivElement[] = [];
  const sliders: HTMLInputElement[] = [];

  const renderLabels = () =>
    labels.forEach((lab, i) => {
      lblEls[i].innerHTML = `<span>${lab}</span><span>${Math.round(fracs[i] * 100)}%</span>`;
    });
  const renderSliders = () =>
    sliders.forEach((s, i) => (s.value = String(Math.round(fracs[i] * 100))));

  labels.forEach((lab, i) => {
    const l = el('div', 'sm-alloc-lbl');
    lblEls.push(l);
    box.appendChild(l);
    const sl = el('input', 'sm-slider');
    sl.type = 'range';
    sl.min = '0';
    sl.max = '100';
    sl.value = String(Math.round(initial[i] * 100));
    sl.oninput = () => {
      fracs = redistribute(fracs, i, Number(sl.value) / 100);
      renderLabels();
      renderSliders();
      onChange(fracs.slice());
    };
    sliders.push(sl);
    box.appendChild(sl);
    void lab;
  });
  renderLabels();
  parent.appendChild(box);

  return {
    set(f: number[]) {
      fracs = f.slice();
      renderLabels();
      renderSliders();
    },
  };
}

export function mountSidebar(
  root: HTMLElement,
  cb: SidebarCallbacks,
): { update(snap: Snapshot): void; setAutoPlay(on: boolean): void } {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  root.className = 'sm-sidebar';
  root.innerHTML = '';
  // Header row: title + a Settings gear in the sidebar's top-right (its natural home).
  const header = el('div');
  header.style.cssText =
    'display:flex;justify-content:space-between;align-items:center;margin:0 0 12px;';
  const title = el('h1', undefined, 'SYNTHETIC MARKETS');
  title.style.margin = '0';
  // Right-side button cluster: a How-to-Play help button (?) sits to the LEFT of the gear.
  const headBtns = el('div');
  headBtns.style.cssText = 'flex:0 0 auto;display:flex;gap:6px;align-items:center;';
  const iconBtnCss =
    'flex:0 0 auto;width:30px;height:30px;background:#111;color:#ccc;border:1px solid #2a2a2a;' +
    'border-radius:4px;font-size:16px;line-height:1;cursor:pointer;';
  const help = el('button', undefined, '?');
  help.title = 'How to play';
  help.style.cssText = iconBtnCss;
  help.onclick = () => cb.onOpenHelp();
  const gear = el('button', undefined, '\u2699');
  gear.title = 'Settings';
  gear.style.cssText = iconBtnCss;
  gear.onclick = () => cb.onOpenSettings();
  headBtns.appendChild(help);
  headBtns.appendChild(gear);
  header.appendChild(title);
  header.appendChild(headBtns);
  root.appendChild(header);
  // (View-mode selector now lives as a top-center overlay on the map, not in the sidebar.)

  // ----- Policy section: Labor box, Raw allocation box, Forced intervention -----
  const polSec = el('div', 'sm-sec');
  polSec.appendChild(el('div', 'sm-head', 'Policy \u00b7 applies to every batched year'));

  let laborFood: number = CONFIG.LABOR_TO_FOOD_DEFAULT;
  let rawMarket: number = CONFIG.RAW_TO_MARKET_DEFAULT;
  let rawTech: number = CONFIG.RAW_TO_TECH_DEFAULT;
  let rawReserve: number = CONFIG.RAW_RESERVE_DEFAULT;
  let forced = false;
  let famine: number = CONFIG.FAMINE_TOLERANCE_DEFAULT;
  let stimulus: boolean = CONFIG.MARKET_STIMULUS_DEFAULT;

  const emitPolicy = () =>
    cb.onPolicyChange({
      laborToFoodFrac: laborFood,
      rawToMarketFrac: rawMarket,
      rawToTechFrac: rawTech,
      rawToReserveFrac: rawReserve,
      forcedIntervention: forced,
      famineTolerance: famine,
      marketStimulus: stimulus,
    });

  // Labor: neutral, equal-weight (food vs mining), summing to 100%.
  const laborGroup = makeAllocGroup(
    polSec,
    'Labor \u00b7 worker allocation',
    ['Food production', 'Raw mining'],
    [laborFood, 1 - laborFood],
    (f) => {
      laborFood = f[0];
      emitPolicy();
    },
  );

  // Raw allocation: three-way disposition of minable raw, summing to 100%.
  const rawGroup = makeAllocGroup(
    polSec,
    'Raw materials allocation',
    ['Market (goods)', 'Tech (research)', 'Retain in reserves'],
    [rawMarket, rawTech, rawReserve],
    (f) => {
      rawMarket = f[0];
      rawTech = f[1];
      rawReserve = f[2];
      emitPolicy();
    },
  );

  // Forced intervention checkbox.
  const interv = el('label', 'sm-check');
  const intervBox = el('input');
  intervBox.type = 'checkbox';
  const intervText = el('div');
  const intervSub = el('div', 'sub');
  intervText.appendChild(el('div', 't', 'Forced Intervention \u2014 Market Expansion'));
  intervText.appendChild(intervSub);
  interv.appendChild(intervBox);
  interv.appendChild(intervText);
  intervBox.onchange = () => {
    forced = intervBox.checked;
    emitPolicy();
  };
  polSec.appendChild(interv);

  // Market Stimulus checkbox: spend banked goods to speed labor recovery after a tech shock.
  const stim = el('label', 'sm-check');
  const stimBox = el('input');
  stimBox.type = 'checkbox';
  const stimText = el('div');
  const stimSub = el('div', 'sub');
  stimText.appendChild(el('div', 't', 'Market Stimulus \u2014 Goods-Funded Recovery'));
  stimText.appendChild(stimSub);
  stim.appendChild(stimBox);
  stim.appendChild(stimText);
  stimBox.onchange = () => {
    stimulus = stimBox.checked;
    emitPolicy();
  };
  polSec.appendChild(stim);

  // Famine Tolerance: a single slider (not an alloc group). Subsistence (0) anchors people to
  // fed cells; Prospecting (1) lets them chase raw into starvation.
  const famineBox = el('div', 'sm-box');
  famineBox.appendChild(el('div', 'sm-box-h', 'Famine Tolerance'));
  const famineVal = el('div', 'sm-alloc-lbl');
  famineBox.appendChild(famineVal);
  const famineSlider = el('input', 'sm-slider');
  famineSlider.type = 'range';
  famineSlider.min = '0';
  famineSlider.max = '100';
  famineSlider.value = String(Math.round(famine * 100));
  const renderFamine = () => {
    famineVal.innerHTML = `<span>Risk famine for raw</span><span>${Math.round(famine * 100)}%</span>`;
  };
  famineSlider.oninput = () => {
    famine = Number(famineSlider.value) / 100;
    renderFamine();
    emitPolicy();
  };
  famineBox.appendChild(famineSlider);
  const famineCap = el('div');
  famineCap.style.cssText =
    'display:flex;justify-content:space-between;color:#7d8590;font-size:11px;margin-top:2px;';
  famineCap.innerHTML = '<span>Subsistence</span><span>Prospecting</span>';
  famineBox.appendChild(famineCap);
  renderFamine();
  polSec.appendChild(famineBox);

  root.appendChild(polSec);

  // ----- Turn: years (3 options) + End Turn -----
  const turnSec = el('div', 'sm-sec');
  turnSec.appendChild(el('div', 'sm-head', 'Years per turn'));
  let years: number = CONFIG.DEFAULT_YEARS_PER_TURN;
  // Segmented control: one connected track with a blue highlight that SLIDES over the selection.
  const yearOpts = CONFIG.YEARS_PER_TURN_OPTIONS;
  const segW = 100 / yearOpts.length;
  const yearWrap = el('div');
  yearWrap.style.cssText =
    'position:relative;display:flex;background:#0a0a0a;border:1px solid #2a2a2a;border-radius:4px;overflow:hidden;';
  const yearSlider = el('div');
  yearSlider.style.cssText =
    `position:absolute;top:0;bottom:0;left:0;width:${segW}%;background:#1d3a4d;` +
    'border:1px solid #2f6e92;border-radius:3px;box-sizing:border-box;' +
    'transition:left 0.18s ease;pointer-events:none;';
  yearWrap.appendChild(yearSlider);
  const yearSegs: HTMLButtonElement[] = [];
  const paintYears = () => {
    yearSegs.forEach((seg, i) => {
      seg.style.color = yearOpts[i] === years ? '#fff' : '#9aa';
    });
  };
  yearOpts.forEach((opt, idx) => {
    const seg = el('button', undefined, String(opt));
    seg.style.cssText =
      'position:relative;z-index:1;flex:1;background:none;border:none;padding:7px 6px;' +
      'cursor:pointer;font:inherit;';
    seg.onclick = () => {
      years = opt;
      yearSlider.style.left = `${idx * segW}%`;
      paintYears();
      cb.onYearsChange(years);
    };
    yearSegs.push(seg);
    yearWrap.appendChild(seg);
  });
  const defIdx = Math.max(
    0,
    yearOpts.findIndex((o) => o === years),
  );
  yearSlider.style.left = `${defIdx * segW}%`;
  paintYears();
  turnSec.appendChild(yearWrap);

  // End Turn + Auto-play share one row (equal halves). Burgundy palette so the turn mechanic reads
  // as distinct from the blue selection highlights (years-per-turn / zoom).
  const turnRow = el('div');
  turnRow.style.cssText = 'display:flex;gap:6px;margin-top:8px;';
  const endBtn = el('button', 'sm-turn', 'END TURN');
  endBtn.onclick = () => cb.onEndTurn(years);
  turnRow.appendChild(endBtn);

  // auto-play toggle: keep ending turns automatically until off / game over. A sliding on/off
  // switch makes its state obvious at a glance.
  let autoOn = false;
  const autoBtn = el('button', 'sm-toggle');
  autoBtn.appendChild(el('span', undefined, 'AUTO-PLAY'));
  const autoSwitch = el('span', 'sm-switch');
  autoSwitch.appendChild(el('i'));
  autoBtn.appendChild(autoSwitch);
  const renderAuto = () => {
    autoBtn.classList.toggle('active', autoOn);
    // End Turn is redundant (and would double-step) while auto-play runs — disable it (CSS greys it).
    endBtn.disabled = autoOn;
  };
  renderAuto();
  autoBtn.onclick = () => {
    autoOn = !autoOn;
    renderAuto();
    cb.onAutoPlayChange(autoOn);
  };
  turnRow.appendChild(autoBtn);
  turnSec.appendChild(turnRow);
  root.appendChild(turnSec);

  // ----- stats -----
  const statSec = el('div', 'sm-sec');
  statSec.appendChild(el('div', 'sm-head', 'Player market'));
  const stats = el('div');
  statSec.appendChild(stats);
  root.appendChild(statSec);

  // ----- game: force end / restart -----
  const gameSec = el('div', 'sm-sec');
  gameSec.appendChild(el('div', 'sm-head', 'Game'));
  const restartBtn = el('button', 'sm-danger', 'END GAME \u00b7 NEW WORLD');
  restartBtn.onclick = () => {
    if (confirm('End this game and start a new world? Current progress will be lost.')) {
      cb.onRestart();
    }
  };
  gameSec.appendChild(restartBtn);
  root.appendChild(gameSec);

  // Stats are grouped by theme so the eye can scan across rows within a bordered block
  // instead of one undifferentiated wall of key/value pairs.
  type Row = [string, (s: Snapshot) => string];
  const statGroups: Array<{ title: string; rows: Row[] }> = [
    {
      title: 'Status',
      rows: [
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
      ],
    },
    {
      title: 'Population & territory',
      rows: [
        ['Population', (s) => formatNumber(s.markets[0].population)],
        ['Market size', (s) => `${formatNumber(s.markets[0].cells)} cells`],
        ['Orientation', (s) => s.markets[0].orientation.toFixed(2)],
      ],
    },
    {
      title: 'Economy',
      rows: [
        ['Capital Wealth', (s) => formatNumber(s.markets[0].capitalWealth)],
        ['Reserves', (s) => formatNumber(s.markets[0].rawReserves)],
        ['Goods / cycle', (s) => formatNumber(s.markets[0].goodsProduced)],
        [
          'Stimulus / turn',
          (s) =>
            s.markets[0].stimulusSpentThisTurn > 0
              ? `${formatNumber(s.markets[0].stimulusSpentThisTurn)} (${Math.round(
                  s.markets[0].stimulusCoverageThisCycle * 100,
                )}% cov)`
              : '\u2014',
        ],
        [
          'Consumed / capita',
          (s) =>
            s.markets[0].population > 0
              ? formatNumber(s.markets[0].goodsConsumed / s.markets[0].population)
              : '0',
        ],
        ['Wealth concentration', (s) => `${s.markets[0].wealthConcentration.toFixed(0)}%`],
      ],
    },
    {
      // Social Stability system: stability drives labor efficiency + market coverage (see stability.ts)
      title: 'Society',
      rows: [
        ['Social stability', (s) => `${s.markets[0].socialStability.toFixed(0)} / 100`],
        ['Labor efficiency', (s) => `${(s.markets[0].laborEfficiency * 100).toFixed(0)}%`],
        ['Market coverage', (s) => `${(s.markets[0].marketCoverage * 100).toFixed(0)}%`],
      ],
    },
    {
      // yield efficiency: captured vs full land potential over owned cells (this cycle)
      title: 'Yield efficiency (cycle)',
      rows: [
        [
          'Food yield (cap/util)',
          (s) =>
            `${formatNumber(s.markets[0].foodCaptured)} / ${formatNumber(s.markets[0].foodPotential)}`,
        ],
        [
          'Food efficiency',
          (s) =>
            s.markets[0].foodPotential > 0
              ? `${((s.markets[0].foodCaptured / s.markets[0].foodPotential) * 100).toFixed(0)}%`
              : '0%',
        ],
        [
          'Raw yield (cap/util)',
          (s) =>
            `${formatNumber(s.markets[0].rawCaptured)} / ${formatNumber(s.markets[0].rawPotential)}`,
        ],
        [
          'Raw efficiency',
          (s) =>
            s.markets[0].rawPotential > 0
              ? `${((s.markets[0].rawCaptured / s.markets[0].rawPotential) * 100).toFixed(0)}%`
              : '0%',
        ],
      ],
    },
    {
      // supply vs demand this turn (totals across the batched years)
      title: 'Supply vs demand (turn)',
      rows: [
        [
          'Food req / produced',
          (s) =>
            `${formatNumber(s.markets[0].foodNeededThisTurn)} / ${formatNumber(
              s.markets[0].foodProducedThisTurn,
            )}`,
        ],
        [
          'Goods req / available',
          (s) =>
            `${formatNumber(s.markets[0].goodsNeededThisTurn)} / ${formatNumber(
              s.markets[0].goodsAvailableThisTurn,
            )}`,
        ],
      ],
    },
    {
      // deaths split by cause
      title: 'Deaths',
      rows: [
        [
          'Food (turn)',
          (s) => `${formatNumber(s.markets[0].foodDeathsThisTurn)} (\u03a3 ${formatNumber(
            s.markets[0].foodDeathsTotal,
          )})`,
        ],
        [
          'Goods (turn)',
          (s) => `${formatNumber(s.markets[0].goodsDeathsThisTurn)} (\u03a3 ${formatNumber(
            s.markets[0].goodsDeathsTotal,
          )})`,
        ],
        ['Total (turn)', (s) => formatNumber(s.markets[0].diedThisTurn)],
        ['Cumulative', (s) => formatNumber(s.markets[0].cumulativeDead)],
      ],
    },
  ];

  let syncedPolicy = false;

  return {
    update(snap: Snapshot) {
      const p = snap.markets[0];

      // Reflect authoritative policy once (esp. on a loaded save).
      if (!syncedPolicy) {
        laborFood = p.laborToFoodFrac;
        rawMarket = p.rawToMarketFrac;
        rawTech = p.rawToTechFrac;
        rawReserve = p.rawToReserveFrac;
        forced = p.forcedIntervention;
        famine = p.famineTolerance;
        stimulus = p.marketStimulus;
        laborGroup.set([laborFood, 1 - laborFood]);
        rawGroup.set([rawMarket, rawTech, rawReserve]);
        famineSlider.value = String(Math.round(famine * 100));
        renderFamine();
        syncedPolicy = true;
      }
      intervBox.checked = forced;
      stimBox.checked = stimulus;
      // Stimulus sub-text reflects whether labor is currently depressed (recovering) and the boost.
      if (p.laborEfficiency < 0.999 || p.stimulusCoverageThisCycle > 0) {
        const cov = Math.round(p.stimulusCoverageThisCycle * 100);
        stimSub.textContent = `Recovering \u2014 stimulus at ${cov}% coverage (spent ${formatNumber(
          p.stimulusSpentThisTurn,
        )} goods this turn) speeds labor back to full.`;
      } else {
        stimSub.textContent =
          'After a tech shock, spend banked goods (Capital Wealth) to re-mobilise labor up to 3\u00d7 faster. Idle while labor is at full.';
      }

      // Explain the tech-burst behavior + show pending status vs current reserves.
      if (p.pendingBurst) {
        const have = formatNumber(p.rawReserves);
        const need = formatNumber(p.pendingBurstCost);
        interv.classList.toggle('disabled', p.rawReserves < p.pendingBurstCost);
        intervSub.textContent = `BURST PENDING — needs ${need} reserves (have ${have}); fires when funded`;
      } else {
        interv.classList.toggle('disabled', false);
        intervSub.textContent =
          'On a new tech, spend 5\u00d7 the cycle\u2019s raw from reserves to burst-expand into fresh territory (banks if reserves are short).';
      }

      stats.innerHTML = statGroups
        .map(
          (g) =>
            `<div class="sm-grp"><div class="sm-grp-h">${g.title}</div>` +
            g.rows
              .map(
                ([label, fn]) =>
                  `<div class="sm-row"><span>${label}</span><span>${fn(snap)}</span></div>`,
              )
              .join('') +
            `</div>`,
        )
        .join('');
    },
    setAutoPlay(on: boolean) {
      autoOn = on;
      renderAuto();
    },
  };
}
