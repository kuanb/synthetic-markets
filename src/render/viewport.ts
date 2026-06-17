// Pan/zoom state, camera clamping, and centering. camX/camY are the top-left visible cell.
//
// FOUR zoom levels, INVERTED: the highest number is the most zoomed IN (largest cells). The game
// starts fully zoomed in (zoom 4). cellSize = CELL_PX / 2^(4 - zoom):
//   zoom 4 -> 32px (start), zoom 3 -> 16px, zoom 2 -> 8px, zoom 1 -> 4px (most zoomed out).

import { CONFIG } from '../config';

export type ZoomLevel = 1 | 2 | 3 | 4;

export interface Viewport {
  camX: number;
  camY: number;
  zoom: ZoomLevel;
}

export function cellSize(vp: Viewport): number {
  return CONFIG.CELL_PX / Math.pow(2, 4 - vp.zoom);
}

function clampCam(v: number, span: number, world: number): number {
  const maxCam = Math.max(0, world - span);
  return Math.max(0, Math.min(v, maxCam));
}

// Everything render/hit-test needs: cell size, the centering pixel offset (when the whole map is
// smaller than the canvas in a dimension it is centered), and the effective (clamped) camera.
export interface ViewTransform {
  cs: number;
  ox: number; // screen-x of cell column `camX`'s left edge
  oy: number;
  camX: number;
  camY: number;
  colSpan: number;
  rowSpan: number;
}

export function viewTransform(
  vp: Viewport,
  canvasW: number,
  canvasH: number,
  world: { width: number; height: number },
): ViewTransform {
  const cs = cellSize(vp);
  const colSpan = Math.floor(canvasW / cs);
  const rowSpan = Math.floor(canvasH / cs);
  const mapW = world.width * cs;
  const mapH = world.height * cs;

  let ox: number;
  let camX: number;
  if (mapW <= canvasW) {
    ox = (canvasW - mapW) / 2; // whole map fits horizontally -> center it
    camX = 0;
  } else {
    camX = clampCam(vp.camX, colSpan, world.width);
    ox = -camX * cs; // camX columns scrolled off the left
  }

  let oy: number;
  let camY: number;
  if (mapH <= canvasH) {
    oy = (canvasH - mapH) / 2;
    camY = 0;
  } else {
    camY = clampCam(vp.camY, rowSpan, world.height);
    oy = -camY * cs;
  }

  return { cs, ox, oy, camX, camY, colSpan, rowSpan };
}

// NOTE: with the centering offset, the screen-x of cell column `x` is `ox + x*cs` (ox already
// folds in -camX*cs when scrolled). visibleCellRange returns the cell window to iterate.
export interface CellRange {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function visibleCellRange(
  vp: Viewport,
  canvasW: number,
  canvasH: number,
  world: { width: number; height: number },
): CellRange {
  const t = viewTransform(vp, canvasW, canvasH, world);
  const x0 = t.camX;
  const y0 = t.camY;
  const x1 = Math.min(world.width, x0 + t.colSpan + 1);
  const y1 = Math.min(world.height, y0 + t.rowSpan + 1);
  return { x0, y0, x1, y1 };
}

// Pixel (mx,my) on the canvas -> cell coords, or null if outside the actual map extent.
export function screenToCell(
  vp: Viewport,
  canvasW: number,
  canvasH: number,
  world: { width: number; height: number },
  mx: number,
  my: number,
): { x: number; y: number } | null {
  const t = viewTransform(vp, canvasW, canvasH, world);
  const x = Math.floor((mx - t.ox) / t.cs);
  const y = Math.floor((my - t.oy) / t.cs);
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return null;
  return { x, y };
}

export function pan(
  vp: Viewport,
  dx: number,
  dy: number,
  world: { width: number; height: number },
  canvasW = 0,
  canvasH = 0,
): Viewport {
  const cs = cellSize(vp);
  const colSpan = canvasW > 0 ? Math.floor(canvasW / cs) : 1;
  const rowSpan = canvasH > 0 ? Math.floor(canvasH / cs) : 1;
  return {
    ...vp,
    camX: clampCam(vp.camX + dx, colSpan, world.width),
    camY: clampCam(vp.camY + dy, rowSpan, world.height),
  };
}

export function setZoom(vp: Viewport, zoom: ZoomLevel): Viewport {
  return { ...vp, zoom };
}

// Center the camera on a cell (used to focus on the player start / largest blob).
export function centerOn(
  vp: Viewport,
  cx: number,
  cy: number,
  world: { width: number; height: number },
  canvasW: number,
  canvasH: number,
): Viewport {
  const cs = cellSize(vp);
  const colSpan = Math.floor(canvasW / cs);
  const rowSpan = Math.floor(canvasH / cs);
  return {
    ...vp,
    camX: clampCam(cx - Math.floor(colSpan / 2), colSpan, world.width),
    camY: clampCam(cy - Math.floor(rowSpan / 2), rowSpan, world.height),
  };
}
