// Canvas renderer. Black background, white wireframe, text-only cell contents, viewport culling.

import type { Snapshot } from './snapshot';
import { type Viewport, cellSize, visibleCellRange } from './viewport';
import { formatNumber, formatCell } from './format';

export type ViewMode = 'peoples' | 'food' | 'raw';
export { formatNumber };

const FONT_FAMILY = 'ui-monospace, Menlo, monospace';

function heatColor(t: number): string {
  // t in [0,1] -> dark blue to bright yellow
  const h = 60 - 200 * (1 - t); // ~ -140..60
  return `hsl(${(h + 360) % 360}, 80%, ${20 + 45 * t}%)`;
}

export function draw(
  ctx: CanvasRenderingContext2D,
  snap: Snapshot,
  vp: Viewport,
  mode: ViewMode,
): void {
  const cs = cellSize(vp);
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, cw, ch);

  const { x0, y0, x1, y1 } = visibleCellRange(vp, cw, ch, snap);

  const fontPx = Math.max(7, Math.floor(cs * 0.38));
  ctx.font = `${fontPx}px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // precompute max raw/food for heat normalization within view
  let maxVal = 1;
  if (mode !== 'peoples') {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * snap.width + x;
        if (!snap.discovered[i]) continue;
        const v = mode === 'food' ? snap.foodDisplay[i] : snap.rawDisplay[i];
        if (v > maxVal) maxVal = v;
      }
    }
  }

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * snap.width + x;
      const sx = (x - vp.camX) * cs;
      const sy = (y - vp.camY) * cs;

      if (!snap.discovered[i]) continue; // fog: undiscovered cells are blank

      const hue = snap.cellHue[i];
      const owned = snap.marketId[i] >= 0;

      if (mode === 'peoples') {
        if (owned) {
          ctx.fillStyle = `hsla(${hue}, 70%, 50%, 0.22)`;
          ctx.fillRect(sx, sy, cs, cs);
        }
        const pop = snap.cellPopulation[i];
        if (pop > 0 && hue >= 0) {
          drawLabel(ctx, formatCell(pop), sx, sy, cs, fontPx, `hsl(${hue}, 90%, 72%)`);
        }
      } else {
        const v = mode === 'food' ? snap.foodDisplay[i] : snap.rawDisplay[i];
        const t = Math.min(1, v / maxVal);
        ctx.fillStyle = heatColor(t);
        ctx.globalAlpha = 0.55;
        ctx.fillRect(sx, sy, cs, cs);
        ctx.globalAlpha = 1;
        // labels only where they fit; heat color still conveys magnitude when omitted
        if (cs >= 22 && v >= 0.5) {
          drawLabel(ctx, formatCell(v), sx, sy, cs, fontPx, '#fff');
        }
      }
    }
  }

  // white wireframe grid
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = x0; x <= x1; x++) {
    const sx = Math.floor((x - vp.camX) * cs) + 0.5;
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, ch);
  }
  for (let y = y0; y <= y1; y++) {
    const sy = Math.floor((y - vp.camY) * cs) + 0.5;
    ctx.moveTo(0, sy);
    ctx.lineTo(cw, sy);
  }
  ctx.stroke();
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  sx: number,
  sy: number,
  cs: number,
  fontPx: number,
  color: string,
): void {
  const cx = sx + cs / 2;
  const cy = sy + cs / 2;
  const maxW = cs - 3;

  // Guarantee the label never overflows the cell: shrink the font to fit; omit if it cannot.
  let fp = fontPx;
  let w = ctx.measureText(text).width;
  if (w > maxW) {
    fp = Math.floor((fp * maxW) / w);
    if (fp < 5) return; // too small to be legible at this zoom -> omit (heat/tint still shows)
    ctx.font = `${fp}px ${FONT_FAMILY}`;
    w = ctx.measureText(text).width;
  }

  // opaque backing so tint + text never blend into illegibility
  const h = fp + 2;
  ctx.fillStyle = 'rgba(0,0,0,0.78)';
  ctx.fillRect(cx - w / 2 - 1, cy - h / 2, w + 2, h);
  ctx.fillStyle = color;
  ctx.fillText(text, cx, cy);

  if (fp !== fontPx) ctx.font = `${fontPx}px ${FONT_FAMILY}`; // restore for next cells
}
