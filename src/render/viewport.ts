// Pan/zoom state and viewport culling. camX/camY are the top-left visible cell (integers).

import { CONFIG } from '../config';

export interface Viewport {
  camX: number;
  camY: number;
  zoom: 1 | 2;
}

export function cellSize(vp: Viewport): number {
  return CONFIG.CELL_PX / vp.zoom; // zoom 1 -> 32px, zoom 2 -> 16px
}

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
  const cs = cellSize(vp);
  const cols = Math.ceil(canvasW / cs) + 1;
  const rows = Math.ceil(canvasH / cs) + 1;
  const x0 = Math.max(0, Math.min(vp.camX, world.width - 1));
  const y0 = Math.max(0, Math.min(vp.camY, world.height - 1));
  const x1 = Math.min(world.width, x0 + cols);
  const y1 = Math.min(world.height, y0 + rows);
  return { x0, y0, x1, y1 };
}

function clampCam(v: number, span: number, world: number): number {
  const maxCam = Math.max(0, world - span);
  return Math.max(0, Math.min(v, maxCam));
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

export function setZoom(vp: Viewport, zoom: 1 | 2): Viewport {
  return { ...vp, zoom };
}

// Center the camera on a cell (used to focus on the player start).
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
