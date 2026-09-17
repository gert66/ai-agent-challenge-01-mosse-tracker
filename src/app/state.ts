import type { Rect } from '../tracker/mosse';

export interface VideoManifestEntry {
  id: string;
  title: string;
  file: string;
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  durationSeconds: number;
  description: string;
  codec: string;
  pixFmt: string;
}

export interface VideoManifest {
  videos: VideoManifestEntry[];
}

export type AppPhase =
  | 'loading' // fetching manifest, or a video is being fetched/decoded
  | 'error' // the current video failed to load
  | 'select' // video loaded, first frame shown, waiting for a selection
  | 'ready' // a target rect is selected, tracking not yet started
  | 'tracking' // actively stepping through frames
  | 'paused' // tracking started, currently paused mid-video
  | 'finished'; // reached end of video

/**
 * Per-video preset target rectangles (in video-pixel coordinates), found by
 * inspecting each video's first frame (see docs/APP.md). Lets the demo and
 * any future E2E tests run without manual dragging.
 */
export const SUGGESTED_BOXES: Record<string, Rect> = {
  synthetic_easy: { x: 36, y: 126, width: 80, height: 54 },
  synthetic_occlusion: { x: 36, y: 130, width: 80, height: 50 },
  vtest: { x: 250, y: 205, width: 65, height: 130 },
};

export const MIN_SELECTION_SIZE = 16;
