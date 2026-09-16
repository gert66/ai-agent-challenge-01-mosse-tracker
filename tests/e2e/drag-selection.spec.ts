import { expect, test } from '@playwright/test';
import { selectVideo, trackConsoleErrors } from './fixtures';

test('dragging on the canvas applies a target selection (synthetic_easy)', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await page.goto('/');
  await selectVideo(page, 'synthetic_easy');

  const canvas = page.locator('[data-testid="canvas"]');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');

  const startX = box.x + box.width * 0.15;
  const startY = box.y + box.height * 0.4;
  const endX = box.x + box.width * 0.45;
  const endY = box.y + box.height * 0.75;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move((startX + endX) / 2, (startY + endY) / 2);
  await page.mouse.move(endX, endY);
  await page.mouse.up();

  await expect(page.locator('[data-testid="state-badge"]')).toHaveText('READY');
  await expect(page.locator('[data-testid="btn-start"]')).toBeEnabled();

  expect(errors).toEqual([]);
});
