// Deterministic, serializable PRNG (Mulberry32). Worker-owned.

export type RngState = number;

export interface RNG {
  next(): number; // float in [0,1)
  nextInt(maxExclusive: number): number;
  getState(): RngState;
  setState(s: RngState): void;
  fork(salt: number): RNG;
}

function mix32(a: number): number {
  a |= 0;
  a = (a + 0x9e3779b9) | 0;
  let t = a ^ (a >>> 16);
  t = Math.imul(t, 0x21f0aaad);
  t = t ^ (t >>> 15);
  t = Math.imul(t, 0x735a2d97);
  return (t ^ (t >>> 15)) >>> 0;
}

class Mulberry32 implements RNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  nextInt(maxExclusive: number): number {
    if (maxExclusive <= 0) return 0;
    return Math.floor(this.next() * maxExclusive);
  }

  getState(): RngState {
    return this.state >>> 0;
  }

  setState(s: RngState): void {
    this.state = s >>> 0;
  }

  fork(salt: number): RNG {
    return new Mulberry32(mix32(this.state ^ mix32(salt)));
  }
}

export function makeRng(seed: number): RNG {
  return new Mulberry32(mix32(seed));
}
