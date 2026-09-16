/**
 * MOSSE (Minimum Output Sum of Squared Error) correlation-filter tracker.
 *
 * Reference: D. S. Bolme, J. R. Beveridge, B. A. Draper, Y. M. Lui,
 * "Visual Object Tracking using Adaptive Correlation Filters", CVPR 2010.
 *
 * This module is pure TypeScript with no DOM/browser API references so it
 * can be unit-tested under Node/vitest and reused verbatim from a Web
 * Worker or the main thread.
 */

import { complexAddInPlace, complexDivide, complexMultiply, complexMultiplyConj, fft2d, nextPow2 } from './fft';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Grayscale frame. `data` holds luma values in the 0..255 range (see toGray). */
export interface GrayFrame {
  data: Float32Array;
  width: number;
  height: number;
}

export type TrackState = 'tracking' | 'lost' | 'recovered';

export interface TrackResult {
  rect: Rect;
  center: { x: number; y: number };
  psr: number;
  /** 0..1, monotone in PSR: clamp((psr - lostThreshold) / (goodThreshold - lostThreshold), 0, 1). */
  confidence: number;
  state: TrackState;
  frameIndex: number;
}

export interface MosseOptions {
  learningRate: number;
  lambda: number;
  sigma: number;
  numWarps: number;
  psrLostThreshold: number;
  psrGoodThreshold: number;
  minLostFramesToDeclare: number;
  /** Filter window size scale relative to the selected rect, before power-of-two padding. */
  searchWindowScale: number;
  /** Seed for the deterministic PRNG used to generate training warps. */
  seed: number;
}

export const DEFAULT_MOSSE_OPTIONS: MosseOptions = {
  learningRate: 0.125,
  lambda: 1e-4,
  sigma: 2.0,
  numWarps: 8,
  psrLostThreshold: 6.0,
  psrGoodThreshold: 12.0,
  minLostFramesToDeclare: 1,
  searchWindowScale: 1.0,
  seed: 0x5eed1234,
};

/** Deterministic PRNG (mulberry32) returning floats in [0, 1). */
export function createPrng(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** rgba (from ImageData) -> grayscale luma frame, values in 0..255. */
export function toGray(rgba: Uint8ClampedArray, width: number, height: number): GrayFrame {
  const data = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i++, p += 4) {
    data[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
  }
  return { data, width, height };
}

interface AffineTransform {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

const IDENTITY_TRANSFORM: AffineTransform = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

function randomAffineWarp(prng: () => number): AffineTransform {
  const rotation = (prng() * 2 - 1) * 0.2; // +/- 0.2 rad
  const scale = 0.9 + prng() * 0.2; // 0.9 .. 1.1
  const tx = (prng() * 2 - 1) * 2; // +/- 2 px
  const ty = (prng() * 2 - 1) * 2; // +/- 2 px
  const cos = Math.cos(rotation) * scale;
  const sin = Math.sin(rotation) * scale;
  return { a: cos, b: -sin, c: sin, d: cos, tx, ty };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function bilinearSample(frame: GrayFrame, x: number, y: number): number {
  const w = frame.width;
  const h = frame.height;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const cx0 = clamp(x0, 0, w - 1);
  const cx1 = clamp(x0 + 1, 0, w - 1);
  const cy0 = clamp(y0, 0, h - 1);
  const cy1 = clamp(y0 + 1, 0, h - 1);
  const v00 = frame.data[cy0 * w + cx0];
  const v10 = frame.data[cy0 * w + cx1];
  const v01 = frame.data[cy1 * w + cx0];
  const v11 = frame.data[cy1 * w + cx1];
  const top = v00 + (v10 - v00) * fx;
  const bottom = v01 + (v11 - v01) * fx;
  return top + (bottom - top) * fy;
}

/** Extract a w*h patch centered at (cx, cy), optionally warped, with clamped borders. */
function extractPatch(
  frame: GrayFrame,
  cx: number,
  cy: number,
  w: number,
  h: number,
  transform: AffineTransform,
): Float64Array {
  const out = new Float64Array(w * h);
  const halfW = w / 2;
  const halfH = h / 2;
  for (let y = 0; y < h; y++) {
    const ly = y - halfH;
    for (let x = 0; x < w; x++) {
      const lx = x - halfW;
      const srcX = cx + transform.tx + transform.a * lx + transform.b * ly;
      const srcY = cy + transform.ty + transform.c * lx + transform.d * ly;
      out[y * w + x] = bilinearSample(frame, srcX, srcY);
    }
  }
  return out;
}

function build2DHanning(w: number, h: number): Float64Array {
  const hx = new Float64Array(w);
  const hy = new Float64Array(h);
  for (let x = 0; x < w; x++) {
    hx[x] = w > 1 ? 0.5 * (1 - Math.cos((2 * Math.PI * x) / (w - 1))) : 1;
  }
  for (let y = 0; y < h; y++) {
    hy[y] = h > 1 ? 0.5 * (1 - Math.cos((2 * Math.PI * y) / (h - 1))) : 1;
  }
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[y * w + x] = hx[x] * hy[y];
    }
  }
  return out;
}

/** Gaussian peak at (0,0) with circular wraparound, matching the FFT's origin convention. */
function buildGaussianTarget(w: number, h: number, sigma: number): Float64Array {
  const out = new Float64Array(w * h);
  const denom = 2 * sigma * sigma;
  for (let y = 0; y < h; y++) {
    const dy = Math.min(y, h - y);
    for (let x = 0; x < w; x++) {
      const dx = Math.min(x, w - x);
      out[y * w + x] = Math.exp(-(dx * dx + dy * dy) / denom);
    }
  }
  return out;
}

/** log(1+x), zero-mean/unit-variance normalisation, then a Hanning window. */
function preprocessPatch(patch: Float64Array, hanning: Float64Array): Float64Array {
  const n = patch.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = Math.log1p(Math.max(patch[i], 0));
  }
  let mean = 0;
  for (let i = 0; i < n; i++) mean += out[i];
  mean /= n;
  let variance = 0;
  for (let i = 0; i < n; i++) {
    const d = out[i] - mean;
    variance += d * d;
  }
  variance /= n;
  const std = Math.sqrt(variance) + 1e-5;
  for (let i = 0; i < n; i++) {
    out[i] = ((out[i] - mean) / std) * hanning[i];
  }
  return out;
}

function wrapIndex(i: number, n: number): number {
  return ((i % n) + n) % n;
}

function parabolicOffset(fm1: number, f0: number, fp1: number): number {
  const denom = fm1 - 2 * f0 + fp1;
  if (denom === 0) return 0;
  const offset = (0.5 * (fm1 - fp1)) / denom;
  return clamp(offset, -1, 1);
}

interface PeakInfo {
  /** Signed displacement (with circular wraparound resolved), sub-pixel refined. */
  dx: number;
  dy: number;
  psr: number;
}

/** Locate the correlation response peak, sub-pixel refine it, and compute the PSR. */
function analyzeResponse(response: Float64Array, w: number, h: number): PeakInfo {
  let peakIdx = 0;
  let peakValue = -Infinity;
  for (let i = 0; i < response.length; i++) {
    if (response[i] > peakValue) {
      peakValue = response[i];
      peakIdx = i;
    }
  }
  const px = peakIdx % w;
  const py = Math.floor(peakIdx / w);

  const left = response[py * w + wrapIndex(px - 1, w)];
  const right = response[py * w + wrapIndex(px + 1, w)];
  const up = response[wrapIndex(py - 1, h) * w + px];
  const down = response[wrapIndex(py + 1, h) * w + px];
  const deltaX = parabolicOffset(left, peakValue, right);
  const deltaY = parabolicOffset(up, peakValue, down);

  const refinedX = px + deltaX;
  const refinedY = py + deltaY;
  const dx = refinedX > w / 2 ? refinedX - w : refinedX;
  const dy = refinedY > h / 2 ? refinedY - h : refinedY;

  const excludeRadius = 5; // 11x11 window around the peak
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 0; y < h; y++) {
    const distY = Math.min(Math.abs(y - py), h - Math.abs(y - py));
    for (let x = 0; x < w; x++) {
      const distX = Math.min(Math.abs(x - px), w - Math.abs(x - px));
      if (distX <= excludeRadius && distY <= excludeRadius) continue;
      const v = response[y * w + x];
      sum += v;
      sumSq += v * v;
      count++;
    }
  }
  const mean = count > 0 ? sum / count : 0;
  const variance = count > 0 ? sumSq / count - mean * mean : 0;
  const std = Math.sqrt(Math.max(variance, 0));
  const psr = (peakValue - mean) / (std + 1e-6);

  return { dx, dy, psr };
}

export class MosseTracker {
  private readonly options: MosseOptions;

  private initialized = false;
  private rect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  private windowWidth = 0;
  private windowHeight = 0;
  private hanning: Float64Array = new Float64Array(0);
  private targetFftRe: Float64Array = new Float64Array(0);
  private targetFftIm: Float64Array = new Float64Array(0);
  private aRe: Float64Array = new Float64Array(0);
  private aIm: Float64Array = new Float64Array(0);
  private bRe: Float64Array = new Float64Array(0);
  private bIm: Float64Array = new Float64Array(0);
  private hRe: Float64Array = new Float64Array(0);
  private hIm: Float64Array = new Float64Array(0);

  private state: TrackState = 'tracking';
  private psr = 0;
  private lostStreak = 0;
  private frameIndex = 0;

  constructor(options: Partial<MosseOptions> = {}) {
    this.options = { ...DEFAULT_MOSSE_OPTIONS, ...options };
  }

  init(frame: GrayFrame, rect: Rect): void {
    this.rect = { ...rect };
    this.windowWidth = nextPow2(Math.max(8, Math.round(rect.width * this.options.searchWindowScale)));
    this.windowHeight = nextPow2(Math.max(8, Math.round(rect.height * this.options.searchWindowScale)));
    const len = this.windowWidth * this.windowHeight;

    this.hanning = build2DHanning(this.windowWidth, this.windowHeight);

    const target = buildGaussianTarget(this.windowWidth, this.windowHeight, this.options.sigma);
    this.targetFftRe = Float64Array.from(target);
    this.targetFftIm = new Float64Array(len);
    fft2d(this.targetFftRe, this.targetFftIm, this.windowWidth, this.windowHeight, false);

    const prng = createPrng(this.options.seed);
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;

    this.aRe = new Float64Array(len);
    this.aIm = new Float64Array(len);
    this.bRe = new Float64Array(len);
    this.bIm = new Float64Array(len);

    const prodRe = new Float64Array(len);
    const prodIm = new Float64Array(len);

    for (let i = 0; i < this.options.numWarps; i++) {
      const transform = i === 0 ? IDENTITY_TRANSFORM : randomAffineWarp(prng);
      const patch = extractPatch(frame, cx, cy, this.windowWidth, this.windowHeight, transform);
      const pre = preprocessPatch(patch, this.hanning);
      const fRe = Float64Array.from(pre);
      const fIm = new Float64Array(len);
      fft2d(fRe, fIm, this.windowWidth, this.windowHeight, false);

      complexMultiplyConj(this.targetFftRe, this.targetFftIm, fRe, fIm, prodRe, prodIm);
      complexAddInPlace(this.aRe, this.aIm, prodRe, prodIm);

      complexMultiplyConj(fRe, fIm, fRe, fIm, prodRe, prodIm);
      complexAddInPlace(this.bRe, this.bIm, prodRe, prodIm);
    }

    this.hRe = new Float64Array(len);
    this.hIm = new Float64Array(len);
    complexDivide(this.aRe, this.aIm, this.bRe, this.bIm, this.options.lambda, this.hRe, this.hIm);

    this.initialized = true;
    this.state = 'tracking';
    this.psr = 0;
    this.lostStreak = 0;
    this.frameIndex = 0;
  }

  update(frame: GrayFrame): TrackResult {
    if (!this.initialized) {
      throw new Error('MosseTracker.update() called before init()');
    }
    this.frameIndex++;

    const len = this.windowWidth * this.windowHeight;
    const centerX = this.rect.x + this.rect.width / 2;
    const centerY = this.rect.y + this.rect.height / 2;

    const patch = extractPatch(frame, centerX, centerY, this.windowWidth, this.windowHeight, IDENTITY_TRANSFORM);
    const pre = preprocessPatch(patch, this.hanning);
    const fRe = Float64Array.from(pre);
    const fIm = new Float64Array(len);
    fft2d(fRe, fIm, this.windowWidth, this.windowHeight, false);

    const respRe = new Float64Array(len);
    const respIm = new Float64Array(len);
    complexMultiply(fRe, fIm, this.hRe, this.hIm, respRe, respIm);
    fft2d(respRe, respIm, this.windowWidth, this.windowHeight, true);

    const { dx, dy, psr } = analyzeResponse(respRe, this.windowWidth, this.windowHeight);
    this.psr = psr;

    const wasLost = this.lostStreak >= this.options.minLostFramesToDeclare;

    if (psr >= this.options.psrLostThreshold) {
      const newCenterX = centerX + dx;
      const newCenterY = centerY + dy;
      this.rect = {
        x: newCenterX - this.rect.width / 2,
        y: newCenterY - this.rect.height / 2,
        width: this.rect.width,
        height: this.rect.height,
      };

      const updatePatch = extractPatch(frame, newCenterX, newCenterY, this.windowWidth, this.windowHeight, IDENTITY_TRANSFORM);
      const updatePre = preprocessPatch(updatePatch, this.hanning);
      const fRe2 = Float64Array.from(updatePre);
      const fIm2 = new Float64Array(len);
      fft2d(fRe2, fIm2, this.windowWidth, this.windowHeight, false);

      const newARe = new Float64Array(len);
      const newAIm = new Float64Array(len);
      complexMultiplyConj(this.targetFftRe, this.targetFftIm, fRe2, fIm2, newARe, newAIm);
      const newBRe = new Float64Array(len);
      const newBIm = new Float64Array(len);
      complexMultiplyConj(fRe2, fIm2, fRe2, fIm2, newBRe, newBIm);

      const lr = this.options.learningRate;
      for (let i = 0; i < len; i++) {
        this.aRe[i] = (1 - lr) * this.aRe[i] + lr * newARe[i];
        this.aIm[i] = (1 - lr) * this.aIm[i] + lr * newAIm[i];
        this.bRe[i] = (1 - lr) * this.bRe[i] + lr * newBRe[i];
        this.bIm[i] = (1 - lr) * this.bIm[i] + lr * newBIm[i];
      }
      complexDivide(this.aRe, this.aIm, this.bRe, this.bIm, this.options.lambda, this.hRe, this.hIm);

      this.lostStreak = 0;
      this.state = wasLost ? 'recovered' : 'tracking';
    } else {
      this.lostStreak++;
      this.state = this.lostStreak >= this.options.minLostFramesToDeclare ? 'lost' : 'tracking';
    }

    const confidenceRange = this.options.psrGoodThreshold - this.options.psrLostThreshold;
    const confidence = clamp((psr - this.options.psrLostThreshold) / confidenceRange, 0, 1);

    return {
      rect: { ...this.rect },
      center: { x: this.rect.x + this.rect.width / 2, y: this.rect.y + this.rect.height / 2 },
      psr,
      confidence,
      state: this.state,
      frameIndex: this.frameIndex,
    };
  }

  reset(): void {
    this.initialized = false;
    this.rect = { x: 0, y: 0, width: 0, height: 0 };
    this.windowWidth = 0;
    this.windowHeight = 0;
    this.hanning = new Float64Array(0);
    this.targetFftRe = new Float64Array(0);
    this.targetFftIm = new Float64Array(0);
    this.aRe = new Float64Array(0);
    this.aIm = new Float64Array(0);
    this.bRe = new Float64Array(0);
    this.bIm = new Float64Array(0);
    this.hRe = new Float64Array(0);
    this.hIm = new Float64Array(0);
    this.state = 'tracking';
    this.psr = 0;
    this.lostStreak = 0;
    this.frameIndex = 0;
  }

  getRect(): Rect {
    return { ...this.rect };
  }

  getState(): TrackState {
    return this.state;
  }

  getPsr(): number {
    return this.psr;
  }

  getLostStreak(): number {
    return this.lostStreak;
  }

  getFrameIndex(): number {
    return this.frameIndex;
  }
}
