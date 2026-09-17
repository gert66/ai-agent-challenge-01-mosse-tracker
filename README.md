# 1. MOSSE Object Tracker

A browser app for selecting one object in the first frame of a video and
tracking it automatically through the rest of the clip, using a from-scratch
MOSSE correlation-filter tracker (no OpenCV, no ML). It shows a bounding
box, trajectory, PSR confidence, and lost/recovered status live over the
three supplied videos, plus a metrics panel (tracked-frame %, lost/recovery
counts, mean/min PSR, processing fps).

**Status:** feature-complete and demo-ready. See [FINAL_REPORT.md](FINAL_REPORT.md)
for the acceptance-criteria mapping, measured per-video results, and test
counts.

## Run it

```
npm install
npm run dev              # http://localhost:5173 — dev server with hot reload
```

or a production build:

```
npm run build
npm run preview          # http://localhost:48173 — serves dist/
```

Then open the app, pick a video, drag a box around the object in the first
frame (or click "Use suggested box" for a one-click demo), and press
Start. See `docs/APP.md` for how frame processing and coordinate mapping
work, and `docs/ALGORITHM.md` for the tracker itself.

## Testing

```
npm test          # unit tests (Vitest) — tracker, FFT, metrics, run-token guard
npm run test:e2e  # end-to-end tests (Playwright) — real browser, real videos
```

`npm run test:e2e` builds and serves the app itself (via
`playwright.config.ts`'s `webServer`) on `http://localhost:48173`, then
drives it in headless Chromium through the full load → select → track →
metrics flow for all three videos, plus drag selection and a regression
test for a Reset/Re-select/video-switch race. It requires a Playwright
browser to be installed once: `npx playwright install chromium`. See
`docs/TESTING.md` for what each spec covers, why port 48173, and known
limitations.

## Project layout

- `src/tracker/` — pure-TypeScript, DOM-independent MOSSE tracker core (`mosse.ts`, `fft.ts`).
- `src/app/` — browser UI: state machine (`ui.ts`), video loading (`video.ts`), canvas overlay (`overlay.ts`), PSR timeline (`timeline.ts`), metrics (`metrics.ts`), run-token race guard (`runToken.ts`).
- `tests/unit/` — Vitest unit tests for the tracker, FFT, metrics, timeline, and run-token guard.
- `tests/e2e/` — Playwright end-to-end tests driving a real browser against the built app.
- `scripts/` — `prepare-videos.mjs`, the one-time video transcoding script.
- `public/videos/` — browser-playable H.264 MP4s and `manifest.json`, generated from the source videos in the repo root.
- `docs/` — architecture and testing documentation (see below).

## Documentation

- [docs/ALGORITHM.md](docs/ALGORITHM.md) — the MOSSE tracker itself: preprocessing, filter training/update, PSR-based lost/recovered state machine.
- [docs/APP.md](docs/APP.md) — browser app architecture, coordinate mapping, seek-and-sample tracking design.
- [docs/TESTING.md](docs/TESTING.md) — unit vs. e2e test design, browser install, port rationale, known limitations.
- [docs/TOOLING.md](docs/TOOLING.md) — video transcoding details, external-tool disclosure, agent permissions.
- [FINAL_REPORT.md](FINAL_REPORT.md) — acceptance-criteria mapping, measured per-video results, autonomy/audit trail.

## What is the challenge?
Select one object in the first frame of a video. The software must keep following that same object frame by frame and show where it moves.

## Input available
- Public OpenCV sample video `vtest.avi`
- Synthetic easy tracking video
- Synthetic video with camera motion and temporary occlusion

## What should we see tomorrow?
A polished browser interface with video playback, tracking box, trajectory, confidence/lost status and simple performance metrics.

## Acceptance test
The tracker must work on more than one supplied video and clearly report when tracking is lost or recovered.

## Public background
- OpenCV MOSSE: https://docs.opencv.org/4.x/d0/d20/classcv_1_1legacy_1_1TrackerMOSSE.html
- Perception Test: https://github.com/google-deepmind/perception_test
