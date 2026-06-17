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

// Enforce the minimum map size floor (300) if a smaller size is ever configured.
const MAP_W = Math.max(CONFIG.MAP_MIN_SIZE, CONFIG.WIDTH);
const MAP_H = Math.max(CONFIG.MAP_MIN_SIZE, CONFIG.HEIGHT);

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

function restart(): void {
  clear();
  lastSaved = null;
  centered = false;
  gameOver = false;
  pendingTick = false;
  // drop any game-over summary overlay
  document.querySelectorAll('[data-sm-overlay]').forEach((n) => n.remove());
  const seed = Math.floor(Math.random() * 1_000_000_000);
  send({ type: 'INIT', seed, width: MAP_W, height: MAP_H });
}

const sidebar = mountSidebar(sidebarRoot, {
  onPolicyChange: (p) => send({ type: 'SET_POLICY', marketId: 0, policy: p }),
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
  onRestart: restart,
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
const zoomWrap = document.createElement('div');
zoomWrap.style.cssText =
  'position:absolute;bottom:12px;right:12px;display:flex;gap:4px;opacity:.9;';
const zoomButtons = new Map<ZoomLevel, HTMLButtonElement>();
const paintZoom = () => {
  for (const [z, b] of zoomButtons) {
    b.style.background = z === viewport.zoom ? '#1d3a4d' : '#111';
    b.style.borderColor = z === viewport.zoom ? '#2f6e92' : '#2a2a2a';
  }
};
([1, 2, 3, 4] as const).forEach((z) => {
  const b = document.createElement('button');
  b.textContent = `${z}\u00d7`;
  b.style.cssText = `width:36px;height:36px;color:#ccc;border:1px solid #2a2a2a;border-radius:3px;font:inherit;cursor:pointer;`;
  b.onclick = () => {
    viewport = setZoom(viewport, z);
    paintZoom();
    redraw();
  };
  zoomButtons.set(z, b);
  zoomWrap.appendChild(b);
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

// history mini-charts — TOP-LEFT overlay on the map (moved out of the sidebar for visibility).
// Driven from the SNAPSHOT handler below via charts.update(snap.log).
const historyWrap = document.createElement('div');
historyWrap.style.cssText =
  'position:absolute;top:12px;left:12px;width:300px;max-height:calc(100% - 160px);overflow-y:auto;' +
  'background:rgba(8,8,8,0.85);border:1px solid #2a2a2a;border-radius:4px;padding:8px 10px;' +
  'opacity:0.95;z-index:15;';
const historyHead = document.createElement('div');
historyHead.textContent = 'History \u00b7 per year';
historyHead.style.cssText =
  'color:#9aa;font-size:11px;letter-spacing:0.04em;text-transform:uppercase;margin-bottom:2px;';
historyWrap.appendChild(historyHead);
const charts = mountCharts(historyWrap);
stage.appendChild(historyWrap);

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
  const seed = Math.floor(Math.random() * 1_000_000_000);
  send({ type: 'INIT', seed, width: MAP_W, height: MAP_H });
}

resize();
