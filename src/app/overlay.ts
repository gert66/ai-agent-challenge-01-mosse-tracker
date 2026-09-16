import type { Rect, TrackResult, TrackState } from '../tracker/mosse';
import type { TrajectoryEvent } from './metrics';

const STATE_COLOR: Record<TrackState, string> = {
  tracking: '#22c55e',
  recovered: '#f59e0b',
  lost: '#ef4444',
};

export interface SelectionOverlayInput {
  ctx: CanvasRenderingContext2D;
  rect: Rect;
}

/** Live drag-selection rectangle, drawn while the user is dragging. */
export function drawSelectionRect({ ctx, rect }: SelectionOverlayInput): void {
  ctx.save();
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
}

export interface TrackingOverlayInput {
  ctx: CanvasRenderingContext2D;
  result: TrackResult;
  /** All centers tracked so far, in order, one per processed frame. */
  trajectory: readonly { x: number; y: number; state: TrackState }[];
  events: readonly TrajectoryEvent[];
  lastKnownRect: Rect;
}

/** Draws the bounding box, trajectory, event markers, confidence bar, and state badge for one frame. */
export function drawTrackingOverlay({ ctx, result, trajectory, events, lastKnownRect }: TrackingOverlayInput): void {
  drawTrajectory(ctx, trajectory);
  drawEventMarkers(ctx, events);
  drawBoundingBox(ctx, result, lastKnownRect);
  drawConfidenceBar(ctx, result);
  drawStateBadge(ctx, result);
}

function drawTrajectory(ctx: CanvasRenderingContext2D, trajectory: readonly { x: number; y: number; state: TrackState }[]): void {
  if (trajectory.length < 2) return;
  ctx.save();
  ctx.lineWidth = 2;
  for (let i = 1; i < trajectory.length; i++) {
    const prev = trajectory[i - 1];
    const curr = trajectory[i];
    ctx.strokeStyle = STATE_COLOR[curr.state];
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(curr.x, curr.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawEventMarkers(ctx: CanvasRenderingContext2D, events: readonly TrajectoryEvent[]): void {
  ctx.save();
  for (const ev of events) {
    ctx.beginPath();
    ctx.arc(ev.center.x, ev.center.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = ev.type === 'lost' ? '#ef4444' : '#f59e0b';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.restore();
}

function drawBoundingBox(ctx: CanvasRenderingContext2D, result: TrackResult, lastKnownRect: Rect): void {
  const rect = result.state === 'lost' ? lastKnownRect : result.rect;
  ctx.save();
  ctx.strokeStyle = STATE_COLOR[result.state];
  ctx.lineWidth = 3;
  if (result.state === 'lost') ctx.setLineDash([8, 6]);
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
}

function drawConfidenceBar(ctx: CanvasRenderingContext2D, result: TrackResult): void {
  const barWidth = 140;
  const barHeight = 12;
  const x = 10;
  const y = 10;
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(x - 4, y - 4, barWidth + 8, barHeight + 22);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.fillRect(x, y, barWidth, barHeight);
  ctx.fillStyle = STATE_COLOR[result.state];
  ctx.fillRect(x, y, barWidth * result.confidence, barHeight);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, barWidth, barHeight);

  ctx.fillStyle = '#ffffff';
  ctx.font = '12px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText(`PSR ${result.psr.toFixed(1)}`, x, y + barHeight + 4);
  ctx.restore();
}

function drawStateBadge(ctx: CanvasRenderingContext2D, result: TrackResult): void {
  const label = `${result.state.toUpperCase()} · frame ${result.frameIndex}`;
  ctx.save();
  ctx.font = 'bold 13px system-ui, sans-serif';
  const paddingX = 8;
  const textWidth = ctx.measureText(label).width;
  const boxWidth = textWidth + paddingX * 2;
  const boxHeight = 24;
  const x = ctx.canvas.width - boxWidth - 10;
  const y = 10;
  ctx.fillStyle = STATE_COLOR[result.state];
  ctx.fillRect(x, y, boxWidth, boxHeight);
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + paddingX, y + boxHeight / 2 + 1);
  ctx.restore();
}
