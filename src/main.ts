// App bootstrap: spawn the sim worker, wire canvas + sidebar + input, route GAME_OVER.

import './style.css';
import { CONFIG } from './config';
import { draw, type ViewMode } from './render/canvas';
import {
  type Viewport,
  centerOn,
  pan as panViewport,
  setZoom,
} from './render/viewport';
import { mountSidebar } from './ui/sidebar';
import { showSummary } from './ui/stats';
import { load, save, type SerializedState } from './persistence';
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

const sidebar = mountSidebar(sidebarRoot, {
  onPolicyChange: (p) => send({ type: 'SET_POLICY', marketId: 0, policy: p }),
  onViewMode: (m) => {
    mode = m;
    redraw();
  },
  onBurstSpend: () => send({ type: 'BURST_SPEND', marketId: 0 }),
  onEndTurn: (years) => send({ type: 'TICK', years }),
  onZoom: (z) => {
    viewport = setZoom(viewport, z);
    redraw();
  },
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
