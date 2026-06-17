// Typed-array <-> base64 helpers that work in both browser and node (vitest).

function toBin(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return bin;
}

// btoa/atob are globals in browsers and Node 16+ (vitest node env).
const b64 = {
  encode: (bin: string): string => btoa(bin),
  decode: (s: string): string => atob(s),
};

export function encodeF32(arr: Float32Array): string {
  return b64.encode(toBin(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)));
}

export function encodeI32(arr: Int32Array): string {
  return b64.encode(toBin(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)));
}

export function encodeU8(arr: Uint8Array): string {
  return b64.encode(toBin(arr));
}

function decodeBytes(s: string): Uint8Array {
  const bin = b64.decode(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function decodeF32(s: string): Float32Array {
  return new Float32Array(decodeBytes(s).buffer);
}

export function decodeI32(s: string): Int32Array {
  return new Int32Array(decodeBytes(s).buffer);
}

export function decodeU8(s: string): Uint8Array {
  return decodeBytes(s);
}
