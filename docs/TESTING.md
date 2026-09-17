# Testing

Two layers of automated tests exist: fast, DOM-free **unit tests** (Vitest)
for the tracker math and app logic, and **end-to-end tests** (Playwright)
that drive the real built app in a real browser against the real supplied
videos.

## Unit tests (`npm test`)

```
npm test          # alias for `npx vitest run`
```

Covers, without touching the DOM or a browser:

- `src/tracker/fft.ts` — the FFT implementation (`tests/unit/fft.test.ts`).
- `src/tracker/mosse.ts` — the MOSSE filter itself (`tests/unit/mosse.test.ts`).
- `src/app/metrics.ts` — tracked-frame %, lost/recovery counting, PSR
  aggregation, and lost-span detection for the timeline chart
  (`tests/unit/metrics.test.ts`).
- `src/app/timeline.ts` — the PSR-timeline chart's pure layout math
  (`frameToX`, `psrToY`, `psrChartMax`) (`tests/unit/timeline.test.ts`).
- `src/app/runToken.ts` — the generation-counter guard that protects the
  tracking loop from the Reset/Re-select/video-switch race described below
  (`tests/unit/runToken.test.ts`).

These run in milliseconds and are the first thing to run after any change.

## End-to-end tests (`npm run test:e2e`)

```
npx playwright install chromium   # one-time, downloads a browser (~150MB)
npm run test:e2e                  # alias for `npx playwright test`
```

`playwright.config.ts` builds the app and serves it via `npm run preview`
on `http://localhost:48173` (see "Why port 48173, not Vite's default
4173" below), then drives it with a real (headless) browser. Specs live in
`tests/e2e/`:

- `first-frame.spec.ts` — for each of the three videos, loads it and
  asserts the hidden `<video>` element actually decoded frame 0
  (`readyState >= HAVE_CURRENT_DATA`, `videoWidth`/`videoHeight` match the
  manifest) and that the visible canvas has real pixel content, not a
  blank/background frame.
- `drag-selection.spec.ts` — drags a selection box on the canvas with
  `page.mouse` (as a real user would) for `synthetic_easy`, and asserts the
  app moves to the "target selected" state.
- `main-flow.spec.ts` — the main demo flow for all three videos: load →
  click "Use suggested box" (`data-testid="use-suggested-box"`) → set
  playback speed to "max" → Start → wait for the state badge to read
  `FINISHED` → assert the confidence/PSR and frame-count/percentage/fps
  readouts are present and sane. `synthetic_easy` asserts tracked-frame
  percentage ≥ 95%; `synthetic_occlusion` asserts at least one lost event
  was recorded; `vtest` asserts the run completes without crashing.
- `race-regression.spec.ts` — regression test for the Reset/Re-select/
  video-switch-during-playback race (see below): starts tracking, then
  immediately fires Reset, Re-select, and a video switch back-to-back, and
  asserts no error was thrown and the app lands back in the selection
  state.
- `ui-polish.spec.ts` — the UI-polish elements added on top of the main
  flow: asserts `video-description`, `frame-progress`, `psr-timeline`, and
  `legend` are visible after selecting a video, that the Space shortcut
  starts tracking, and that after running `synthetic_easy` to completion
  the `frame-progress` readout reads exactly `frame ${frameCount} /
  ${frameCount}` per the manifest.

Every spec installs a `page.on('console', ...)` / `page.on('pageerror',
...)` listener at the start and asserts it captured zero errors — this is
what actually proves the race fix works, not just that the UI ends up in
the right visual state.

### Why port 48173, not Vite's default 4173

This machine runs multiple unrelated automated jobs concurrently, each
potentially starting its own `vite preview` on the default port 4173. When
that happens, Playwright's `reuseExistingServer: !process.env.CI` (which
we want to keep, for fast local iteration) will happily attach to
*someone else's* server on 4173 and every test then fails against the
wrong app. `48173` was chosen only to make an accidental collision very
unlikely; there is nothing otherwise special about it. If you hit
"canvas not found" / manifest-fetch-returns-HTML style failures, this is
the first thing to check — confirm nothing else is bound to the configured
port (`curl http://localhost:48173/videos/manifest.json` should return
JSON, not `<!doctype html>` from an unrelated app).

### The Reset/Re-select/video-switch-during-playback race (what was fixed)

The tracking loop in `src/app/ui.ts` processes one frame at a time by
`await`-ing a video seek. Reset, Re-select, and switching videos all tear
down the current run (null out the tracker, clear the selection, and for
video-switch, load a different video into the same `<video>` element)
*synchronously*, with no way to know a seek was in flight. If one of those
actions ran while the loop's seek was pending, the loop would resume after
the seek resolved and dereference a `tracker` that had since become
`null`, throwing an unhandled `TypeError`.

The fix (`src/app/runToken.ts` + `src/app/ui.ts`) is a generation counter:
Reset, Re-select, a video switch, and Pause all bump it before doing their
own (synchronous) teardown. Every place that awaits a seek — the tracking
loop, Step, loadVideo, Reset, and Re-select — captures the counter's value
before the await and checks it's still current immediately after; if not,
it returns without touching `tracker` or other now-stale state. This also
fixes a related issue where switching videos twice in quick succession
could draw the second video's canvas with the first video's (now stale)
frame data.

### Known limitations

- `vtest.mp4` has 795 frames; processing it end-to-end is a real seek per
  frame (see `docs/APP.md`'s "seek-and-sample" note) and takes tens of
  seconds even at "max" playback speed. To keep the e2e suite fast and
  robust in CI, `main-flow.spec.ts` loads the app with `?maxFrames=150`
  (a hidden, test-only override read once at startup from the URL query
  string in `src/app/ui.ts`; it has no UI control and does not affect the
  manifest or the demo) so the `vtest` case only needs to track 150 frames
  to prove the full flow works end-to-end without crashing. The other two
  videos (180 frames each) run to completion untouched.
- The suite was verified in this environment against the Playwright-managed
  Chromium build ("Chrome for Testing"), which — unlike the older
  open-source Chromium builds Playwright used to ship — includes
  proprietary codec support and plays the project's H.264 `.mp4` files
  natively; no VP9/WebM fallback was needed. If `npx playwright install
  chromium` cannot download or launch a browser in a given environment
  (e.g. no network access, missing OS shared libraries), `npm run test:e2e`
  will fail at the `webServer`/browser-launch step; there is currently no
  automatic skip for that case, since a working browser was available and
  verified in this environment. Install a browser system-wide and pass
  `--browser=chrome`/`--browser=msedge`, or install Chromium's shared
  library dependencies, to unblock it elsewhere.
- `race-regression.spec.ts` fires Reset/Re-select/video-switch back-to-back
  right after Start with no artificial delay, to maximize the chance of
  landing inside the tracking loop's awaited seek. This is inherently
  timing-dependent: the assertions (no console/page errors, app returns to
  the selection state) hold regardless of whether the race window was
  actually hit on a given run, so the test cannot false-fail, but a
  regression in the guard could in principle go undetected on an
  unlucky run. It was run repeatedly during development without a single
  failure.
