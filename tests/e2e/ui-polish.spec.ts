import { expect, test } from '@playwright/test';
import { getManifest, selectVideo, setMaxSpeed, trackConsoleErrors, useSuggestedBox, waitForFinished } from './fixtures';

test.describe('UI polish: description, progress, timeline, legend, shortcuts', () => {
  test('new panels are visible and progress reaches the manifest frame count after a full run', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = trackConsoleErrors(page);
    await page.goto('/');

    const manifest = await getManifest(page);
    const entry = manifest.videos.find((v) => v.id === 'synthetic_easy');
    if (!entry) throw new Error('manifest is missing video "synthetic_easy"');

    await selectVideo(page, 'synthetic_easy');

    await expect(page.locator('[data-testid="video-description"]')).toBeVisible();
    await expect(page.locator('[data-testid="video-description"]')).toContainText(entry.title);
    await expect(page.locator('[data-testid="frame-progress"]')).toBeVisible();
    await expect(page.locator('[data-testid="psr-timeline"]')).toBeVisible();
    await expect(page.locator('[data-testid="legend"]')).toBeVisible();

    await useSuggestedBox(page);
    await setMaxSpeed(page);

    // Keyboard shortcut: Space should start tracking. Click a neutral,
    // non-form element first so focus isn't on a <select> (which the
    // shortcut handler deliberately ignores) or the canvas (whose
    // pointerdown/up handlers would otherwise interpret the click as a
    // zero-size drag).
    await page.locator('h1').click();
    await page.keyboard.press('Space');
    await expect(page.locator('[data-testid="state-badge"]')).not.toHaveText('READY');

    await waitForFinished(page, 80_000);

    const progressText = await page.locator('[data-testid="frame-progress"]').innerText();
    expect(progressText).toBe(`frame ${entry.frameCount} / ${entry.frameCount}`);

    expect(errors).toEqual([]);
  });
});
