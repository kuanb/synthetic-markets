// App bootstrap: spawn the sim worker, wire canvas + sidebar + input, route GAME_OVER.

import './style.css';
import { CONFIG } from './config';
import { draw, type ViewMode } from './render/canvas';
import {
  type Viewport,
  cellSize,
  centerOn,
  pan as panViewport,
  setZoom,
} from './render/viewport';
import { formatNumber } from './render/format';
import { mountSidebar } from './ui/sidebar';
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

let viewport: Viewport = { camX: 0, camY: 0, zoom: 1 };
let mode: ViewMode = 'peoples';
let snap: Snapshot | null = null;
let lastSaved: SerializedState | null = null;
let centered = false;

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

function restart(): void {
  clear();
  lastSaved = null;
  centered = false;
  // drop any game-over summary overlay
  document.querySelectorAll('[data-sm-overlay]').forEach((n) => n.remove());
  const seed = Math.floor(Math.random() * 1_000_000_000);
  send({ type: 'INIT', seed, width: CONFIG.WIDTH, height: CONFIG.HEIGHT });
}

const sidebar = mountSidebar(sidebarRoot, {
  onPolicyChange: (p) => send({ type: 'SET_POLICY', marketId: 0, policy: p }),
  onViewMode: (m) => {
    mode = m;
    redraw();
  },
  onEndTurn: (years) => send({ type: 'TICK', years }),
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
      redraw();
      if (msg.type === 'GAME_OVER') {
        showSummary(app, msg.outcome, lastSaved?.log ?? []);
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
    snap ?? { width: CONFIG.WIDTH, height: CONFIG.HEIGHT },
    canvas.width,
    canvas.height,
  );
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
stage.appendChild(pad);

// zoom controls (map-view controls -> live on the map overlay, not the sidebar)
const zoomWrap = document.createElement('div');
zoomWrap.style.cssText =
  'position:absolute;bottom:12px;right:12px;display:flex;gap:4px;opacity:.9;';
const zoomButtons = new Map<1 | 2, HTMLButtonElement>();
const paintZoom = () => {
  for (const [z, b] of zoomButtons) {
    b.style.background = z === viewport.zoom ? '#1d3a4d' : '#111';
    b.style.borderColor = z === viewport.zoom ? '#2f6e92' : '#2a2a2a';
  }
};
([1, 2] as const).forEach((z) => {
  const b = document.createElement('button');
  b.textContent = `${z}\u00d7`;
  b.style.cssText = `width:40px;height:40px;color:#ccc;border:1px solid #2a2a2a;border-radius:3px;font:inherit;cursor:pointer;`;
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
  const cs = cellSize(viewport);
  const cellX = viewport.camX + Math.floor(mx / cs);
  const cellY = viewport.camY + Math.floor(my / cs);
  if (cellX < 0 || cellY < 0 || cellX >= snap.width || cellY >= snap.height) return hideTip();
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
  send({ type: 'INIT', seed, width: CONFIG.WIDTH, height: CONFIG.HEIGHT });
}

resize();
