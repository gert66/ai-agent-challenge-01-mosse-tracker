import { describe, expect, it } from 'vitest';
import { MosseTracker, createPrng, type GrayFrame } from '../../src/tracker/mosse';

const WIDTH = 200;
const HEIGHT = 150;
const SQUARE = 64;

function buildBackground(seed: number): Float32Array {
  const rng = createPrng(seed);
  const bg = new Float32Array(WIDTH * HEIGHT);
  for (let i = 0; i < bg.length; i++) bg[i] = 60 + rng() * 10;
  return bg;
}

/** Non-periodic, high-contrast texture (avoids aliasing a periodic pattern would cause). */
function buildSquareTexture(seed: number): Float32Array {
  const rng = createPrng(seed);
  const tex = new Float32Array(SQUARE * SQUARE);
  for (let i = 0; i < tex.length; i++) {
    tex[i] = 150 + rng() * 100;
  }
  return tex;
}

function buildNoisePatch(seed: number): Float32Array {
  const rng = createPrng(seed);
  const out = new Float32Array(SQUARE * SQUARE);
  for (let i = 0; i < out.length; i++) out[i] = rng() * 255;
  return out;
}

function blit(background: Float32Array, patch: Float32Array | null, squareX: number, squareY: number): GrayFrame {
  const data = Float32Array.from(background);
  if (patch) {
    for (let y = 0; y < SQUARE; y++) {
      const fy = squareY + y;
      if (fy < 0 || fy >= HEIGHT) continue;
      for (let x = 0; x < SQUARE; x++) {
        const fx = squareX + x;
        if (fx < 0 || fx >= WIDTH) continue;
        data[fy * WIDTH + fx] = patch[y * SQUARE + x];
      }
    }
  }
  return { data, width: WIDTH, height: HEIGHT };
}

describe('MosseTracker', () => {
  it('tracks 2px/frame motion within 1.5px over 30 frames', () => {
    const background = buildBackground(1);
    const texture = buildSquareTexture(2);
    const squareX0 = 40;
    const squareY0 = 40;

    const tracker = new MosseTracker({ seed: 42 });
    const initRect = { x: squareX0, y: squareY0, width: SQUARE, height: SQUARE };
    tracker.init(blit(background, texture, squareX0, squareY0), initRect);

    let goodPsrCount = 0;
    const numFrames = 30;
    for (let i = 1; i <= numFrames; i++) {
      const squareX = squareX0 + i * 2;
      const frame = blit(background, texture, squareX, squareY0);
      const result = tracker.update(frame);

      const gtCenterX = squareX + SQUARE / 2;
      const gtCenterY = squareY0 + SQUARE / 2;
      expect(Math.abs(result.center.x - gtCenterX)).toBeLessThanOrEqual(1.5);
      expect(Math.abs(result.center.y - gtCenterY)).toBeLessThanOrEqual(1.5);
      expect(result.state).toBe('tracking');
      expect(result.frameIndex).toBe(i);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);

      if (result.psr > 12.0) goodPsrCount++;
    }

    expect(goodPsrCount / numFrames).toBeGreaterThanOrEqual(0.7);
  });

  it('reports lost without drifting during a 10-frame occlusion, then recovers', () => {
    const background = buildBackground(3);
    const texture = buildSquareTexture(4);
    const squareX0 = 60;
    const squareY0 = 40;

    const tracker = new MosseTracker({ seed: 7 });
    const initRect = { x: squareX0, y: squareY0, width: SQUARE, height: SQUARE };
    tracker.init(blit(background, texture, squareX0, squareY0), initRect);

    // A few stationary, visible frames to confirm steady tracking before occlusion.
    let lastGoodRect = tracker.getRect();
    for (let i = 1; i <= 5; i++) {
      const result = tracker.update(blit(background, texture, squareX0, squareY0));
      expect(result.state).toBe('tracking');
      lastGoodRect = result.rect;
    }

    // 10 frames of occlusion: object covered by unrelated random noise.
    for (let i = 0; i < 10; i++) {
      const noisePatch = buildNoisePatch(1000 + i);
      const frame = blit(background, noisePatch, squareX0, squareY0);
      const result = tracker.update(frame);
      expect(result.state).toBe('lost');
      expect(Math.abs(result.rect.x - lastGoodRect.x)).toBeLessThanOrEqual(3);
      expect(Math.abs(result.rect.y - lastGoodRect.y)).toBeLessThanOrEqual(3);
    }

    // Object reappears at its last known position.
    const reappear1 = tracker.update(blit(background, texture, squareX0, squareY0));
    expect(reappear1.state).toBe('recovered');

    const reappear2 = tracker.update(blit(background, texture, squareX0, squareY0));
    expect(reappear2.state).toBe('tracking');
  });

  it('is deterministic: identical seed produces identical PSR sequences', () => {
    const background = buildBackground(5);
    const texture = buildSquareTexture(6);
    const squareX0 = 30;
    const squareY0 = 30;
    const initRect = { x: squareX0, y: squareY0, width: SQUARE, height: SQUARE };

    function runAndCollectPsr(): number[] {
      const tracker = new MosseTracker({ seed: 999 });
      tracker.init(blit(background, texture, squareX0, squareY0), initRect);
      const psrs: number[] = [];
      for (let i = 1; i <= 15; i++) {
        const frame = blit(background, texture, squareX0 + i * 2, squareY0);
        psrs.push(tracker.update(frame).psr);
      }
      return psrs;
    }

    const first = runAndCollectPsr();
    const second = runAndCollectPsr();
    expect(second).toEqual(first);
  });

  it('does not throw and returns finite values for a rect partly outside the frame', () => {
    const width = 60;
    const height = 50;
    const rng = createPrng(11);
    const data = new Float32Array(width * height);
    for (let i = 0; i < data.length; i++) data[i] = rng() * 255;
    const frame: GrayFrame = { data, width, height };

    const tracker = new MosseTracker({ seed: 13 });
    const rect = { x: -8, y: -6, width: 20, height: 20 };

    expect(() => tracker.init(frame, rect)).not.toThrow();

    const data2 = new Float32Array(width * height);
    for (let i = 0; i < data2.length; i++) data2[i] = rng() * 255;
    const frame2: GrayFrame = { data: data2, width, height };

    let result;
    expect(() => {
      result = tracker.update(frame2);
    }).not.toThrow();

    expect(result).toBeDefined();
    const r = result!;
    expect(Number.isFinite(r.rect.x)).toBe(true);
    expect(Number.isFinite(r.rect.y)).toBe(true);
    expect(Number.isFinite(r.rect.width)).toBe(true);
    expect(Number.isFinite(r.rect.height)).toBe(true);
    expect(Number.isFinite(r.center.x)).toBe(true);
    expect(Number.isFinite(r.center.y)).toBe(true);
    expect(Number.isFinite(r.psr)).toBe(true);
    expect(Number.isFinite(r.confidence)).toBe(true);
  });
});
