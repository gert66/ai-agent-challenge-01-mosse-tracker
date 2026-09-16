import { MosseTracker, toGray, type Rect, type TrackResult, type TrackState } from '../tracker/mosse';
import { MetricsAggregator, extractTrajectoryEvents } from './metrics';
import { drawSelectionRect, drawTrackingOverlay } from './overlay';
import { bumpRunToken, createRunToken, isRunCurrent } from './runToken';
import { MIN_SELECTION_SIZE, SUGGESTED_BOXES, type AppPhase, type VideoManifestEntry } from './state';
import { loadManifest, seekTo, videoUrl, waitForLoadedData } from './video';

interface TrajectoryPoint {
  x: number;
  y: number;
  state: TrackState;
}

interface Elements {
  videoSelect: HTMLSelectElement;
  canvas: HTMLCanvasElement;
  video: HTMLVideoElement;
  hint: HTMLParagraphElement;
  btnSuggest: HTMLButtonElement;
  btnReselect: HTMLButtonElement;
  btnStart: HTMLButtonElement;
  btnPause: HTMLButtonElement;
  btnStep: HTMLButtonElement;
  btnReset: HTMLButtonElement;
  speedSelect: HTMLSelectElement;
  stateBadge: HTMLDivElement;
  metricFrames: HTMLElement;
  metricTrackedPct: HTMLElement;
  metricLostEvents: HTMLElement;
  metricRecoveries: HTMLElement;
  metricMeanPsr: HTMLElement;
  metricMinPsr: HTMLElement;
  metricFps: HTMLElement;
}

function queryElements(root: ParentNode): Elements {
  const byId = <T extends Element>(id: string): T => {
    const el = root.querySelector<T>(`#${id}`);
    if (!el) throw new Error(`missing element #${id}`);
    return el;
  };
  const byTestId = <T extends Element>(testId: string): T => {
    const el = root.querySelector<T>(`[data-testid="${testId}"]`);
    if (!el) throw new Error(`missing element [data-testid="${testId}"]`);
    return el;
  };
  return {
    videoSelect: byId('video-select'),
    canvas: byId('canvas'),
    video: byId('source-video'),
    hint: byId('hint'),
    btnSuggest: byId('btn-suggest'),
    btnReselect: byId('btn-reselect'),
    btnStart: byId('btn-start'),
    btnPause: byId('btn-pause'),
    btnStep: byId('btn-step'),
    btnReset: byId('btn-reset'),
    speedSelect: byId('speed-select'),
    stateBadge: byId('state-badge'),
    metricFrames: byTestId('metric-frames'),
    metricTrackedPct: byTestId('metric-tracked-pct'),
    metricLostEvents: byTestId('metric-lost-events'),
    metricRecoveries: byTestId('metric-recoveries'),
    metricMeanPsr: byTestId('metric-mean-psr'),
    metricMinPsr: byTestId('metric-min-psr'),
    metricFps: byTestId('metric-fps'),
  };
}

function clampRect(rect: Rect, frameWidth: number, frameHeight: number): Rect {
  const x = Math.max(0, Math.min(rect.x, frameWidth - MIN_SELECTION_SIZE));
  const y = Math.max(0, Math.min(rect.y, frameHeight - MIN_SELECTION_SIZE));
  const width = Math.min(rect.width, frameWidth - x);
  const height = Math.min(rect.height, frameHeight - y);
  return { x, y, width, height };
}

export async function initApp(root: Document = document): Promise<void> {
  const el = queryElements(root);
  const ctx2d = el.canvas.getContext('2d');
  if (!ctx2d) throw new Error('2D canvas context unavailable');
  const ctx: CanvasRenderingContext2D = ctx2d;

  const baseUrl = import.meta.env.BASE_URL;
  const manifest = await loadManifest(baseUrl);

  // Optional `?maxFrames=N` bounds how many frames a run processes, e.g. so
  // an e2e test can exercise the full flow on vtest.mp4 (795 frames) without
  // waiting for a full real-time-scale run. Does not affect the UI/manifest.
  const maxFramesOverride: number | null = (() => {
    const raw = new URLSearchParams(window.location.search).get('maxFrames');
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  })();

  function effectiveFrameCount(entry: VideoManifestEntry): number {
    return maxFramesOverride ? Math.min(entry.frameCount, maxFramesOverride) : entry.frameCount;
  }

  let currentEntry: VideoManifestEntry = manifest.videos[0];
  let phase: AppPhase = 'loading';
  let selectionRect: Rect | null = null;
  let dragStart: { x: number; y: number } | null = null;
  let dragRect: Rect | null = null;
  let tracker: MosseTracker | null = null;
  let trajectory: TrajectoryPoint[] = [];
  let metrics = new MetricsAggregator();
  let frameIndex = 0; // index of the frame currently drawn on the canvas
  let playing = false;
  const runToken = createRunToken();

  /**
   * Invalidates any in-flight run (a pending seek inside the tracking loop,
   * loadVideo, Reset, or Re-select) and returns the id of the new run that
   * the caller is about to start. Call this from Reset, Re-select, a video
   * switch, and Pause — the only actions that tear down `tracker`/selection
   * state out from under an awaited operation.
   */
  function invalidateCurrentRun(): number {
    playing = false;
    return bumpRunToken(runToken);
  }

  for (const entry of manifest.videos) {
    const option = document.createElement('option');
    option.value = entry.id;
    option.textContent = entry.title;
    el.videoSelect.appendChild(option);
  }

  function setHint(text: string): void {
    el.hint.textContent = text;
  }

  function setBadge(text: string, cssClass: string): void {
    el.stateBadge.textContent = text;
    el.stateBadge.className = `state-badge ${cssClass}`;
  }

  function renderMetrics(): void {
    const snap = metrics.snapshot();
    el.metricFrames.textContent = String(snap.framesProcessed);
    el.metricTrackedPct.textContent = `${snap.trackedFramePct.toFixed(1)}%`;
    el.metricLostEvents.textContent = String(snap.lostEvents);
    el.metricRecoveries.textContent = String(snap.recoveries);
    el.metricMeanPsr.textContent = snap.meanPsr.toFixed(1);
    el.metricMinPsr.textContent = Number.isFinite(snap.minPsr) ? snap.minPsr.toFixed(1) : '0.0';
    el.metricFps.textContent = snap.processingFps.toFixed(1);
  }

  function updateControls(): void {
    const hasSelection = selectionRect !== null;
    el.btnStart.disabled = !(phase === 'ready' || phase === 'paused');
    el.btnPause.disabled = phase !== 'tracking';
    el.btnStep.disabled = !((phase === 'ready' || phase === 'paused') && hasSelection);
    el.btnReset.disabled = phase === 'select' || phase === 'loading';
    el.btnSuggest.disabled = phase === 'loading' || phase === 'tracking';
    el.btnReselect.disabled = phase === 'loading' || phase === 'tracking';

    switch (phase) {
      case 'loading':
        setBadge('LOADING', 'state-badge-idle');
        break;
      case 'select':
        setBadge('SELECT TARGET', 'state-badge-idle');
        break;
      case 'ready':
        setBadge('READY', 'state-badge-idle');
        break;
      case 'tracking':
      case 'paused':
        // left to renderTrackingState() once a TrackResult exists
        break;
      case 'finished':
        setBadge('FINISHED', 'state-badge-finished');
        break;
    }
  }

  function renderTrackingState(result: TrackResult): void {
    const label = `${result.state.toUpperCase()} · frame ${result.frameIndex}`;
    setBadge(label, `state-badge-${result.state}`);
  }

  function drawCurrentFrame(): void {
    ctx.drawImage(el.video, 0, 0, el.canvas.width, el.canvas.height);
  }

  function drawSelectionState(): void {
    drawCurrentFrame();
    if (dragRect) {
      drawSelectionRect({ ctx, rect: dragRect });
    } else if (selectionRect) {
      drawSelectionRect({ ctx, rect: selectionRect });
    }
  }

  /**
   * Seeks to frame `idx`. Only updates `frameIndex` if `myRunId` is still
   * current when the seek resolves — otherwise a newer run (Reset,
   * Re-select, or a video switch) has already superseded this one, and the
   * (possibly stale/coalesced) 'seeked' event must not overwrite state.
   */
  async function seekToFrame(idx: number, myRunId: number): Promise<void> {
    const clamped = Math.max(0, Math.min(idx, effectiveFrameCount(currentEntry) - 1));
    const time = (clamped + 0.5) / currentEntry.fps;
    await seekTo(el.video, Math.min(time, el.video.duration || time));
    if (!isRunCurrent(runToken, myRunId)) return;
    frameIndex = clamped;
  }

  async function loadVideo(entry: VideoManifestEntry): Promise<void> {
    const myRunId = invalidateCurrentRun();
    phase = 'loading';
    updateControls();

    currentEntry = entry;
    selectionRect = null;
    dragRect = null;
    dragStart = null;
    tracker = null;
    trajectory = [];
    metrics = new MetricsAggregator();
    renderMetrics();

    el.canvas.width = entry.width;
    el.canvas.height = entry.height;

    el.video.src = videoUrl(baseUrl, entry.file);
    el.video.load();
    await waitForLoadedData(el.video);
    if (!isRunCurrent(runToken, myRunId)) return;
    await seekToFrame(0, myRunId);
    if (!isRunCurrent(runToken, myRunId)) return;

    phase = 'select';
    setHint('Drag a box around the object in the first frame, or click "Use suggested box".');
    drawSelectionState();
    updateControls();
  }

  function applySelection(rect: Rect): void {
    selectionRect = clampRect(rect, currentEntry.width, currentEntry.height);
    dragRect = null;
    phase = 'ready';
    setHint('Target selected. Press Start to begin tracking, or drag again to change it.');
    drawSelectionState();
    updateControls();
  }

  function canvasPointFromEvent(evt: PointerEvent): { x: number; y: number } {
    const bounds = el.canvas.getBoundingClientRect();
    const scaleX = el.canvas.width / bounds.width;
    const scaleY = el.canvas.height / bounds.height;
    const x = (evt.clientX - bounds.left) * scaleX;
    const y = (evt.clientY - bounds.top) * scaleY;
    return {
      x: Math.max(0, Math.min(x, el.canvas.width)),
      y: Math.max(0, Math.min(y, el.canvas.height)),
    };
  }

  function rectFromDrag(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const width = Math.abs(a.x - b.x);
    const height = Math.abs(a.y - b.y);
    return { x, y, width, height };
  }

  el.canvas.addEventListener('pointerdown', (evt) => {
    if (phase !== 'select' && phase !== 'ready') return;
    el.canvas.setPointerCapture(evt.pointerId);
    dragStart = canvasPointFromEvent(evt);
    dragRect = { x: dragStart.x, y: dragStart.y, width: 0, height: 0 };
  });

  el.canvas.addEventListener('pointermove', (evt) => {
    if (!dragStart) return;
    dragRect = rectFromDrag(dragStart, canvasPointFromEvent(evt));
    drawSelectionState();
  });

  el.canvas.addEventListener('pointerup', (evt) => {
    if (!dragStart) return;
    const end = canvasPointFromEvent(evt);
    const rect = rectFromDrag(dragStart, end);
    dragStart = null;
    el.canvas.releasePointerCapture(evt.pointerId);
    if (rect.width < MIN_SELECTION_SIZE || rect.height < MIN_SELECTION_SIZE) {
      dragRect = null;
      setHint(`Selection too small — drag a box at least ${MIN_SELECTION_SIZE}x${MIN_SELECTION_SIZE}px.`);
      drawSelectionState();
      return;
    }
    applySelection(rect);
  });

  el.btnSuggest.addEventListener('click', () => {
    const preset = SUGGESTED_BOXES[currentEntry.id];
    if (!preset) return;
    applySelection(preset);
  });

  el.btnReselect.addEventListener('click', async () => {
    const myRunId = invalidateCurrentRun();
    tracker = null;
    trajectory = [];
    metrics = new MetricsAggregator();
    renderMetrics();
    selectionRect = null;
    dragRect = null;
    await seekToFrame(0, myRunId);
    if (!isRunCurrent(runToken, myRunId)) return;
    phase = 'select';
    setHint('Drag a box around the object in the first frame, or click "Use suggested box".');
    drawSelectionState();
    updateControls();
  });

  function ensureTrackerInitialized(): void {
    if (tracker || !selectionRect) return;
    drawCurrentFrame();
    const imageData = ctx.getImageData(0, 0, el.canvas.width, el.canvas.height);
    const gray = toGray(imageData.data, el.canvas.width, el.canvas.height);
    tracker = new MosseTracker();
    tracker.init(gray, selectionRect);
    trajectory = [
      {
        x: selectionRect.x + selectionRect.width / 2,
        y: selectionRect.y + selectionRect.height / 2,
        state: 'tracking',
      },
    ];
  }

  async function processNextFrame(myRunId: number): Promise<boolean> {
    if (!selectionRect) return false;
    ensureTrackerInitialized();
    if (!tracker) return false;
    if (frameIndex >= effectiveFrameCount(currentEntry) - 1) return false;

    await seekToFrame(frameIndex + 1, myRunId);
    if (!isRunCurrent(runToken, myRunId) || !tracker) return false;
    drawCurrentFrame();
    const imageData = ctx.getImageData(0, 0, el.canvas.width, el.canvas.height);
    const gray = toGray(imageData.data, el.canvas.width, el.canvas.height);

    const t0 = performance.now();
    const result = tracker.update(gray);
    const durationMs = performance.now() - t0;

    metrics.record(result, durationMs);
    trajectory.push({ x: result.center.x, y: result.center.y, state: result.state });

    const lastKnownRect =
      result.state === 'lost'
        ? (trajectoryLastNonLostRect() ?? result.rect)
        : result.rect;

    drawTrackingOverlay({
      ctx,
      result,
      trajectory,
      events: extractTrajectoryEvents(metrics.getResults()),
      lastKnownRect,
    });
    renderMetrics();
    renderTrackingState(result);

    return frameIndex < effectiveFrameCount(currentEntry) - 1;
  }

  function trajectoryLastNonLostRect(): Rect | null {
    const results = metrics.getResults();
    for (let i = results.length - 1; i >= 0; i--) {
      if (results[i].state !== 'lost') return results[i].rect;
    }
    return selectionRect;
  }

  function currentSpeedDelayMs(): number {
    const value = Number(el.speedSelect.value);
    if (!value) return 0; // "max"
    const frameIntervalMs = 1000 / currentEntry.fps;
    return frameIntervalMs / value;
  }

  async function playLoop(myRunId: number): Promise<void> {
    while (playing && isRunCurrent(runToken, myRunId)) {
      const more = await processNextFrame(myRunId);
      if (!isRunCurrent(runToken, myRunId)) return;
      if (!more) {
        playing = false;
        phase = 'finished';
        setHint('Reached the end of the video.');
        updateControls();
        return;
      }
      phase = 'tracking';
      updateControls();
      const delay = currentSpeedDelayMs();
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (!isRunCurrent(runToken, myRunId)) return;
    }
  }

  el.btnStart.addEventListener('click', () => {
    if (!selectionRect) return;
    if (playing) return;
    playing = true;
    phase = 'tracking';
    updateControls();
    void playLoop(runToken.id);
  });

  el.btnPause.addEventListener('click', () => {
    invalidateCurrentRun();
    phase = 'paused';
    setHint('Paused.');
    updateControls();
  });

  el.btnStep.addEventListener('click', async () => {
    if (playing) return;
    const myRunId = runToken.id;
    const more = await processNextFrame(myRunId);
    if (!isRunCurrent(runToken, myRunId)) return;
    phase = more ? 'paused' : 'finished';
    if (!more) setHint('Reached the end of the video.');
    updateControls();
  });

  el.btnReset.addEventListener('click', async () => {
    const myRunId = invalidateCurrentRun();
    tracker = null;
    trajectory = [];
    metrics = new MetricsAggregator();
    renderMetrics();
    await seekToFrame(0, myRunId);
    if (!isRunCurrent(runToken, myRunId)) return;
    if (selectionRect) {
      phase = 'ready';
      setHint('Target selected. Press Start to begin tracking, or drag again to change it.');
    } else {
      phase = 'select';
      setHint('Drag a box around the object in the first frame, or click "Use suggested box".');
    }
    drawSelectionState();
    updateControls();
  });

  el.videoSelect.addEventListener('change', () => {
    const entry = manifest.videos.find((v) => v.id === el.videoSelect.value);
    if (entry) void loadVideo(entry);
  });

  el.videoSelect.value = currentEntry.id;
  await loadVideo(currentEntry);
}
