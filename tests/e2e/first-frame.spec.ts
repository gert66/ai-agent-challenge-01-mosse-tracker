import { expect, test } from '@playwright/test';
import { canvasHasContent, getManifest, selectVideo, trackConsoleErrors } from './fixtures';

const VIDEO_IDS = ['synthetic_easy', 'synthetic_occlusion', 'vtest'];

test.describe('first frame loads for every video', () => {
  for (const videoId of VIDEO_IDS) {
    test(`${videoId}: canvas shows a decoded, correctly-sized first frame`, async ({ page }) => {
      const errors = trackConsoleErrors(page);
      await page.goto('/');

      const manifest = await getManifest(page);
      const entry = manifest.videos.find((v) => v.id === videoId);
      if (!entry) throw new Error(`manifest is missing video "${videoId}"`);

      await selectVideo(page, videoId);

      const videoState = await page.evaluate(() => {
        const video = document.querySelector('video') as HTMLVideoElement;
        return { readyState: video.readyState, videoWidth: video.videoWidth, videoHeight: video.videoHeight };
      });
      expect(videoState.readyState).toBeGreaterThanOrEqual(2); // HAVE_CURRENT_DATA
      expect(videoState.videoWidth).toBe(entry.width);
      expect(videoState.videoHeight).toBe(entry.height);

      expect(await canvasHasContent(page)).toBe(true);

      expect(errors).toEqual([]);
    });
  }
});
