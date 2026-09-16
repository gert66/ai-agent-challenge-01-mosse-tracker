import type { VideoManifest } from './state';

export async function loadManifest(baseUrl: string): Promise<VideoManifest> {
  const res = await fetch(`${baseUrl}videos/manifest.json`);
  if (!res.ok) {
    throw new Error(`Failed to load video manifest: HTTP ${res.status}`);
  }
  return (await res.json()) as VideoManifest;
}

export function videoUrl(baseUrl: string, file: string): string {
  return `${baseUrl}${file}`;
}

/** Resolves once the video has decoded enough data to read frame 0 (readyState >= HAVE_CURRENT_DATA). */
export function waitForLoadedData(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve();
  return new Promise((resolve) => {
    const handler = () => {
      video.removeEventListener('loadeddata', handler);
      resolve();
    };
    video.addEventListener('loadeddata', handler);
  });
}

/** Seeks to `time` (seconds) and resolves once the browser reports the seek is complete. */
export function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const handler = () => {
      video.removeEventListener('seeked', handler);
      resolve();
    };
    video.addEventListener('seeked', handler);
    video.currentTime = time;
  });
}
