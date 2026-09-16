# 1. MOSSE Object Tracker

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
