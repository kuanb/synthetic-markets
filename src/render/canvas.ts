// Canvas renderer. Black background, white wireframe, text-only cell contents, viewport culling.

import type { Snapshot } from './snapshot';
import { type Viewport, viewTransform, visibleCellRange } from './viewport';
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
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  const t = viewTransform(vp, cw, ch, snap);
  const cs = t.cs;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, cw, ch);

  const { x0, y0, x1, y1 } = visibleCellRange(vp, cw, ch, snap);

  // Clip everything to the actual map rectangle so nothing (cells or grid) draws out of bounds;
  // the area beyond the map extent stays solid black.
  const mapLeft = t.ox;
  const mapTop = t.oy;
  const mapRight = t.ox + snap.width * cs;
  const mapBottom = t.oy + snap.height * cs;
  ctx.save();
  ctx.beginPath();
  ctx.rect(mapLeft, mapTop, mapRight - mapLeft, mapBottom - mapTop);
  ctx.clip();

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
      const sx = t.ox + x * cs;
      const sy = t.oy + y * cs;

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

  // white wireframe grid — only within the map extent (clip already enforces this, but we also
  // bound the line spans to the map rectangle so they never run edge-to-edge across black).
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = x0; x <= x1; x++) {
    const sx = Math.floor(t.ox + x * cs) + 0.5;
    ctx.moveTo(sx, mapTop);
    ctx.lineTo(sx, mapBottom);
  }
  for (let y = y0; y <= y1; y++) {
    const sy = Math.floor(t.oy + y * cs) + 0.5;
    ctx.moveTo(mapLeft, sy);
    ctx.lineTo(mapRight, sy);
  }
  ctx.stroke();
  ctx.restore();
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
