import { describe, expect, it } from 'vitest';
import {
  computeLostSpans,
  countLostEvents,
  countRecoveries,
  extractTrajectoryEvents,
  meanPsr,
  MetricsAggregator,
  minPsr,
  processingFps,
  trackedFramePercentage,
} from '../../src/app/metrics';
import type { TrackResult, TrackState } from '../../src/tracker/mosse';

function makeResult(frameIndex: number, state: TrackState, psr: number, center = { x: 0, y: 0 }): TrackResult {
  return {
    rect: { x: center.x - 5, y: center.y - 5, width: 10, height: 10 },
    center,
    psr,
    confidence: state === 'lost' ? 0 : 1,
    state,
    frameIndex,
  };
}

describe('trackedFramePercentage', () => {
  it('returns 0 for an empty series', () => {
    expect(trackedFramePercentage([])).toBe(0);
  });

  it('counts tracking and recovered as tracked, lost as not tracked', () => {
    const results = [
      makeResult(1, 'tracking', 20),
      makeResult(2, 'lost', 2),
      makeResult(3, 'lost', 2),
      makeResult(4, 'recovered', 15),
    ];
    expect(trackedFramePercentage(results)).toBe(50);
  });
});

describe('countLostEvents', () => {
  it('counts only transitions into lost, not consecutive lost frames', () => {
    const results = [
      makeResult(1, 'tracking', 20),
      makeResult(2, 'lost', 2),
      makeResult(3, 'lost', 2),
      makeResult(4, 'recovered', 15),
      makeResult(5, 'tracking', 20),
      makeResult(6, 'lost', 2),
    ];
    expect(countLostEvents(results)).toBe(2);
  });

  it('returns 0 when never lost', () => {
    const results = [makeResult(1, 'tracking', 20), makeResult(2, 'tracking', 18)];
    expect(countLostEvents(results)).toBe(0);
  });
});

describe('countRecoveries', () => {
  it('counts frames explicitly reported as recovered', () => {
    const results = [
      makeResult(1, 'lost', 2),
      makeResult(2, 'recovered', 15),
      makeResult(3, 'tracking', 20),
      makeResult(4, 'lost', 2),
      makeResult(5, 'recovered', 14),
    ];
    expect(countRecoveries(results)).toBe(2);
  });
});

describe('meanPsr / minPsr', () => {
  it('computes mean and min across all frames', () => {
    const results = [makeResult(1, 'tracking', 10), makeResult(2, 'tracking', 20), makeResult(3, 'lost', 2)];
    expect(meanPsr(results)).toBeCloseTo((10 + 20 + 2) / 3);
    expect(minPsr(results)).toBe(2);
  });

  it('returns 0 for empty input', () => {
    expect(meanPsr([])).toBe(0);
    expect(minPsr([])).toBe(0);
  });
});

describe('processingFps', () => {
  it('derives fps from mean per-frame duration', () => {
    expect(processingFps([10, 10, 10])).toBeCloseTo(100);
  });

  it('returns 0 when no durations recorded', () => {
    expect(processingFps([])).toBe(0);
  });
});

describe('extractTrajectoryEvents', () => {
  it('emits a lost event on the first lost frame and a recovered event on recovery', () => {
    const results = [
      makeResult(1, 'tracking', 20, { x: 1, y: 1 }),
      makeResult(2, 'lost', 2, { x: 2, y: 2 }),
      makeResult(3, 'lost', 2, { x: 2, y: 2 }),
      makeResult(4, 'recovered', 15, { x: 4, y: 4 }),
    ];
    const events = extractTrajectoryEvents(results);
    expect(events).toEqual([
      { frameIndex: 2, type: 'lost', center: { x: 2, y: 2 } },
      { frameIndex: 4, type: 'recovered', center: { x: 4, y: 4 } },
    ]);
  });
});

describe('computeLostSpans', () => {
  it('returns no spans when never lost', () => {
    const results = [makeResult(1, 'tracking', 20), makeResult(2, 'tracking', 18)];
    expect(computeLostSpans(results)).toEqual([]);
  });

  it('collapses a contiguous lost run into a single span', () => {
    const results = [
      makeResult(1, 'tracking', 20),
      makeResult(2, 'lost', 2),
      makeResult(3, 'lost', 2),
      makeResult(4, 'lost', 2),
      makeResult(5, 'recovered', 15),
    ];
    expect(computeLostSpans(results)).toEqual([{ startFrameIndex: 2, endFrameIndex: 4 }]);
  });

  it('emits one span per separate lost run', () => {
    const results = [
      makeResult(1, 'lost', 2),
      makeResult(2, 'tracking', 20),
      makeResult(3, 'lost', 2),
      makeResult(4, 'lost', 2),
    ];
    expect(computeLostSpans(results)).toEqual([
      { startFrameIndex: 1, endFrameIndex: 1 },
      { startFrameIndex: 3, endFrameIndex: 4 },
    ]);
  });

  it('closes a span still open at the end of the series', () => {
    const results = [makeResult(1, 'tracking', 20), makeResult(2, 'lost', 2), makeResult(3, 'lost', 2)];
    expect(computeLostSpans(results)).toEqual([{ startFrameIndex: 2, endFrameIndex: 3 }]);
  });

  it('returns no spans for an empty series', () => {
    expect(computeLostSpans([])).toEqual([]);
  });
});

describe('MetricsAggregator', () => {
  it('accumulates results and durations into a consistent snapshot', () => {
    const agg = new MetricsAggregator();
    agg.record(makeResult(1, 'tracking', 20), 5);
    agg.record(makeResult(2, 'lost', 2), 5);
    agg.record(makeResult(3, 'recovered', 15), 5);

    const snap = agg.snapshot();
    expect(snap.framesProcessed).toBe(3);
    expect(snap.trackedFramePct).toBeCloseTo((2 / 3) * 100);
    expect(snap.lostEvents).toBe(1);
    expect(snap.recoveries).toBe(1);
    expect(snap.meanPsr).toBeCloseTo((20 + 2 + 15) / 3);
    expect(snap.minPsr).toBe(2);
    expect(snap.processingFps).toBeCloseTo(200);
  });

  it('reset() clears accumulated state', () => {
    const agg = new MetricsAggregator();
    agg.record(makeResult(1, 'tracking', 20), 5);
    agg.reset();
    const snap = agg.snapshot();
    expect(snap.framesProcessed).toBe(0);
    expect(snap.trackedFramePct).toBe(0);
  });
});
