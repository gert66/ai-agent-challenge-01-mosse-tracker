# MOSSE Object Tracker — Final Report

## What was built

A browser app where a user loads one of three supplied videos, selects a
target in the first frame (drag a box, or click "Use suggested box"), and
watches a from-scratch MOSSE correlation-filter tracker (Bolme et al.,
CVPR 2010) follow it frame by frame — bounding box, trajectory, a PSR
confidence bar, a lost/recovered state badge, a PSR-over-time chart with
shaded lost spans, and a metrics panel (tracked-frame %, lost/recovery
counts, mean/min PSR, processing fps). The tracker (`src/tracker/`) is
pure TypeScript with a hand-written FFT and no DOM or OpenCV dependency;
the app layer (`src/app/`) is Vite + TypeScript with no UI framework.

Run it:

```
npm install
npm run dev              # http://localhost:5173
```

or a production build, exactly as it will be demoed:

```
npm run build
npm run preview          # http://localhost:48173
```

## Acceptance criteria

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Supplied videos load and play | Met | `tests/e2e/first-frame.spec.ts` — 3/3 passing (one per video, decoded first frame at the correct intrinsic size) |
| 2 | Select target region in the first frame | Met | `tests/e2e/drag-selection.spec.ts` (drag-to-select) and `use-suggested-box` flow exercised in every `main-flow.spec.ts` test |
| 3 | Bounding box, trajectory, status/confidence visible | Met | `tests/e2e/main-flow.spec.ts` asserts `canvasHasContent`; `tests/e2e/ui-polish.spec.ts` asserts the timeline/legend/progress panels render; drawing code in `src/app/overlay.ts` and `src/app/timeline.ts` |
| 4 | Easy synthetic video processed correctly | Met | `main-flow.spec.ts` › "synthetic_easy: tracks to completion with >=95% tracked frames" — passing; measured 100.0% tracked (see below) |
| 5 | Occlusion/camera-motion video processed, loss/recovery shown | Met | `main-flow.spec.ts` › "synthetic_occlusion: reports at least one lost event" — passing; measured 1 lost event / 1 recovery |
| 6 | Public OpenCV video (`vtest`) processed without crash | Met | `main-flow.spec.ts` › "vtest: completes a bounded run without crashing" — passing (console/page-error-free); full 795-frame run also completed cleanly, see below |
| 7 | At least one quantitative metric shown | Met | Metrics panel shows 7: frames, tracked %, lost events, recoveries, mean PSR, min PSR, fps (`index.html` `data-testid="metric-*"`, computed in `src/app/metrics.ts`) |

## Measured results

Obtained by driving the production build (`npm run build && npm run
preview`, port 48173) with a throwaway Playwright script that clicked
"Use suggested box", ran at max speed, waited for the `FINISHED` state,
and read the metrics panel (`data-testid="metric-*"`). Same machine/browser
as the automated e2e suite: headless Chromium ("Chrome for Testing") via
Playwright 1.63.0, Node v24.21.0, Linux x86_64. The script was deleted
after use, per `docs/APP.md`'s existing note on this pattern (also used in
commit `e8d36a8`'s manual verification).

| Video | Frames processed | Tracked % | Lost events | Recoveries | Mean PSR | Min PSR | fps (processing) |
|---|---|---|---|---|---|---|---|
| synthetic_easy | 179 / 180 | 100.0% | 0 | 0 | 109.7 | 30.0 | 348.7 |
| synthetic_occlusion | 179 / 180 | 97.2% | 1 | 1 | 69.8 | 1.6 | 361.5 |
| vtest (full run) | 794 / 795 | 100.0% | 0 | 0 | 49.6 | 8.0 | 97.3 |

Notes:
- "Frames processed" is one less than the manifest `frameCount` because
  the first frame is consumed by target selection, not tracking.
- `vtest` was run to completion (all 795 frames) rather than the
  `?maxFrames=150` cap the e2e suite uses for speed; the automated test
  only asserts a bounded, crash-free run, but this report's numbers are
  from the full clip.
- `fps` is wall-clock JS processing throughput (seek-and-sample per
  frame, not real-time playback), so it scales with image size and patch
  size, not with the video's own frame rate — see `docs/APP.md`.

## Architecture overview

- Vite + TypeScript, no UI framework or CSS framework — `src/main.ts`, `index.html`, `src/styles.css`.
- Pure-TypeScript, DOM-independent MOSSE tracker core in `src/tracker/` (`mosse.ts`, `fft.ts`, `index.ts`) — hand-written iterative radix-2 FFT, no OpenCV/runtime FFT dependency.
- DOM-free app modules: `src/app/metrics.ts` (tracked %, lost/recovery counts, PSR stats, fps) and `src/app/timeline.ts` (PSR-chart geometry) are pure functions, unit-tested without a browser.
- `src/app/ui.ts` orchestrates the app via an explicit `AppPhase` state machine and a run-token generation counter (`src/app/runToken.ts`) that guards every `await` against stale Reset/Re-select/video-switch races.
- `src/app/overlay.ts` draws the canvas overlay (state-coloured box, trajectory, event markers, confidence bar, badge) as pure functions of `(ctx, data)`.
- Three supplied videos are transcoded to browser-playable H.264/yuv420p MP4 via `scripts/prepare-videos.mjs`, using the `ffmpeg-static`/`ffprobe-static` npm packages (no system ffmpeg, no sudo); source videos in the repo root are untouched.
- See `docs/ALGORITHM.md` (tracker internals and PSR-based lost/recovered state machine), `docs/APP.md` (app architecture, coordinate mapping, seek-and-sample design), `docs/TESTING.md` (unit/e2e test design and known limitations), `docs/TOOLING.md` (video transcoding, external-tool disclosure, agent permissions).

## Testing summary

- Unit tests (Vitest): `npx vitest run` → **44/44 passing**, 6 files (`mosse.test.ts`, `fft.test.ts`, `metrics.test.ts`, `runToken.test.ts`, `timeline.test.ts`, `smoke.test.ts`).
- Type checking: `npx tsc --noEmit` → exits 0, no errors.
- End-to-end tests (Playwright, real browser, real videos, production build served on port 48173): `npx playwright test` → **9/9 passing** — `first-frame.spec.ts` (×3 videos), `drag-selection.spec.ts`, `main-flow.spec.ts` (×3 videos: load → select → track → metrics), `race-regression.spec.ts` (Reset/Re-select/video-switch race), `ui-polish.spec.ts` (new panels + keyboard shortcut + full-run progress). Every e2e spec also asserts zero `console.error`/`pageerror` events.
- All numbers above were measured in this batch by actually running these commands, not carried over from memory.

## Known limitations and next steps

- MOSSE has no scale adaptation: the tracked box size is fixed at
  selection time, so a target that grows/shrinks substantially in frame
  will be mis-scaled (documented in `docs/ALGORITHM.md`).
- Small objects in a much larger power-of-two padded filter window are
  prone to background-reveal drift — a documented, understood limitation
  of the correlation-filter approach itself, worked around in the
  synthetic test videos by sizing objects close to their window.
- The lost/recovered threshold is a single fixed PSR cutoff, not adapted
  per video or per target; a very low-contrast target could trip false
  "lost" events.
- Single-target tracking only; no re-detection after a genuinely lost
  target leaves the frame (recovery only works while the target is still
  nearby and PSR climbs back above threshold).
- `vtest`'s suggested pedestrian box tracks at 100% with 0 lost events in
  this run — the occlusion/camera-motion criterion is demonstrated on the
  purpose-built `synthetic_occlusion` clip rather than on `vtest`, which
  is used primarily to prove the tracker doesn't crash on a real-world,
  non-synthetic, higher-frame-count video.
- Processing fps is not real-time-locked; playback speed controls affect
  UI pacing only, not tracker throughput.

## Autonomy and audit trail

All code, tests, and documentation were produced by an orchestrated loop
of a Claude Worker (implements one bounded batch) and an independent
Claude Reviewer (checks the diff and re-runs tests against the real
working tree) per batch, with no unreviewed commits. Six commits in total:

1. `05cc33a` — **01-scaffold-and-transcode-videos**: Vite + TypeScript scaffold, test tooling, and browser-playable H.264 transcodes of the three supplied videos via `ffmpeg-static`.
2. `37bfa71` — **02-mosse-core**: the pure-TypeScript, DOM-free MOSSE tracker (FFT + correlation filter + PSR-based lost/recovered state machine), unit-tested.
3. `e8d36a8` — **03-browser-app-select-and-track**: the interactive browser app — video loading, target selection, seek-and-sample tracking loop, canvas overlay, metrics panel.
4. `1bd1607` — **04-race-fix-and-e2e-tests**: fixed a Reset/Re-select/video-switch race with a run-token guard, added the full Playwright e2e suite.
5. `91ded16` — **05-ui-ux-polish**: visual/UX polish (layout, palette, PSR timeline chart, legend, keyboard shortcuts, loading/error states) without touching tracker logic.
6. This batch — **06-final-report-and-readme**: this report and the finished README/docs cross-links (committed by the orchestrator after independent review).

No external app-generation tool (e.g. Lovable) was used anywhere in this
project — all markup, CSS, and TypeScript were written directly in the
repository, consistent with `docs/TOOLING.md`. The only external binaries
used were the `ffmpeg`/`ffprobe` binaries vendored by the `ffmpeg-static`/
`ffprobe-static` npm packages for one-time video transcoding; no system-
wide installs, no sudo/root, and no production environments were touched
at any point. The one human intervention across the whole build was
approving a git-ignored `.claude/settings.local.json` tool-permission
allowlist (repo-local `npm`/`npx`/`node` execution for the autonomous
agent) — it contains no secrets and is not part of the delivered code.
