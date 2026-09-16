import type { Page } from '@playwright/test';

export interface VideoManifestEntry {
  id: string;
  title: string;
  file: string;
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  durationSeconds: number;
}

export interface VideoManifest {
  videos: VideoManifestEntry[];
}

/** Starts collecting console errors and uncaught page errors; assert the returned array is empty at the end of a test. */
export function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    errors.push(`pageerror: ${err.message}`);
  });
  return errors;
}

export async function getManifest(page: Page): Promise<VideoManifest> {
  return page.evaluate(async () => {
    const res = await fetch('/videos/manifest.json');
    return (await res.json()) as VideoManifest;
  });
}

/** Selects a video from the toolbar dropdown and waits for its first frame to be ready for selection. */
export async function selectVideo(page: Page, videoId: string): Promise<void> {
  await page.waitForSelector(`[data-testid="video-select"] option[value="${videoId}"]`, { state: 'attached' });
  await page.selectOption('[data-testid="video-select"]', videoId);
  await page.waitForFunction(
    () => document.querySelector('[data-testid="state-badge"]')?.textContent === 'SELECT TARGET',
  );
}

export async function useSuggestedBox(page: Page): Promise<void> {
  await page.click('[data-testid="use-suggested-box"]');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="state-badge"]')?.textContent === 'READY',
  );
}

export async function setMaxSpeed(page: Page): Promise<void> {
  await page.selectOption('[data-testid="speed-select"]', '0');
}

export async function startTracking(page: Page): Promise<void> {
  await page.click('[data-testid="btn-start"]');
}

export async function waitForFinished(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    () => document.querySelector('[data-testid="state-badge"]')?.textContent === 'FINISHED',
    undefined,
    { timeout: timeoutMs },
  );
}

/** True if the overlay canvas contains more than one flat color, i.e. something was actually drawn onto it. */
export async function canvasHasContent(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas[data-testid="canvas"]') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const [r0, g0, b0] = data;
    for (let i = 4; i < data.length; i += 4 * 997) {
      if (data[i] !== r0 || data[i + 1] !== g0 || data[i + 2] !== b0) return true;
    }
    return false;
  });
}
