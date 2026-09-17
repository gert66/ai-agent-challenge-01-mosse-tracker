/**
 * Pure, DOM-free aggregation of tracker output. Kept separate from
 * src/app/ui.ts so these functions can be unit-tested directly under
 * vitest without touching the browser.
 */
import type { TrackResult } from '../tracker/mosse';

export interface MetricsSnapshot {
  framesProcessed: number;
  /** Percentage (0..100) of processed frames with state != 'lost'. */
  trackedFramePct: number;
  /** Number of transitions from a non-lost state into 'lost'. */
  lostEvents: number;
  /** Number of frames reported with state === 'recovered'. */
  recoveries: number;
  meanPsr: number;
  minPsr: number;
  /** Mean tracker throughput in frames/second, from recorded per-frame processing durations. */
  processingFps: number;
}

export interface TrajectoryEvent {
  frameIndex: number;
  type: 'lost' | 'recovered';
  center: { x: number; y: number };
}

export function trackedFramePercentage(results: readonly Pick<TrackResult, 'state'>[]): number {
  if (results.length === 0) return 0;
  const tracked = results.filter((r) => r.state !== 'lost').length;
  return (tracked / results.length) * 100;
}

export function countLostEvents(results: readonly Pick<TrackResult, 'state'>[]): number {
  let count = 0;
  let prevLost = false;
  for (const r of results) {
    const isLost = r.state === 'lost';
    if (isLost && !prevLost) count++;
    prevLost = isLost;
  }
  return count;
}

export function countRecoveries(results: readonly Pick<TrackResult, 'state'>[]): number {
  return results.filter((r) => r.state === 'recovered').length;
}

export function meanPsr(results: readonly Pick<TrackResult, 'psr'>[]): number {
  if (results.length === 0) return 0;
  return results.reduce((sum, r) => sum + r.psr, 0) / results.length;
}

export function minPsr(results: readonly Pick<TrackResult, 'psr'>[]): number {
  if (results.length === 0) return 0;
  return results.reduce((m, r) => Math.min(m, r.psr), Infinity);
}

export function processingFps(frameDurationsMs: readonly number[]): number {
  if (frameDurationsMs.length === 0) return 0;
  const meanMs = frameDurationsMs.reduce((sum, v) => sum + v, 0) / frameDurationsMs.length;
  return meanMs > 0 ? 1000 / meanMs : 0;
}

export interface LostSpan {
  startFrameIndex: number;
  endFrameIndex: number;
}

/** Contiguous runs of `state === 'lost'` frames, for shading a confidence timeline. */
export function computeLostSpans(results: readonly Pick<TrackResult, 'state' | 'frameIndex'>[]): LostSpan[] {
  const spans: LostSpan[] = [];
  let start: number | null = null;
  let last = -1;
  for (const r of results) {
    if (r.state === 'lost') {
      if (start === null) start = r.frameIndex;
      last = r.frameIndex;
    } else if (start !== null) {
      spans.push({ startFrameIndex: start, endFrameIndex: last });
      start = null;
    }
  }
  if (start !== null) spans.push({ startFrameIndex: start, endFrameIndex: last });
  return spans;
}

/** Marks the frame where each lost/recovered transition happened, for overlay annotation. */
export function extractTrajectoryEvents(results: readonly TrackResult[]): TrajectoryEvent[] {
  const events: TrajectoryEvent[] = [];
  let prevLost = false;
  for (const r of results) {
    const isLost = r.state === 'lost';
    if (isLost && !prevLost) {
      events.push({ frameIndex: r.frameIndex, type: 'lost', center: r.center });
    }
    if (r.state === 'recovered') {
      events.push({ frameIndex: r.frameIndex, type: 'recovered', center: r.center });
    }
    prevLost = isLost;
  }
  return events;
}

/** Accumulates TrackResults and per-frame processing time, and reduces them to a MetricsSnapshot. */
export class MetricsAggregator {
  private results: TrackResult[] = [];
  private frameDurationsMs: number[] = [];

  record(result: TrackResult, durationMs: number): void {
    this.results.push(result);
    this.frameDurationsMs.push(durationMs);
  }

  reset(): void {
    this.results = [];
    this.frameDurationsMs = [];
  }

  getResults(): readonly TrackResult[] {
    return this.results;
  }

  snapshot(): MetricsSnapshot {
    return {
      framesProcessed: this.results.length,
      trackedFramePct: trackedFramePercentage(this.results),
      lostEvents: countLostEvents(this.results),
      recoveries: countRecoveries(this.results),
      meanPsr: meanPsr(this.results),
      minPsr: minPsr(this.results),
      processingFps: processingFps(this.frameDurationsMs),
    };
  }
}
