import { expect, test } from '@playwright/test';
import { selectVideo, startTracking, trackConsoleErrors, useSuggestedBox } from './fixtures';

/**
 * Regression test for a race between the tracking loop's awaited frame seek
 * and Reset/Re-select/video-switch. Any of those used to null out `tracker`
 * (or reset selection/video state) while the loop was mid-`await`; when the
 * seek resolved, the loop went on to dereference the now-null tracker,
 * throwing an unhandled TypeError. Firing the actions back-to-back right
 * after Start maximizes the chance of landing inside that await window.
 */
test('rapid Reset / Re-select / video-switch during playback does not throw and returns to selection', async ({
  page,
}) => {
  test.setTimeout(30_000);
  const errors = trackConsoleErrors(page);
  await page.goto('/');
  await selectVideo(page, 'synthetic_easy');
  await useSuggestedBox(page);
  await startTracking(page);

  await page.click('[data-testid="btn-reset"]');
  await page.click('[data-testid="btn-reselect"]');
  await page.selectOption('[data-testid="video-select"]', 'synthetic_occlusion');

  await page.waitForFunction(
    () => document.querySelector('[data-testid="state-badge"]')?.textContent === 'SELECT TARGET',
    undefined,
    { timeout: 15_000 },
  );

  // Give any straggling stale-run microtasks/timers a chance to resolve and
  // (if the bug were present) throw.
  await page.waitForTimeout(500);

  await expect(page.locator('[data-testid="btn-start"]')).toBeDisabled();
  expect(errors).toEqual([]);
});
