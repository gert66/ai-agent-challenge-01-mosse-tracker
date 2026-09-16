/**
 * Hand-written radix-2 Cooley-Tukey FFT (no runtime dependency).
 *
 * All buffers use Float64Array for accumulation precision. Sizes passed to
 * the 1D/2D transforms MUST be powers of two; use nextPow2() to pad.
 */

export interface ComplexPlanes {
  real: Float64Array;
  imag: Float64Array;
}

/** Smallest power of two >= n (n <= 0 yields 1). */
export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function isPow2(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

/**
 * In-place iterative radix-2 Cooley-Tukey FFT on a single row/column of
 * length n (must be a power of two). When `invert` is true this computes
 * the inverse transform (including the 1/n normalisation).
 */
export function fft1d(real: Float64Array, imag: Float64Array, invert: boolean): void {
  const n = real.length;
  if (imag.length !== n) {
    throw new Error('fft1d: real and imag buffers must have the same length');
  }
  if (!isPow2(n)) {
    throw new Error(`fft1d: length ${n} is not a power of two`);
  }

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      const tr = real[i];
      real[i] = real[j];
      real[j] = tr;
      const ti = imag[i];
      imag[i] = imag[j];
      imag[j] = ti;
    }
  }

  // Iterative butterfly passes.
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = (invert ? 2 : -2) * Math.PI / len;
    const wReal = Math.cos(ang);
    const wImag = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curReal = 1;
      let curImag = 0;
      for (let j = 0; j < half; j++) {
        const evenIdx = i + j;
        const oddIdx = evenIdx + half;
        const oddReal = real[oddIdx];
        const oddImag = imag[oddIdx];
        const vReal = oddReal * curReal - oddImag * curImag;
        const vImag = oddReal * curImag + oddImag * curReal;
        const uReal = real[evenIdx];
        const uImag = imag[evenIdx];
        real[evenIdx] = uReal + vReal;
        imag[evenIdx] = uImag + vImag;
        real[oddIdx] = uReal - vReal;
        imag[oddIdx] = uImag - vImag;
        const nextReal = curReal * wReal - curImag * wImag;
        const nextImag = curReal * wImag + curImag * wReal;
        curReal = nextReal;
        curImag = nextImag;
      }
    }
  }

  if (invert) {
    for (let i = 0; i < n; i++) {
      real[i] /= n;
      imag[i] /= n;
    }
  }
}

/**
 * In-place 2D FFT (rows then columns) over a width*height buffer pair.
 * width and height must independently be powers of two.
 */
export function fft2d(
  real: Float64Array,
  imag: Float64Array,
  width: number,
  height: number,
  invert: boolean,
): void {
  const len = width * height;
  if (real.length !== len || imag.length !== len) {
    throw new Error('fft2d: buffer size does not match width*height');
  }

  const rowReal = new Float64Array(width);
  const rowImag = new Float64Array(width);
  for (let y = 0; y < height; y++) {
    const offset = y * width;
    for (let x = 0; x < width; x++) {
      rowReal[x] = real[offset + x];
      rowImag[x] = imag[offset + x];
    }
    fft1d(rowReal, rowImag, invert);
    for (let x = 0; x < width; x++) {
      real[offset + x] = rowReal[x];
      imag[offset + x] = rowImag[x];
    }
  }

  const colReal = new Float64Array(height);
  const colImag = new Float64Array(height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      colReal[y] = real[y * width + x];
      colImag[y] = imag[y * width + x];
    }
    fft1d(colReal, colImag, invert);
    for (let y = 0; y < height; y++) {
      real[y * width + x] = colReal[y];
      imag[y * width + x] = colImag[y];
    }
  }
}

/** Forward 2D FFT of real-valued data; leaves `data` untouched. */
export function forwardFFT2D(
  data: Float32Array | Float64Array,
  width: number,
  height: number,
): ComplexPlanes {
  const real = Float64Array.from(data);
  const imag = new Float64Array(width * height);
  fft2d(real, imag, width, height, false);
  return { real, imag };
}

/** Inverse 2D FFT; leaves the input planes untouched. */
export function inverseFFT2D(
  real: Float64Array,
  imag: Float64Array,
  width: number,
  height: number,
): ComplexPlanes {
  const outReal = Float64Array.from(real);
  const outImag = Float64Array.from(imag);
  fft2d(outReal, outImag, width, height, true);
  return { real: outReal, imag: outImag };
}

/** out = a * b (complex, elementwise). out may alias a or b. */
export function complexMultiply(
  aRe: Float64Array,
  aIm: Float64Array,
  bRe: Float64Array,
  bIm: Float64Array,
  outRe: Float64Array,
  outIm: Float64Array,
): void {
  for (let i = 0; i < aRe.length; i++) {
    const re = aRe[i] * bRe[i] - aIm[i] * bIm[i];
    const im = aRe[i] * bIm[i] + aIm[i] * bRe[i];
    outRe[i] = re;
    outIm[i] = im;
  }
}

/** out = a * conj(b) (complex, elementwise). out may alias a or b. */
export function complexMultiplyConj(
  aRe: Float64Array,
  aIm: Float64Array,
  bRe: Float64Array,
  bIm: Float64Array,
  outRe: Float64Array,
  outIm: Float64Array,
): void {
  for (let i = 0; i < aRe.length; i++) {
    const re = aRe[i] * bRe[i] + aIm[i] * bIm[i];
    const im = aIm[i] * bRe[i] - aRe[i] * bIm[i];
    outRe[i] = re;
    outIm[i] = im;
  }
}

/**
 * out = a / (b + lambda), where lambda is a real-valued regularisation term
 * added only to the real part of the denominator (MOSSE's H* = A / (B + λ)).
 * out may alias a or b.
 */
export function complexDivide(
  aRe: Float64Array,
  aIm: Float64Array,
  bRe: Float64Array,
  bIm: Float64Array,
  lambda: number,
  outRe: Float64Array,
  outIm: Float64Array,
): void {
  for (let i = 0; i < aRe.length; i++) {
    const denomRe = bRe[i] + lambda;
    const denomIm = bIm[i];
    const denom = denomRe * denomRe + denomIm * denomIm;
    outRe[i] = (aRe[i] * denomRe + aIm[i] * denomIm) / denom;
    outIm[i] = (aIm[i] * denomRe - aRe[i] * denomIm) / denom;
  }
}

/** a += b (complex, elementwise, in place). */
export function complexAddInPlace(
  aRe: Float64Array,
  aIm: Float64Array,
  bRe: Float64Array,
  bIm: Float64Array,
): void {
  for (let i = 0; i < aRe.length; i++) {
    aRe[i] += bRe[i];
    aIm[i] += bIm[i];
  }
}

/** re,im *= scalar (in place). */
export function complexScaleInPlace(re: Float64Array, im: Float64Array, scalar: number): void {
  for (let i = 0; i < re.length; i++) {
    re[i] *= scalar;
    im[i] *= scalar;
  }
}
