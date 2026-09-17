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
  const boxRect = result.state === 'lost' ? lastKnownRect : result.rect;
  drawTrajectory(ctx, trajectory);
  drawEventMarkers(ctx, events);
  drawBoundingBox(ctx, result, boxRect);
  drawConfidenceBar(ctx, result);
  drawStateBadge(ctx, result, boxRect);
}

function drawTrajectory(ctx: CanvasRenderingContext2D, trajectory: readonly { x: number; y: number; state: TrackState }[]): void {
  if (trajectory.length === 0) return;
  if (trajectory.length >= 2) {
    ctx.save();
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.55;
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

  // Dot marking the current position, drawn fully opaque on top of the trajectory.
  const last = trajectory[trajectory.length - 1];
  ctx.save();
  ctx.fillStyle = STATE_COLOR[last.state];
  ctx.beginPath();
  ctx.arc(last.x, last.y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = 1;
  ctx.stroke();
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

/** Traces a rounded-rectangle path (anti-aliased corners) into the current path without stroking/filling it. */
function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

function drawBoundingBox(ctx: CanvasRenderingContext2D, result: TrackResult, rect: Rect): void {
  ctx.save();
  ctx.strokeStyle = STATE_COLOR[result.state];
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  if (result.state === 'lost') ctx.setLineDash([8, 6]);
  roundedRectPath(ctx, rect.x, rect.y, rect.width, rect.height, 6);
  ctx.stroke();
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

/** Small state label anchored just above (or, if there's no room, below) the tracked box. */
function drawStateBadge(ctx: CanvasRenderingContext2D, result: TrackResult, rect: Rect): void {
  const label = `${result.state.toUpperCase()} · frame ${result.frameIndex}`;
  ctx.save();
  ctx.font = 'bold 12px system-ui, sans-serif';
  const paddingX = 7;
  const textWidth = ctx.measureText(label).width;
  const boxWidth = textWidth + paddingX * 2;
  const boxHeight = 20;
  const margin = 6;
  let x = rect.x;
  let y = rect.y - boxHeight - margin;
  if (y < 0) y = rect.y + rect.height + margin;
  x = Math.max(2, Math.min(x, ctx.canvas.width - boxWidth - 2));
  ctx.fillStyle = STATE_COLOR[result.state];
  ctx.fillRect(x, y, boxWidth, boxHeight);
  ctx.fillStyle = '#0b1120';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + paddingX, y + boxHeight / 2 + 1);
  ctx.restore();
}
