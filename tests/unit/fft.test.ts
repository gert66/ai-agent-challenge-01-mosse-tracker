import { describe, expect, it } from 'vitest';
import { fft1d, fft2d, nextPow2 } from '../../src/tracker/fft';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomArray(n: number, seed: number): Float64Array {
  const rng = mulberry32(seed);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = rng() * 2 - 1;
  return out;
}

/** Naive O(n^2) 1D DFT for cross-checking the fast transform. */
function naiveDft1d(real: Float64Array, imag: Float64Array, invert: boolean): { real: Float64Array; imag: Float64Array } {
  const n = real.length;
  const outRe = new Float64Array(n);
  const outIm = new Float64Array(n);
  const sign = invert ? 1 : -1;
  for (let k = 0; k < n; k++) {
    let sumRe = 0;
    let sumIm = 0;
    for (let t = 0; t < n; t++) {
      const ang = (sign * 2 * Math.PI * k * t) / n;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      sumRe += real[t] * c - imag[t] * s;
      sumIm += real[t] * s + imag[t] * c;
    }
    if (invert) {
      outRe[k] = sumRe / n;
      outIm[k] = sumIm / n;
    } else {
      outRe[k] = sumRe;
      outIm[k] = sumIm;
    }
  }
  return { real: outRe, imag: outIm };
}

function naiveDft2d(data: Float64Array, width: number, height: number): { real: Float64Array; imag: Float64Array } {
  const real = Float64Array.from(data);
  const imag = new Float64Array(width * height);
  // Rows
  for (let y = 0; y < height; y++) {
    const rowRe = real.slice(y * width, y * width + width);
    const rowIm = imag.slice(y * width, y * width + width);
    const { real: outRe, imag: outIm } = naiveDft1d(rowRe, rowIm, false);
    real.set(outRe, y * width);
    imag.set(outIm, y * width);
  }
  // Columns
  for (let x = 0; x < width; x++) {
    const colRe = new Float64Array(height);
    const colIm = new Float64Array(height);
    for (let y = 0; y < height; y++) {
      colRe[y] = real[y * width + x];
      colIm[y] = imag[y * width + x];
    }
    const { real: outRe, imag: outIm } = naiveDft1d(colRe, colIm, false);
    for (let y = 0; y < height; y++) {
      real[y * width + x] = outRe[y];
      imag[y * width + x] = outIm[y];
    }
  }
  return { real, imag };
}

function maxAbsDiff(a: Float64Array, b: Float64Array): number {
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    max = Math.max(max, Math.abs(a[i] - b[i]));
  }
  return max;
}

describe('nextPow2', () => {
  it('handles exact powers of two', () => {
    expect(nextPow2(1)).toBe(1);
    expect(nextPow2(2)).toBe(2);
    expect(nextPow2(16)).toBe(16);
    expect(nextPow2(1024)).toBe(1024);
  });

  it('rounds non-powers up', () => {
    expect(nextPow2(3)).toBe(4);
    expect(nextPow2(17)).toBe(32);
    expect(nextPow2(129)).toBe(256);
  });

  it('handles zero and negative input', () => {
    expect(nextPow2(0)).toBe(1);
    expect(nextPow2(-5)).toBe(1);
  });
});

describe('fft1d vs naive DFT', () => {
  it('matches a naive O(n^2) DFT on random real input, size 8', () => {
    const real = randomArray(8, 1);
    const imag = new Float64Array(8);
    const expected = naiveDft1d(real, imag, false);

    const gotRe = Float64Array.from(real);
    const gotIm = Float64Array.from(imag);
    fft1d(gotRe, gotIm, false);

    expect(maxAbsDiff(gotRe, expected.real)).toBeLessThan(1e-4);
    expect(maxAbsDiff(gotIm, expected.imag)).toBeLessThan(1e-4);
  });

  it('matches a naive O(n^2) DFT on random real input, size 64', () => {
    const real = randomArray(64, 2);
    const imag = new Float64Array(64);
    const expected = naiveDft1d(real, imag, false);

    const gotRe = Float64Array.from(real);
    const gotIm = Float64Array.from(imag);
    fft1d(gotRe, gotIm, false);

    expect(maxAbsDiff(gotRe, expected.real)).toBeLessThan(1e-4);
    expect(maxAbsDiff(gotIm, expected.imag)).toBeLessThan(1e-4);
  });

  it('throws for non-power-of-two length', () => {
    const real = new Float64Array(6);
    const imag = new Float64Array(6);
    expect(() => fft1d(real, imag, false)).toThrow();
  });
});

describe('fft2d vs naive 2D DFT', () => {
  it('matches a naive 2D DFT on random input, 16x32', () => {
    const width = 16;
    const height = 32;
    const data = randomArray(width * height, 3);
    const expected = naiveDft2d(data, width, height);

    const real = Float64Array.from(data);
    const imag = new Float64Array(width * height);
    fft2d(real, imag, width, height, false);

    expect(maxAbsDiff(real, expected.real)).toBeLessThan(1e-4);
    expect(maxAbsDiff(imag, expected.imag)).toBeLessThan(1e-4);
  });
});

describe('FFT/IFFT roundtrip', () => {
  it('reproduces 1D input within 1e-5', () => {
    const original = randomArray(32, 4);
    const real = Float64Array.from(original);
    const imag = new Float64Array(32);
    fft1d(real, imag, false);
    fft1d(real, imag, true);

    expect(maxAbsDiff(real, original)).toBeLessThan(1e-5);
    expect(maxAbsDiff(imag, new Float64Array(32))).toBeLessThan(1e-5);
  });

  it('reproduces 2D input within 1e-5', () => {
    const width = 8;
    const height = 16;
    const original = randomArray(width * height, 5);
    const real = Float64Array.from(original);
    const imag = new Float64Array(width * height);
    fft2d(real, imag, width, height, false);
    fft2d(real, imag, width, height, true);

    expect(maxAbsDiff(real, original)).toBeLessThan(1e-5);
  });
});
