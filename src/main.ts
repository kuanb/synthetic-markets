// App bootstrap: spawn the sim worker, wire canvas + sidebar + input, route GAME_OVER.

import './style.css';
import { CONFIG } from './config';
import { draw, type ViewMode } from './render/canvas';
import {
  type Viewport,
  type ZoomLevel,
  screenToCell,
  centerOn,
  pan as panViewport,
  setZoom,
} from './render/viewport';
import { formatNumber } from './render/format';
import { mountSidebar } from './ui/sidebar';
import { mountCharts } from './ui/charts';
import { showSummary } from './ui/stats';
import { load, save, clear, type SerializedState } from './persistence';
import type { FromWorker, ToWorker } from './worker/protocol';
import type { Snapshot } from './render/snapshot';

const app = document.getElementById('app')!;
app.innerHTML = '';

const stage = document.createElement('div');
stage.style.cssText = 'position:relative;flex:1;min-width:0;min-height:0;';
const canvas = document.createElement('canvas');
canvas.style.cssText = 'display:block;width:100%;height:100%;';
stage.appendChild(canvas);
const sidebarRoot = document.createElement('div');
app.appendChild(stage);
app.appendChild(sidebarRoot);

const ctx = canvas.getContext('2d')!;

let viewport: Viewport = { camX: 0, camY: 0, zoom: 4 }; // start fully zoomed IN (32px cells)
let mode: ViewMode = 'peoples';
let snap: Snapshot | null = null;
let lastSaved: SerializedState | null = null;
let centered = false;

// auto-play loop state
let autoPlay = false;
let gameOver = false;
let pendingTick = false;
let years: number = CONFIG.DEFAULT_YEARS_PER_TURN;
let autoTimer: ReturnType<typeof setTimeout> | undefined;
const AUTO_DELAY_MS = 120;

// New-game settings (editable via the Settings modal). Initialized to the shipping defaults; only
// applied when a NEW game starts. `size` is a square board (N×N); market density is "1 market per
// N cells" (CELLS_PER_MARKET); population density is the wild-cell seed fraction.
const settings: { size: number; cellsPerMarket: number; wildDensity: number } = {
  size: Math.max(CONFIG.MAP_MIN_SIZE, CONFIG.WIDTH),
  cellsPerMarket: CONFIG.CELLS_PER_MARKET,
  wildDensity: CONFIG.WILD_CELL_DENSITY,
};
// Current world dimensions (updated on each new game); used as a pre-snapshot pan fallback.
let MAP_W = settings.size;
let MAP_H = settings.size;

const worker = new Worker(new URL('./worker/simWorker.ts', import.meta.url), {
  type: 'module',
});

function send(msg: ToWorker): void {
  worker.postMessage(msg);
}

function resize(): void {
  const r = stage.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(r.width));
  canvas.height = Math.max(1, Math.floor(r.height));
  redraw();
}

function redraw(): void {
  if (snap) draw(ctx, snap, viewport, mode);
}

function sendTick(): void {
  if (pendingTick || gameOver) return;
  pendingTick = true;
  send({ type: 'TICK', years });
}

function scheduleAuto(): void {
  if (!autoPlay || gameOver) return;
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => {
    if (autoPlay && !gameOver) sendTick();
  }, AUTO_DELAY_MS);
}

// Send an INIT for a brand-new world using the current Settings.
function sendInit(): void {
  MAP_W = settings.size;
  MAP_H = settings.size;
  const aiMarkets = Math.max(
    0,
    Math.floor((MAP_W * MAP_H) / Math.max(1, settings.cellsPerMarket)) - 1,
  );
  const seed = Math.floor(Math.random() * 1_000_000_000);
  send({
    type: 'INIT',
    seed,
    width: MAP_W,
    height: MAP_H,
    wildCellDensity: settings.wildDensity,
    aiMarkets,
  });
}

function startNewGame(): void {
  clear();
  lastSaved = null;
  centered = false;
  gameOver = false;
  pendingTick = false;
  lastEventCount = -1; // re-seed the Chronicle for the new world
  // drop any game-over summary overlay
  document.querySelectorAll('[data-sm-overlay]').forEach((n) => n.remove());
  sendInit();
}

// After an allocation change the worker logs a (coalesced) policy event but does not snapshot on
// its own; request a refreshed snapshot once the user settles (debounced) so the Chronicle updates
// without rebuilding a snapshot on every slider drag step.
let policySnapTimer: ReturnType<typeof setTimeout> | undefined;
const sidebar = mountSidebar(sidebarRoot, {
  onPolicyChange: (p) => {
    send({ type: 'SET_POLICY', marketId: 0, policy: p });
    clearTimeout(policySnapTimer);
    policySnapTimer = setTimeout(() => send({ type: 'REQUEST_SNAPSHOT' }), 350);
  },
  onEndTurn: (y) => {
    years = y;
    sendTick();
  },
  onYearsChange: (y) => {
    years = y;
  },
  onAutoPlayChange: (enabled) => {
    autoPlay = enabled;
    if (enabled) sendTick();
    else clearTimeout(autoTimer);
  },
  onRestart: startNewGame,
  onOpenSettings: openSettings,
  onOpenHelp: openHelp,
});

function findPlayerCell(s: Snapshot): number {
  for (let i = 0; i < s.marketId.length; i++) if (s.marketId[i] === 0) return i;
  return 0;
}

worker.onmessage = (e: MessageEvent<FromWorker>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'READY':
      break;
    case 'SNAPSHOT':
    case 'GAME_OVER': {
      pendingTick = false;
      snap = msg.snapshot;
      if (!centered && snap) {
        const cell = findPlayerCell(snap);
        viewport = centerOn(
          viewport,
          cell % snap.width,
          Math.floor(cell / snap.width),
          snap,
          canvas.width,
          canvas.height,
        );
        centered = true;
      }
      sidebar.update(snap);
      charts.update(snap.log);
      updateEvents(snap);
      updateMarkets(snap);
      redraw();
      if (msg.type === 'GAME_OVER') {
        gameOver = true;
        autoPlay = false;
        clearTimeout(autoTimer);
        sidebar.setAutoPlay(false);
        showSummary(app, msg.outcome, lastSaved?.log ?? []);
      } else {
        scheduleAuto();
      }
      break;
    }
    case 'SAVED':
      lastSaved = msg.payload;
      save(msg.payload);
      break;
    case 'ERROR':
      console.error('[sim worker]', msg.message);
      break;
  }
};

// pan controls
function panBy(dx: number, dy: number): void {
  viewport = panViewport(
    viewport,
    dx,
    dy,
    snap ?? { width: MAP_W, height: MAP_H },
    canvas.width,
    canvas.height,
  );
  redraw();
}

// Center the viewport on the centroid of the player's largest contiguous territory.
function centerOnLargestBlob(): void {
  if (!snap) return;
  const W = snap.width;
  const H = snap.height;
  const mid = snap.marketId;
  const seen = new Uint8Array(W * H);
  const stack: number[] = [];
  let bestSize = 0;
  let bestX = 0;
  let bestY = 0;
  for (let i = 0; i < mid.length; i++) {
    if (mid[i] !== 0 || seen[i]) continue;
    stack.length = 0;
    stack.push(i);
    seen[i] = 1;
    let size = 0;
    let sumX = 0;
    let sumY = 0;
    while (stack.length) {
      const c = stack.pop()!;
      const x = c % W;
      const y = (c / W) | 0;
      size++;
      sumX += x;
      sumY += y;
      if (x > 0 && mid[c - 1] === 0 && !seen[c - 1]) (seen[c - 1] = 1), stack.push(c - 1);
      if (x < W - 1 && mid[c + 1] === 0 && !seen[c + 1]) (seen[c + 1] = 1), stack.push(c + 1);
      if (y > 0 && mid[c - W] === 0 && !seen[c - W]) (seen[c - W] = 1), stack.push(c - W);
      if (y < H - 1 && mid[c + W] === 0 && !seen[c + W]) (seen[c + W] = 1), stack.push(c + W);
    }
    if (size > bestSize) {
      bestSize = size;
      bestX = Math.round(sumX / size);
      bestY = Math.round(sumY / size);
    }
  }
  if (bestSize === 0) return;
  viewport = centerOn(viewport, bestX, bestY, snap, canvas.width, canvas.height);
  redraw();
}

window.addEventListener('keydown', (e) => {
  const step = 3;
  if (e.key === 'ArrowLeft') panBy(-step, 0);
  else if (e.key === 'ArrowRight') panBy(step, 0);
  else if (e.key === 'ArrowUp') panBy(0, -step);
  else if (e.key === 'ArrowDown') panBy(0, step);
  else return;
  e.preventDefault();
});

// on-screen arrows (mobile portrait)
const padCss = `position:absolute;bottom:12px;left:12px;display:grid;
  grid-template-columns:repeat(3,40px);grid-template-rows:repeat(3,40px);gap:4px;opacity:.85;`;
const pad = document.createElement('div');
pad.style.cssText = padCss;
const mk = (label: string, col: number, row: number, dx: number, dy: number) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText = `grid-column:${col};grid-row:${row};background:#111;color:#ccc;
    border:1px solid #2a2a2a;border-radius:3px;font:inherit;cursor:pointer;`;
  b.onclick = () => panBy(dx, dy);
  pad.appendChild(b);
};
mk('\u2191', 2, 1, 0, -3);
mk('\u2190', 1, 2, -3, 0);
mk('\u2192', 3, 2, 3, 0);
mk('\u2193', 2, 3, 0, 3);
// center button: locate the player's largest territory (handy between zoom changes)
const centerBtn = document.createElement('button');
centerBtn.textContent = '\u2316'; // position indicator
centerBtn.title = 'Center on your largest territory';
centerBtn.style.cssText = `grid-column:2;grid-row:2;background:#111;color:#ccc;
  border:1px solid #2a2a2a;border-radius:3px;font:inherit;cursor:pointer;`;
centerBtn.onclick = centerOnLargestBlob;
pad.appendChild(centerBtn);
stage.appendChild(pad);

// zoom controls (map-view controls -> live on the map overlay, not the sidebar).
// FOUR levels, inverted: 4x = most zoomed in (32px), 1x = most zoomed out (4px). Starts at 4x.
// Segmented control (one connected track + a blue highlight that slides) — matches Years-per-turn.
const zoomLevels: ZoomLevel[] = [1, 2, 3, 4];
const zSegW = 100 / zoomLevels.length;
const zoomWrap = document.createElement('div');
zoomWrap.style.cssText =
  'position:absolute;bottom:12px;right:12px;width:148px;display:flex;background:#0a0a0a;' +
  'border:1px solid #2a2a2a;border-radius:4px;overflow:hidden;opacity:.9;';
const zoomSlider = document.createElement('div');
zoomSlider.style.cssText =
  `position:absolute;top:0;bottom:0;left:0;width:${zSegW}%;background:#1d3a4d;` +
  'border:1px solid #2f6e92;border-radius:3px;box-sizing:border-box;' +
  'transition:left 0.18s ease;pointer-events:none;';
zoomWrap.appendChild(zoomSlider);
const zoomSegs: HTMLButtonElement[] = [];
const paintZoom = () => {
  const idx = zoomLevels.indexOf(viewport.zoom);
  if (idx >= 0) zoomSlider.style.left = `${idx * zSegW}%`;
  zoomSegs.forEach((seg, i) => {
    seg.style.color = zoomLevels[i] === viewport.zoom ? '#fff' : '#9aa';
  });
};
zoomLevels.forEach((z) => {
  const seg = document.createElement('button');
  seg.textContent = `${z}\u00d7`;
  seg.style.cssText =
    'position:relative;z-index:1;flex:1;height:32px;background:none;border:none;' +
    'color:#9aa;cursor:pointer;font:inherit;';
  seg.onclick = () => {
    viewport = setZoom(viewport, z);
    paintZoom();
    redraw();
  };
  zoomSegs.push(seg);
  zoomWrap.appendChild(seg);
});
paintZoom();
stage.appendChild(zoomWrap);

// view-mode selector — centered overlay at the TOP-CENTER of the map (moved out of the sidebar).
const viewWrap = document.createElement('div');
viewWrap.style.cssText =
  'position:absolute;top:12px;left:50%;transform:translateX(-50%);display:flex;gap:4px;opacity:.92;';
const viewDefs: Array<[ViewMode, string]> = [
  ['peoples', 'Population / Markets'],
  ['food', 'Food'],
  ['raw', 'Raw Materials'],
];
const viewButtons = new Map<ViewMode, HTMLButtonElement>();
const paintView = () => {
  for (const [m, b] of viewButtons) {
    b.style.background = m === mode ? '#1d3a4d' : 'rgba(8,8,8,0.85)';
    b.style.borderColor = m === mode ? '#2f6e92' : '#2a2a2a';
  }
};
viewDefs.forEach(([m, label]) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText = `padding:7px 12px;color:#ccc;border:1px solid #2a2a2a;border-radius:3px;font:inherit;cursor:pointer;`;
  b.onclick = () => {
    mode = m;
    paintView();
    redraw();
  };
  viewButtons.set(m, b);
  viewWrap.appendChild(b);
});
paintView();
stage.appendChild(viewWrap);

// Left-column overlay (TOP-LEFT) stacking the History charts + the Other-markets panel.
const leftCol = document.createElement('div');
leftCol.style.cssText =
  'position:absolute;top:12px;left:12px;width:300px;max-height:calc(100% - 160px);overflow-y:auto;' +
  'display:flex;flex-direction:column;gap:10px;z-index:15;';
const boxCss =
  'background:rgba(8,8,8,0.85);border:1px solid #2a2a2a;border-radius:4px;padding:8px 10px;opacity:0.95;';

// history mini-charts (moved out of the sidebar for visibility).
// Driven from the SNAPSHOT handler below via charts.update(snap.log).
const historyWrap = document.createElement('div');
historyWrap.style.cssText = boxCss;
// Clickable header (title + caret) to minimize/expand — lets it be hidden on smaller screens.
const historyHead = document.createElement('div');
historyHead.style.cssText =
  'display:flex;justify-content:space-between;align-items:center;cursor:pointer;user-select:none;' +
  'color:#9aa;font-size:11px;letter-spacing:0.04em;text-transform:uppercase;';
const historyTitle = document.createElement('span');
historyTitle.textContent = 'History \u00b7 per year';
const historyCaret = document.createElement('span');
historyCaret.style.cssText = 'color:#9aa;font-size:12px;';
historyHead.appendChild(historyTitle);
historyHead.appendChild(historyCaret);
historyWrap.appendChild(historyHead);
const historyBody = document.createElement('div');
historyWrap.appendChild(historyBody);
const charts = mountCharts(historyBody);
// Start collapsed on smaller/mid screens (where the overlay competes for space); expanded on wide.
let historyMinimized = window.innerWidth < 1500;
const renderHistoryToggle = () => {
  historyBody.style.display = historyMinimized ? 'none' : '';
  historyCaret.textContent = historyMinimized ? '\u25b8' : '\u25be'; // collapsed / expanded
  historyHead.style.marginBottom = historyMinimized ? '0' : '2px';
};
historyHead.onclick = () => {
  historyMinimized = !historyMinimized;
  renderHistoryToggle();
  if (!historyMinimized && snap) charts.update(snap.log); // re-render at the correct width on expand
};
renderHistoryToggle();
leftCol.appendChild(historyWrap);

// ---- Other markets panel (collapsible), stacked below the History box ----
const marketsWrap = document.createElement('div');
marketsWrap.style.cssText = boxCss;
const marketsHead = document.createElement('div');
marketsHead.style.cssText =
  'display:flex;justify-content:space-between;align-items:center;cursor:pointer;user-select:none;' +
  'color:#9aa;font-size:11px;letter-spacing:0.04em;text-transform:uppercase;';
  const marketsTitle = document.createElement('span');
  marketsTitle.textContent = `${CONFIG.OTHER_MARKETS_SHOWN} largest markets`;
const marketsCaret = document.createElement('span');
marketsCaret.style.cssText = 'color:#9aa;font-size:12px;';
marketsHead.appendChild(marketsTitle);
marketsHead.appendChild(marketsCaret);
marketsWrap.appendChild(marketsHead);
const marketsBody = document.createElement('div');
marketsBody.style.marginTop = '6px';
marketsWrap.appendChild(marketsBody);

let lastTopMarkets: Snapshot['topMarkets'] = [];
function renderMarketsList(): void {
  marketsBody.innerHTML = '';
  if (lastTopMarkets.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = 'No markets';
    empty.style.cssText = 'color:#667;font-size:11px;';
    marketsBody.appendChild(empty);
    return;
  }
  for (const m of lastTopMarkets) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;margin:3px 0;font-size:11px;';
    const sw = document.createElement('span');
    sw.style.cssText = `flex:0 0 auto;width:9px;height:9px;border-radius:2px;background:hsl(${Math.round(
      m.colorHue,
    )},60%,55%);`;
    const name = document.createElement('span');
    name.textContent = m.isPlayer ? 'You (player market)' : `Market #${m.id}`;
    name.style.cssText = `flex:1 1 auto;color:${m.isPlayer ? '#fff' : '#cdd6e0'};${
      m.isPlayer ? 'font-weight:600;' : ''
    }`;
    const stat = document.createElement('span');
    stat.textContent = `${formatNumber(m.population)} pop \u00b7 ${formatNumber(m.cells)} cells`;
    stat.style.cssText = 'color:#9aa;flex:0 0 auto;';
    row.appendChild(sw);
    row.appendChild(name);
    row.appendChild(stat);
    marketsBody.appendChild(row);
  }
}

let marketsMinimized = window.innerWidth < 1500;
const renderMarketsToggle = () => {
  marketsBody.style.display = marketsMinimized ? 'none' : '';
  marketsCaret.textContent = marketsMinimized ? '\u25b8' : '\u25be'; // collapsed / expanded
};
marketsHead.onclick = () => {
  marketsMinimized = !marketsMinimized;
  renderMarketsToggle();
};
renderMarketsList();
renderMarketsToggle();
leftCol.appendChild(marketsWrap);

stage.appendChild(leftCol);

function updateMarkets(snap: Snapshot): void {
  lastTopMarkets = snap.topMarkets ?? [];
  renderMarketsList();
}

// ---- Chronicle: major historical events (TOP-RIGHT overlay), starting with the Epoch ----
const EVENT_COLOR: Record<string, string> = {
  epoch: '#cdd6e0',
  tech: '#b79be6',
  intervention: '#e6b87f',
  boom: '#7fe0a0',
  dieoff: '#e68a8a',
  encounter: '#7fd6d6',
  policy: '#9fb0c0',
  market: '#b0c4d4',
  warning: '#e6c86f',
  insurrection: '#e66f6f',
};
// Outer box does NOT scroll; the title stays fixed and only the event list scrolls beneath it.
const chronicleWrap = document.createElement('div');
chronicleWrap.style.cssText =
  'position:absolute;top:12px;right:12px;width:300px;max-height:50%;display:flex;flex-direction:column;' +
  'overflow:hidden;background:rgba(8,8,8,0.85);border:1px solid #2a2a2a;border-radius:4px;' +
  'opacity:0.95;z-index:15;';
const chronicleHead = document.createElement('div');
chronicleHead.textContent = 'Chronicle \u00b7 major events';
chronicleHead.style.cssText =
  'flex:0 0 auto;color:#9aa;font-size:11px;letter-spacing:0.04em;text-transform:uppercase;' +
  'padding:8px 10px 6px;border-bottom:1px solid #1c1c1c;';
chronicleWrap.appendChild(chronicleHead);
const chronicleList = document.createElement('div');
chronicleList.style.cssText = 'flex:1 1 auto;min-height:0;overflow-y:auto;padding:6px 10px 8px;';
chronicleWrap.appendChild(chronicleList);
stage.appendChild(chronicleWrap);

// ---- Settings (gear, top-right corner) -> modal: world-gen params + About ----
const ABOUT_PARAGRAPHS: string[] = [
  'This game started as an experiment inspired by economic historian Karl Polanyi and a simple question:',
  'Do markets emerge naturally, or are they built and maintained through rules, institutions, and intervention?',
  'In the simulation, technology, production, and demand can reinforce one another, creating periods of rapid growth. As these feedback loops strengthen, the economy becomes larger, faster, and more difficult to control. Crises emerge. Interventions become necessary. New incentives produce unintended consequences.',
  "The simulation also explores the idea that rapid growth can generate social strain. As wealth becomes concentrated, food security weakens, or technological change outpaces society's ability to adapt, labor participation and market effectiveness can begin to decline.",
  'The goal is not to model the real world accurately. Instead, it is to explore how complex economic systems can emerge from simple rules, and how growth, technology, markets, and political intervention shape one another over time.',
  'Think of it less as a game and more as a toy model for asking: what actually drives markets?',
];

// Download the current game's debug data (chronicle events + full per-year log + current player /
// rival summaries) as a JSON file the user can hand back for diagnosis.
function downloadDebugLog(): void {
  if (!snap) return;
  const data = {
    meta: {
      year: snap.year,
      width: snap.width,
      height: snap.height,
      generatedAt: new Date().toISOString(),
      settings,
    },
    player: snap.markets[0],
    topMarkets: snap.topMarkets,
    events: snap.events,
    log: snap.log,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `synthetic-markets-debug-y${snap.year}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function openSettings(): void {
  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:1100;display:flex;align-items:flex-start;justify-content:center;' +
    'overflow:auto;background:rgba(0,0,0,0.7);';
  overlay.onclick = () => overlay.remove();
  const card = document.createElement('div');
  card.style.cssText =
    'margin:5vh 20px;max-width:480px;width:100%;background:#0c0c0c;border:1px solid #2a2a2a;' +
    'border-radius:8px;color:#dfe6ee;font:13px/1.5 ui-monospace,Menlo,monospace;' +
    'box-shadow:0 6px 28px rgba(0,0,0,0.7);padding:20px 22px;';
  card.onclick = (e) => e.stopPropagation();

  const head = document.createElement('div');
  head.style.cssText =
    'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;';
  const h = document.createElement('div');
  h.textContent = 'SETTINGS';
  h.style.cssText = 'font-size:15px;font-weight:600;letter-spacing:.1em;';
  const close = document.createElement('button');
  close.textContent = '\u00d7';
  close.style.cssText =
    'background:none;border:none;color:#9aa;font-size:22px;cursor:pointer;line-height:1;';
  close.onclick = () => overlay.remove();
  head.appendChild(h);
  head.appendChild(close);
  card.appendChild(head);

  const note = document.createElement('div');
  note.style.cssText = 'color:#7d8590;font-size:11px;margin-bottom:14px;';
  note.textContent = 'Changing any value starts a NEW game (current progress is lost).';
  card.appendChild(note);

  // hoisted helpers (referenced by the field oninput handlers created below)
  function changed(): boolean {
    return (
      Number(sizeIn.value) !== settings.size ||
      Number(cpmIn.value) !== settings.cellsPerMarket ||
      Number(wildIn.value) !== settings.wildDensity
    );
  }
  function updateNewGameBtn(): void {
    newGameBtn.style.display = changed() ? 'block' : 'none';
  }
  function field(
    label: string,
    hint: string,
    value: number,
    min: number,
    max: number,
    step: number,
  ): HTMLInputElement {
    const row = document.createElement('div');
    row.style.cssText = 'margin-bottom:12px;';
    const lab = document.createElement('div');
    lab.style.cssText = 'display:flex;justify-content:space-between;color:#aab;margin-bottom:3px;';
    const ls = document.createElement('span');
    ls.textContent = label;
    const ds = document.createElement('span');
    ds.textContent = `default ${value}`;
    ds.style.cssText = 'color:#667;';
    lab.appendChild(ls);
    lab.appendChild(ds);
    const input = document.createElement('input');
    input.type = 'number';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.style.cssText =
      'width:100%;background:#060606;border:1px solid #2a2a2a;color:#fff;border-radius:3px;padding:6px 8px;font:inherit;';
    input.oninput = updateNewGameBtn;
    const hintEl = document.createElement('div');
    hintEl.textContent = hint;
    hintEl.style.cssText = 'color:#7d8590;font-size:11px;margin-top:3px;';
    row.appendChild(lab);
    row.appendChild(input);
    row.appendChild(hintEl);
    card.appendChild(row);
    return input;
  }

  const sizeIn = field(
    'Board size (N\u00d7N)',
    'Larger boards hold more markets but make turns slower.',
    settings.size,
    60,
    600,
    10,
  );
  const cpmIn = field(
    'Market density (1 market / N cells)',
    'Lower = denser rivalry (more markets).',
    settings.cellsPerMarket,
    10,
    5000,
    10,
  );
  const wildIn = field(
    'Population density (0\u20131)',
    'Fraction of cells seeded with wild people.',
    settings.wildDensity,
    0,
    1,
    0.05,
  );

  const newGameBtn = document.createElement('button');
  newGameBtn.textContent = 'START NEW GAME WITH THESE SETTINGS';
  newGameBtn.style.cssText =
    'width:100%;background:#1d3a4d;color:#fff;border:1px solid #2f6e92;padding:10px;font:inherit;' +
    'font-weight:600;cursor:pointer;border-radius:3px;margin:4px 0 4px;display:none;';
  newGameBtn.onclick = () => {
    const clampI = (v: number, lo: number, hi: number) =>
      Math.max(lo, Math.min(hi, Math.round(Number.isFinite(v) ? v : lo)));
    settings.size = clampI(Number(sizeIn.value), 60, 600);
    settings.cellsPerMarket = clampI(Number(cpmIn.value), 10, 5000);
    settings.wildDensity = Math.max(0, Math.min(1, Number(wildIn.value) || 0));
    overlay.remove();
    startNewGame();
  };
  card.appendChild(newGameBtn);

  // ---- About Game ----
  const hr = document.createElement('div');
  hr.style.cssText = 'border-top:1px solid #1c1c1c;margin:16px 0 12px;';
  card.appendChild(hr);
  const aboutH = document.createElement('div');
  aboutH.textContent = 'ABOUT GAME';
  aboutH.style.cssText = 'font-size:13px;font-weight:600;letter-spacing:.1em;margin-bottom:8px;';
  card.appendChild(aboutH);
  const aboutQ = document.createElement('div');
  aboutQ.textContent = 'Why did I make this?';
  aboutQ.style.cssText = 'color:#cdd6e0;font-weight:600;margin-bottom:8px;';
  card.appendChild(aboutQ);
  for (const para of ABOUT_PARAGRAPHS) {
    const p = document.createElement('div');
    p.textContent = para;
    p.style.cssText = 'color:#aeb8c2;margin-bottom:10px;';
    card.appendChild(p);
  }

  // ---- Debug log export (unrelated to new-game settings; lives at the very bottom) ----
  const dlHr = document.createElement('div');
  dlHr.style.cssText = 'border-top:1px solid #1c1c1c;margin:16px 0 12px;';
  card.appendChild(dlHr);
  const dlBtn = document.createElement('button');
  dlBtn.textContent = 'DOWNLOAD DEBUG LOG (JSON)';
  dlBtn.style.cssText =
    'width:100%;background:#111;color:#ccc;border:1px solid #2a2a2a;padding:9px;font:inherit;' +
    'cursor:pointer;border-radius:3px;margin:0 0 4px;';
  dlBtn.onclick = downloadDebugLog;
  card.appendChild(dlBtn);
  const dlHint = document.createElement('div');
  dlHint.textContent =
    'Exports the chronicle + full per-year history (population, food, goods, tech, deaths) as JSON.';
  dlHint.style.cssText = 'color:#7d8590;font-size:11px;';
  card.appendChild(dlHint);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

// ---- How to Play (question-mark icon, top-right of the sidebar header) -> modal ----
// NOTE TO MAINTAINERS: if the game mechanics change meaningfully (policy levers, tech/yield
// behavior, market interaction/conflict, forced intervention, win/loss/insurrection rules),
// UPDATE HELP_SECTIONS below so this in-game guide stays accurate. (See AGENTS.md.)
const HELP_SECTIONS: Array<{ h: string; body: string }> = [
  {
    h: 'The idea',
    body:
      'You run <b>exactly one market</b> in a living world of rival markets and wandering "wild" ' +
      'people. You never command individuals \u2014 you set <b>policy</b> each turn and your ' +
      'population responds: they are born, migrate toward food or raw materials, prosper, and ' +
      'sometimes starve or revolt. The same world and the same choices always produce the same ' +
      'result.',
  },
  {
    h: 'Each turn',
    body:
      'Set your policy, choose how many years to run (<b>10 / 50 / 250</b>), then press ' +
      '<b>End Turn</b> (or toggle <b>Auto-play</b>). Every batched year resolves in a fixed order. ' +
      'There are four resources: <b>Food</b> (perishable \u2014 each person needs 1/year or risks ' +
      'death), <b>Raw materials</b> (mined from the land; what you leave unmined banks in the ' +
      'ground), <b>Goods</b> (manufactured from raw), and <b>Capital Wealth</b> (your goods pool, ' +
      'which people consume from automatically and which decides conflicts).',
  },
  {
    h: 'Your policy levers',
    body:
      '<b>Labor split</b> \u2014 divide workers between growing food and mining raw. ' +
      '<b>Raw allocation</b> \u2014 split mined raw three ways: <b>Market</b> (\u2192 goods &amp; ' +
      'wealth), <b>Tech</b> (\u2192 research), and <b>Reserves</b> (\u2192 a stockpile that funds ' +
      'expansion). <b>Famine Tolerance</b> \u2014 how far people will chase raw before hunger ' +
      'anchors them to the cells that feed them.',
  },
  {
    h: 'Technology &amp; cell yields',
    body:
      'Pouring raw into <b>Tech</b> advances your technology level. Each level multiplies the ' +
      '<b>goods you manufacture from every unit of mined raw</b> \u2014 the gains compound steeply, ' +
      'so a high-tech market turns the same raw into vastly more wealth. <b>Food is deliberately ' +
      'NOT boosted by tech</b>: a cell\u2019s food capacity stays tied to the land, so a growing ' +
      'population must keep <b>spreading onto new cells</b> to feed itself. Technology also widens ' +
      'your fog-of-war vision, eventually revealing the whole map.',
  },
  {
    h: 'Other markets &amp; conflict',
    body:
      'Your people expand by migrating. Moving into <b>empty</b> land claims it; moving onto ' +
      '<b>wild</b> people peacefully absorbs them into your market. A rival market\u2019s cell that ' +
      'has been left <b>undefended</b> (no people on it) is taken freely. But stepping onto a ' +
      'rival\u2019s <b>defended</b> cell can trigger <b>conflict</b> \u2014 more likely the more your ' +
      'growth posture (\u201corientation\u201d) differs from theirs. The market with greater ' +
      '<b>Capital Wealth</b> wins, taking the cell and converting everyone on it.',
  },
  {
    h: 'Forced Intervention \u2014 Market Expansion',
    body:
      'A toggle. While it is ON, every time you <b>unlock a new technology</b> you queue a dramatic ' +
      'territory <b>burst</b> costing <b>5\u00d7 that cycle\u2019s mined raw</b>, paid from your ' +
      '<b>Reserves</b>. If reserves fall short the burst banks until you can afford it. When it ' +
      'fires, it carves an <b>arm</b> of land from your border toward a raw-rich target, ending in ' +
      'a <b>blob</b> of new territory. Unowned and wild cells are seized freely; a rival\u2019s ' +
      'cells are taken <b>only where you out-tech that rival</b> \u2014 a more advanced market can ' +
      'block the corridor entirely.',
  },
  {
    h: 'Society, stability &amp; labor',
    body:
      'Markets are sustained by the society inside them. <b>Social Stability</b> (0\u2013100) tracks ' +
      'that society\u2019s capacity to keep participating in the market \u2014 it falls as <b>wealth ' +
      'concentrates</b>, <b>food security weakens</b>, or <b>technology changes faster than people ' +
      'can adapt</b> (each new tech is a temporary shock that fades over time). Low stability has ' +
      'teeth: it cuts <b>Labor Efficiency</b> (how much of your workforce actually shows up \u2014 ' +
      'scaling food, mining and research alike) and <b>Market Coverage</b> (how much of your output ' +
      'the formal market captures, as activity slips informal \u2014 your territory is unaffected). ' +
      'So racing for growth and tech can quietly undermine the workforce that powers it: watch the ' +
      '<b>Social stability</b> chart (top-left) and the <b>Society</b> stats in the sidebar.',
  },
  {
    h: 'Winning, losing &amp; insurrection',
    body:
      '<b>Win</b> by researching the <b>final technology</b>. <b>Lose</b> if your market drops to ' +
      'zero people or loses its last cell (rivals being wiped out does NOT end the game). Beware ' +
      '<b>inequality</b>: if wealth concentrates too heavily, you risk an <b>insurrection</b> that ' +
      'violently shrinks your market \u2014 you will get warning cards first.',
  },
  {
    h: 'Reading the map',
    body:
      'Switch <b>view modes</b> (top-center: Population / Food / Raw), pan with the arrow keys or ' +
      'on-screen pad, and zoom 1\u00d7\u20134\u00d7. <b>Hover any cell</b> for exact numbers. The ' +
      '<b>History</b> charts and <b>largest markets</b> panel (top-left) and the <b>Chronicle</b> of ' +
      'major events (top-right) track how your world is unfolding.',
  },
];

function openHelp(): void {
  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:1100;display:flex;align-items:flex-start;justify-content:center;' +
    'overflow:auto;background:rgba(0,0,0,0.7);';
  overlay.onclick = () => overlay.remove();
  const card = document.createElement('div');
  card.style.cssText =
    'margin:5vh 20px;max-width:560px;width:100%;background:#0c0c0c;border:1px solid #2a2a2a;' +
    'border-radius:8px;color:#dfe6ee;font:13px/1.6 ui-monospace,Menlo,monospace;' +
    'box-shadow:0 6px 28px rgba(0,0,0,0.7);padding:20px 24px;';
  card.onclick = (e) => e.stopPropagation();

  const head = document.createElement('div');
  head.style.cssText =
    'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;';
  const h = document.createElement('div');
  h.textContent = 'HOW TO PLAY';
  h.style.cssText = 'font-size:15px;font-weight:600;letter-spacing:.1em;';
  const close = document.createElement('button');
  close.textContent = '\u00d7';
  close.style.cssText =
    'background:none;border:none;color:#9aa;font-size:22px;cursor:pointer;line-height:1;';
  close.onclick = () => overlay.remove();
  head.appendChild(h);
  head.appendChild(close);
  card.appendChild(head);

  const sub = document.createElement('div');
  sub.style.cssText = 'color:#7d8590;font-size:11px;margin-bottom:16px;';
  sub.textContent = 'Synthetic Markets \u2014 a market that grows, reacts, and sometimes revolts.';
  card.appendChild(sub);

  for (const sec of HELP_SECTIONS) {
    const sh = document.createElement('div');
    sh.innerHTML = sec.h;
    sh.style.cssText =
      'color:#9ab;font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;' +
      'margin:14px 0 4px;';
    card.appendChild(sh);
    const p = document.createElement('div');
    p.innerHTML = sec.body;
    p.style.cssText = 'color:#bcc6d0;margin-bottom:4px;';
    card.appendChild(p);
  }

  const foot = document.createElement('div');
  foot.style.cssText = 'border-top:1px solid #1c1c1c;margin-top:16px;padding-top:10px;color:#667;font-size:11px;';
  foot.textContent = 'Click anywhere outside this box to close.';
  card.appendChild(foot);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

function renderChronicle(events: Snapshot['events']): void {
  chronicleList.innerHTML = '';
  for (const ev of events) {
    const row = document.createElement('div');
    row.style.cssText =
      'display:flex;gap:6px;align-items:baseline;margin:3px 0;font-size:11px;line-height:1.35;';
    const yr = document.createElement('span');
    yr.textContent = `y${ev.year}`;
    yr.style.cssText = 'color:#667;flex:0 0 auto;min-width:34px;font-variant-numeric:tabular-nums;';
    const txt = document.createElement('span');
    txt.textContent = ev.text;
    txt.style.cssText = `color:${EVENT_COLOR[ev.kind] ?? '#cdd6e0'};`;
    row.appendChild(yr);
    row.appendChild(txt);
    chronicleList.appendChild(row);
  }
  // keep the newest events in view
  chronicleList.scrollTop = chronicleList.scrollHeight;
}

// Transient "alert card" for major events (Forced Intervention, insurrection warnings/collapse):
// slides in at top-center, auto-dismisses. The accent color is set per event.
const alertCard = document.createElement('div');
alertCard.style.cssText =
  'position:absolute;top:58px;left:50%;transform:translateX(-50%) translateY(-8px);' +
  'max-width:70%;display:none;opacity:0;transition:opacity 0.25s, transform 0.25s;z-index:30;' +
  'background:rgba(20,14,10,0.96);border:1px solid #e6b87f;border-radius:6px;padding:10px 14px;' +
  'color:#f0e6da;font:13px ui-monospace,Menlo,monospace;line-height:1.4;text-align:center;' +
  'box-shadow:0 4px 18px rgba(0,0,0,0.6);';
stage.appendChild(alertCard);
let alertTimer: ReturnType<typeof setTimeout> | undefined;
function showAlert(html: string, accent: string): void {
  alertCard.style.borderColor = accent;
  alertCard.innerHTML = html;
  alertCard.style.display = 'block';
  // next frame: fade/slide in
  requestAnimationFrame(() => {
    alertCard.style.opacity = '1';
    alertCard.style.transform = 'translateX(-50%) translateY(0)';
  });
  clearTimeout(alertTimer);
  alertTimer = setTimeout(() => {
    alertCard.style.opacity = '0';
    alertCard.style.transform = 'translateX(-50%) translateY(-8px)';
    setTimeout(() => (alertCard.style.display = 'none'), 300);
  }, 6500);
}

// Map an alertable event to a card (title + accent). Higher priority = more important.
function eventCard(kind: string, text: string): { html: string; accent: string; pri: number } | null {
  if (kind === 'insurrection')
    return { html: `<b style="color:#ff9a9a">\u2691 Insurrection</b><br/>${text}`, accent: '#e66f6f', pri: 3 };
  if (kind === 'intervention')
    return { html: `<b style="color:#ffd9a0">\u26a1 Forced Intervention</b><br/>${text}`, accent: '#e6b87f', pri: 2 };
  if (kind === 'warning')
    return { html: `<b style="color:#ffe28a">\u26a0 Warning</b><br/>${text}`, accent: '#e6c86f', pri: 1 };
  return null;
}

// Track how many events we've already shown so new ones can trigger the transient alert. -1 means
// "not yet initialized" — the first snapshot seeds the count without alerting on pre-existing
// events (e.g. after loading a save).
let lastEventCount = -1;
function updateEvents(snap: Snapshot): void {
  const events = snap.events ?? [];
  renderChronicle(events);
  if (lastEventCount < 0) {
    lastEventCount = events.length;
    return;
  }
  if (events.length > lastEventCount) {
    // Show the highest-priority new alertable event (insurrection > intervention > warning).
    let best: { html: string; accent: string; pri: number } | null = null;
    for (let i = lastEventCount; i < events.length; i++) {
      const c = eventCard(events[i].kind, events[i].text);
      if (c && (!best || c.pri >= best.pri)) best = c;
    }
    if (best) showAlert(best.html, best.accent);
  }
  lastEventCount = events.length;
}

// hover tooltip: full precise values for the hovered cell
const tip = document.createElement('div');
tip.style.cssText = `position:absolute;pointer-events:none;display:none;z-index:20;
  background:rgba(8,8,8,0.95);border:1px solid #333;border-radius:4px;padding:6px 8px;
  font:12px ui-monospace,Menlo,monospace;color:#ddd;max-width:220px;line-height:1.5;
  box-shadow:0 2px 10px rgba(0,0,0,0.6);`;
stage.appendChild(tip);

function ownerLabel(s: Snapshot, i: number): string {
  const mid = s.marketId[i];
  if (mid === 0) return 'You (player market)';
  if (mid > 0) return `Market #${mid}`;
  if (s.cellPopulation[i] > 0) return 'Wild';
  return 'Unowned';
}

function hideTip(): void {
  tip.style.display = 'none';
}

canvas.addEventListener('mousemove', (e) => {
  if (!snap) return hideTip();
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const hit = screenToCell(viewport, canvas.width, canvas.height, snap, mx, my);
  if (!hit) return hideTip();
  const cellX = hit.x;
  const cellY = hit.y;
  const i = cellY * snap.width + cellX;
  if (!snap.discovered[i]) return hideTip();

  const food = snap.foodDisplay[i];
  const raw = snap.rawDisplay[i];
  const pop = snap.cellPopulation[i];
  tip.innerHTML =
    `<div style="color:#888">(${cellX}, ${cellY}) \u00b7 ${ownerLabel(snap, i)}</div>` +
    `<div>Population: <b>${pop.toLocaleString('en-US')}</b></div>` +
    `<div>Food yield: <b>${formatNumber(food)}</b> <span style="color:#777">(${food.toLocaleString(
      'en-US',
      { maximumFractionDigits: 2 },
    )})</span></div>` +
    `<div>Raw + stock: <b>${formatNumber(raw)}</b> <span style="color:#777">(${raw.toLocaleString(
      'en-US',
      { maximumFractionDigits: 2 },
    )})</span></div>`;

  // position near cursor, clamped within the stage
  tip.style.display = 'block';
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  let left = mx + 14;
  let top = my + 14;
  if (left + tw > canvas.width) left = mx - tw - 14;
  if (top + th > canvas.height) top = my - th - 14;
  tip.style.left = `${Math.max(0, left)}px`;
  tip.style.top = `${Math.max(0, top)}px`;
});

canvas.addEventListener('mouseleave', hideTip);

window.addEventListener('resize', resize);

// boot: continue a save if present, else fresh world
const saved = load();
if (saved) {
  lastSaved = saved;
  send({ type: 'LOAD', payload: saved });
} else {
  sendInit();
}

resize();

// One-time "best on desktop" hint for any viewport narrower than 1500px (covers small desktop
// windows AND mobile, which the layout doesn't suit). A dismissable modal shown only on page load;
// click anywhere to exit.
function maybeShowDesktopHint(): void {
  const w = window.innerWidth;
  if (w >= 1500) return;
  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;' +
    'background:rgba(0,0,0,0.7);cursor:pointer;';
  const card = document.createElement('div');
  card.style.cssText =
    'max-width:420px;margin:20px;padding:22px 26px;background:#0c0c0c;border:1px solid #2f6e92;' +
    'border-radius:8px;color:#dfe6ee;font:14px/1.55 ui-monospace,Menlo,monospace;text-align:center;' +
    'box-shadow:0 6px 28px rgba(0,0,0,0.7);';
  card.innerHTML =
    '<div style="font-size:15px;font-weight:600;letter-spacing:.08em;margin-bottom:10px">BEST ON DESKTOP</div>' +
    '<div style="color:#aeb8c2">Synthetic Markets is designed for a wide desktop screen. On a ' +
    'narrower viewport (including mobile) the overlays compete for space \u2014 use a desktop and ' +
    'widen the window for the best experience.</div>' +
    '<div style="margin-top:14px;color:#7d8590;font-size:12px">Click anywhere to dismiss</div>';
  overlay.appendChild(card);
  overlay.onclick = () => overlay.remove();
  document.body.appendChild(overlay);
}
maybeShowDesktopHint();
