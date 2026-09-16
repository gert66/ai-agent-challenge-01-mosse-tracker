import { expect, test } from '@playwright/test';
import {
  canvasHasContent,
  selectVideo,
  setMaxSpeed,
  startTracking,
  trackConsoleErrors,
  useSuggestedBox,
  waitForFinished,
} from './fixtures';

async function readNumber(page: import('@playwright/test').Page, testId: string): Promise<number> {
  const text = await page.locator(`[data-testid="${testId}"]`).innerText();
  return parseFloat(text);
}

test.describe('main flow: load -> select target -> track to end -> metrics', () => {
  test('synthetic_easy: tracks to completion with >=95% tracked frames', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = trackConsoleErrors(page);
    await page.goto('/');
    await selectVideo(page, 'synthetic_easy');
    await useSuggestedBox(page);
    await setMaxSpeed(page);
    await startTracking(page);
    await waitForFinished(page, 80_000);

    expect(await readNumber(page, 'metric-tracked-pct')).toBeGreaterThanOrEqual(95);
    expect(await readNumber(page, 'metric-fps')).toBeGreaterThan(0);
    expect(await readNumber(page, 'metric-mean-psr')).toBeGreaterThan(0);
    expect(await canvasHasContent(page)).toBe(true);

    expect(errors).toEqual([]);
  });

  test('synthetic_occlusion: reports at least one lost event', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = trackConsoleErrors(page);
    await page.goto('/');
    await selectVideo(page, 'synthetic_occlusion');
    await useSuggestedBox(page);
    await setMaxSpeed(page);
    await startTracking(page);
    await waitForFinished(page, 80_000);

    expect(await readNumber(page, 'metric-lost-events')).toBeGreaterThanOrEqual(1);
    expect(await readNumber(page, 'metric-fps')).toBeGreaterThan(0);
    expect(await readNumber(page, 'metric-mean-psr')).toBeGreaterThan(0);
    expect(Number.isFinite(await readNumber(page, 'metric-tracked-pct'))).toBe(true);
    expect(await canvasHasContent(page)).toBe(true);

    expect(errors).toEqual([]);
  });

  test('vtest: completes a bounded run without crashing', async ({ page }) => {
    // vtest.mp4 has 795 frames; ?maxFrames caps the run so the e2e suite
    // stays fast without touching the real manifest/frame count. See
    // docs/TESTING.md for details.
    test.setTimeout(150_000);
    const errors = trackConsoleErrors(page);
    await page.goto('/?maxFrames=150');
    await selectVideo(page, 'vtest');
    await useSuggestedBox(page);
    await setMaxSpeed(page);
    await startTracking(page);
    await waitForFinished(page, 140_000);

    const framesProcessed = await readNumber(page, 'metric-frames');
    expect(framesProcessed).toBeGreaterThan(0);
    expect(framesProcessed).toBeLessThanOrEqual(150);
    expect(await readNumber(page, 'metric-fps')).toBeGreaterThan(0);
    expect(await readNumber(page, 'metric-mean-psr')).toBeGreaterThan(0);
    expect(await canvasHasContent(page)).toBe(true);

    expect(errors).toEqual([]);
  });
});
