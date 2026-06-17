// Seeded spatially-autocorrelated value-noise terrain -> foodYield / rawYield arrays.

import { CONFIG, RNG_SALT } from '../config';
import { makeRng } from './rng';

export interface TerrainArrays {
  foodYield: Float32Array;
  rawYield: Float32Array;
}

function hash2(ix: number, iy: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263)) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const v00 = hash2(x0, y0, seed);
  const v10 = hash2(x0 + 1, y0, seed);
  const v01 = hash2(x0, y0 + 1, seed);
  const v11 = hash2(x0 + 1, y0 + 1, seed);
  const top = v00 + (v10 - v00) * fx;
  const bot = v01 + (v11 - v01) * fx;
  return top + (bot - top) * fy;
}

function fbm(x: number, y: number, seed: number): number {
  let amp = 1;
  let freq = CONFIG.NOISE_FREQUENCY;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < CONFIG.NOISE_OCTAVES; o++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + o * 1013);
    norm += amp;
    amp *= CONFIG.NOISE_GAIN;
    freq *= CONFIG.NOISE_LACUNARITY;
  }
  return sum / norm; // [0,1]
}

export function generateTerrain(seed: number, width: number, height: number): TerrainArrays {
  const rng = makeRng(seed).fork(RNG_SALT.TERRAIN);
  const foodSeed = rng.getState() ^ 0xa53;
  const rawSeed = (rng.getState() ^ 0x1f7) + 999;
  const foodYield = new Float32Array(width * height);
  const rawYield = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      foodYield[i] = fbm(x, y, foodSeed) * CONFIG.FOOD_YIELD_MAX;
      rawYield[i] = fbm(x + 4096, y + 4096, rawSeed) * CONFIG.RAW_YIELD_MAX;
    }
  }
  return { foodYield, rawYield };
}
