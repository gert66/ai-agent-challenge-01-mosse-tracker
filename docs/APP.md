# Browser app

This document describes `src/app/` and `src/main.ts` — the interactive
browser UI built on top of the pure-TypeScript tracker in `src/tracker/`
(see `docs/ALGORITHM.md` for the tracker itself).

## Modules

- `src/app/state.ts` — shared types (`AppPhase`, `VideoManifestEntry`) and
  the per-video suggested-box presets (`SUGGESTED_BOXES`).
- `src/app/video.ts` — manifest fetching and two DOM `<video>` helpers,
  `waitForLoadedData` and `seekTo`, both promise-wrapped event listeners.
- `src/app/metrics.ts` — pure, DOM-free aggregation of `TrackResult`s
  (tracked-frame %, lost/recovery counts, mean/min PSR, processing fps) and
  `MetricsAggregator`, a small stateful accumulator around those functions.
  Unit-tested in `tests/unit/metrics.test.ts` without touching the DOM.
- `src/app/overlay.ts` — canvas drawing routines for the selection
  rectangle, bounding box, trajectory, event markers, confidence bar, and
  state badge. Pure functions of `(ctx, data)`.
- `src/app/timeline.ts` — the PSR-over-time chart. `frameToX`, `psrToY`,
  and `psrChartMax` are pure layout-math functions (unit-tested in
  `tests/unit/timeline.test.ts`); `drawPsrTimeline` is a thin canvas-drawing
  wrapper around them, in the same `(ctx, data)` style as `overlay.ts`. It
  is fed only by `MetricsAggregator.getResults()` (via
  `computeLostSpans` in `metrics.ts` for the shaded lost spans) — no DOM
  queries.
- `src/app/ui.ts` — wires the DOM (`index.html` elements) to the tracker,
  video element, and the modules above; owns all mutable app state.
- `src/main.ts` — entry point; calls `initApp()` and renders a fallback
  error message if startup fails (e.g. no manifest, no video codec support).

## UI elements added in the polish pass

- **Video description** (`data-testid="video-description"`) — the current
  video's title and description from `manifest.json`, shown under the
  toolbar.
- **Frame progress** (`data-testid="frame-progress"`) — a `frame N / total`
  readout plus a native `<progress>` bar, updated every processed frame
  (`N` is 1-based, so it reads `frame total / total` once finished).
- **PSR timeline** (`data-testid="psr-timeline"`) — a small canvas chart of
  PSR per processed frame, with a dashed line at the tracker's
  `psrLostThreshold` (from `DEFAULT_MOSSE_OPTIONS` in `src/tracker/mosse.ts`)
  and shaded spans over contiguous lost runs. Redrawn once per processed
  frame, same as the main overlay — no extra render loop.
- **Legend** (`data-testid="legend"`) — explains the box/trajectory/marker
  colours used both on the canvas overlay and in the CSS state badges. The
  hex values are shared conceptually (not literally, since one is TS canvas
  code and the other CSS) via the `--state-tracking` / `--state-recovered`
  / `--state-lost` custom properties in `src/styles.css`, which match
  `STATE_COLOR` in `src/app/overlay.ts` exactly.
- **Loading / error states** — while a video is loading, a spinner overlay
  covers the canvas and playback/selection controls are disabled
  (`el.stageLoading`, toggled by `updateControls()`). If the browser
  reports a media error instead of `loadeddata` (see the `waitForLoadedData`
  rejection path in `src/app/video.ts`), a banner
  (`data-testid="error-banner"`) replaces it with a message instead of
  letting the failure surface as a console error; the app moves to a new
  `'error'` `AppPhase` (`src/app/state.ts`) until a different video is
  selected.

## Keyboard shortcuts

- **Space** — Start if ready/paused, Pause if tracking.
- **ArrowRight** — Step one frame (same as the Step button; a no-op if
  disabled).
- **R** — Reset.

Shortcuts are ignored while a `<select>`, `<input>`, or `<textarea>` has
focus, so they don't fight with, e.g., the video/speed dropdowns. They work
by calling `.click()` on the corresponding button element, so there is a
single source of truth for what each action does — the button's own click
handler — and disabled buttons naturally no-op. A one-line reminder of the
shortcuts is shown in the Playback panel.

## Frame processing: seek-and-sample, not real-time playback

Frames are processed by **seeking** the hidden `<video>` element to
`(frameIndex + 0.5) / fps`, awaiting its `seeked` event, drawing it to the
visible canvas, and reading pixels back with `getImageData`. This was
chosen over playing the video in real time and sampling via
`requestVideoFrameCallback` / `requestAnimationFrame` for two reasons:

1. **Frame-accuracy.** MOSSE's PSR-based lost/recovered state and the
   reported `frameIndex` need to line up 1:1 with actual video frames.
   Real-time playback sampling can skip or repeat frames depending on
   display refresh rate vs. video fps (especially awkward for `vtest`'s
   10fps against a 60Hz+ display), which would make metrics like
   tracked-frame % depend on the viewer's hardware. Seeking to
   `(i + 0.5) / fps` deterministically lands inside frame `i` regardless of
   playback hardware.
2. **Determinism for the demo and any future automated (e.g. Playwright)
   checks.** The same video processed twice produces byte-identical
   `TrackResult` sequences, since the tracker is deterministic and the
   input frames are always sampled at the same points in time.

The tradeoff is throughput: each processed frame pays for a seek
round-trip, so wall-clock speed is bounded by the browser's seek latency,
not the tracker's own (much faster) per-frame cost — this is why the
`processingFps` metric measures only `tracker.update()` time via
`performance.now()`, not seek time. On the 795-frame `vtest` clip this
means the on-screen "Start" run takes tens of seconds of real time even at
"max" speed, while the reported PSR/state numbers are exactly what a
real-time tracker would have produced frame-for-frame. This is an accepted
tradeoff for a correctness-first demo; a production system processing
video in real time would run the tracker inside a
`requestVideoFrameCallback` loop directly on the decoded frame instead.

The "speed" control (0.5x/1x/2x/max) only affects the artificial delay
inserted **between** processed frames during automatic playback (to make
slow/fast demo pacing visible); it does not affect the seek-and-sample
mechanism or the tracker's own timing.

## Coordinate systems

The display `<canvas>` is sized to the video's *intrinsic* pixel
dimensions (`canvas.width`/`canvas.height` = manifest `width`/`height`) and
scaled to fit the layout purely via CSS (`max-width: 100%; height: auto`),
which preserves aspect ratio. All drawing (overlay, selection) happens in
canvas-pixel space, which is therefore always equal to video-pixel space.
Pointer events are converted from CSS pixels to canvas pixels using the
ratio `canvas.width / boundingClientRect.width` (and the `height`
equivalent) — see `canvasPointFromEvent` in `src/app/ui.ts`.

## Suggested target boxes

`SUGGESTED_BOXES` in `src/app/state.ts` was derived by extracting frame 0
of each video (via the `ffmpeg-static` binary already used by
`scripts/prepare-videos.mjs`) and either scanning for the object's
distinct color (the two synthetic clips: an orange rectangle against a
light-gray background, found by thresholding pixel color difference from
the background) or visual inspection (`vtest`: one pedestrian, chosen by
eye and refined by cropping candidate regions). These are the boxes used
by "Use suggested box" and are a fixed, one-time-computed constant — no
per-run frame inspection happens in the app itself.

## Manual verification performed

Built and served via `npm run build && npm run preview`, then driven with
the committed Playwright suite (`tests/e2e/`, see `docs/TESTING.md`) that:
loads each of the three videos, clicks "Use suggested box", runs to
completion at max speed, and also exercises manual drag-selection, Step,
Pause, Reset, Re-select, and video switching (including mid-playback, to
cover the run-token guard in `src/app/ui.ts`). No console errors are
observed in any run. Tracked-frame percentage is ~97% for
`synthetic_occlusion` — its suggested box was chosen (see
`SUGGESTED_BOXES` below) so the camera motion genuinely occludes the
target around frame 106–110, producing a real lost→recovered transition
rather than tracking through it uneventfully — and 100% for
`synthetic_easy` (comfortably above the >90% bar for `synthetic_easy`).
