/**
 * Confidence (PSR) timeline chart. The layout math (`frameToX`, `psrToY`,
 * `psrChartMax`) is pure and unit-tested in isolation; `drawPsrTimeline`
 * is a thin canvas-drawing wrapper around it, in the same style as
 * `overlay.ts` — a pure function of `(ctx, data)`.
 */
import type { TrackResult } from '../tracker/mosse';
import { computeLostSpans } from './metrics';

const PADDING = { top: 10, right: 6, bottom: 14, left: 22 };

/** Y-axis ceiling for the chart: comfortably above both the "good" threshold and any observed PSR spike. */
export function psrChartMax(results: readonly Pick<TrackResult, 'psr'>[], goodThreshold: number): number {
  const observedMax = results.reduce((m, r) => Math.max(m, r.psr), 0);
  return Math.max(goodThreshold * 1.25, observedMax * 1.1, 1);
}

/** Maps a frame index to an x pixel within a `plotWidth`-wide plot area, given the total frame count. */
export function frameToX(frameIndex: number, totalFrames: number, plotWidth: number): number {
  if (totalFrames <= 1) return 0;
  return (frameIndex / (totalFrames - 1)) * plotWidth;
}

/** Maps a PSR value to a y pixel within a `plotHeight`-tall plot area (0 at the bottom), clamped to `[0, maxPsr]`. */
export function psrToY(psr: number, maxPsr: number, plotHeight: number): number {
  const clamped = Math.max(0, Math.min(psr, maxPsr));
  return plotHeight - (clamped / maxPsr) * plotHeight;
}

export interface PsrTimelineInput {
  ctx: CanvasRenderingContext2D;
  results: readonly TrackResult[];
  totalFrames: number;
  lostThreshold: number;
  goodThreshold: number;
}

/** Draws the PSR-over-time line, the lost-threshold reference line, and shaded lost spans. */
export function drawPsrTimeline({ ctx, results, totalFrames, lostThreshold, goodThreshold }: PsrTimelineInput): void {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const plotWidth = Math.max(width - PADDING.left - PADDING.right, 1);
  const plotHeight = Math.max(height - PADDING.top - PADDING.bottom, 1);
  const maxPsr = psrChartMax(results, goodThreshold);
  const frames = Math.max(totalFrames, 1);

  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#0b1120';
  ctx.fillRect(0, 0, width, height);

  const spans = computeLostSpans(results);
  ctx.fillStyle = 'rgba(239, 68, 68, 0.22)';
  for (const span of spans) {
    const x0 = PADDING.left + frameToX(span.startFrameIndex, frames, plotWidth);
    const x1 = PADDING.left + frameToX(span.endFrameIndex, frames, plotWidth);
    ctx.fillRect(x0, PADDING.top, Math.max(x1 - x0, 2), plotHeight);
  }

  ctx.strokeStyle = 'rgba(226, 232, 240, 0.45)';
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1;
  const thresholdY = PADDING.top + psrToY(lostThreshold, maxPsr, plotHeight);
  ctx.beginPath();
  ctx.moveTo(PADDING.left, thresholdY);
  ctx.lineTo(PADDING.left + plotWidth, thresholdY);
  ctx.stroke();
  ctx.setLineDash([]);

  if (results.length > 0) {
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    results.forEach((r, i) => {
      const x = PADDING.left + frameToX(r.frameIndex, frames, plotWidth);
      const y = PADDING.top + psrToY(r.psr, maxPsr, plotHeight);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  ctx.fillStyle = '#94a3b8';
  ctx.font = '10px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText(maxPsr.toFixed(0), 2, PADDING.top - 2);
  ctx.fillText('0', 2, height - PADDING.bottom);
  ctx.restore();
}
