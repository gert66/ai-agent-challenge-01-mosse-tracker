// Transcodes the supplied source videos into browser-playable H.264 MP4s
// under public/videos/, and writes public/videos/manifest.json describing
// each output. Uses the ffmpeg-static / ffprobe-static npm binaries so no
// system-wide ffmpeg install is required. Re-running this script regenerates
// identical outputs (pure function of the source files + this script).
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import ffmpegPath from 'ffmpeg-static';
import ffprobePath from 'ffprobe-static';

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const outDir = join(repoRoot, 'public', 'videos');

const VIDEOS = [
  {
    id: 'synthetic_easy',
    title: 'Synthetic — easy',
    source: join(repoRoot, 'synthetic_easy.mp4'),
    file: 'synthetic_easy.mp4',
    description: 'Synthetic clip with a single object moving smoothly against a simple background; no occlusion or camera motion.',
  },
  {
    id: 'synthetic_occlusion',
    title: 'Synthetic — occlusion',
    source: join(repoRoot, 'synthetic_occlusion.mp4'),
    file: 'synthetic_occlusion.mp4',
    description: 'Synthetic clip with camera motion and partial/full occlusion of the tracked object, exercising loss and recovery.',
  },
  {
    id: 'vtest',
    title: 'vtest (OpenCV sample)',
    source: join(repoRoot, 'vtest.avi'),
    file: 'vtest.mp4',
    description: 'Public OpenCV pedestrian-tracking sample video (vtest.avi) with multiple real-world moving subjects.',
  },
];

async function ffprobeStreamInfo(filePath) {
  const { stdout } = await execFileAsync(ffprobePath.path, [
    '-v', 'error',
    '-show_streams',
    '-show_format',
    '-of', 'json',
    filePath,
  ]);
  const data = JSON.parse(stdout);
  const stream = data.streams.find((s) => s.codec_type === 'video');
  return { stream, format: data.format };
}

function parseFps(rFrameRate) {
  const [num, den] = rFrameRate.split('/').map(Number);
  if (!den) return num;
  return num / den;
}

async function transcode(video) {
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, video.file);

  const args = [
    '-y',
    '-i', video.source,
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-profile:v', 'baseline',
    '-level', '3.0',
    '-movflags', '+faststart',
    '-an',
    outPath,
  ];

  console.log(`\n[prepare-videos] Transcoding ${video.file} ...`);
  console.log(`[prepare-videos] ${ffmpegPath} ${args.join(' ')}`);
  await execFileAsync(ffmpegPath, args);

  const { stream, format } = await ffprobeStreamInfo(outPath);
  const width = stream.width;
  const height = stream.height;
  const fps = parseFps(stream.r_frame_rate);
  const frameCount = stream.nb_frames
    ? Number(stream.nb_frames)
    : Math.round(Number(format.duration) * fps);
  const durationSeconds = Number(format.duration);

  console.log(
    `[prepare-videos] ${video.file}: codec=${stream.codec_name} pix_fmt=${stream.pix_fmt} ` +
      `${width}x${height} @ ${fps.toFixed(3)}fps, ${frameCount} frames, ${durationSeconds.toFixed(3)}s`,
  );

  return {
    id: video.id,
    title: video.title,
    file: `videos/${video.file}`,
    width,
    height,
    fps: Number(fps.toFixed(3)),
    frameCount,
    durationSeconds: Number(durationSeconds.toFixed(3)),
    description: video.description,
    codec: stream.codec_name,
    pixFmt: stream.pix_fmt,
  };
}

async function main() {
  const manifestEntries = [];
  for (const video of VIDEOS) {
    const entry = await transcode(video);
    manifestEntries.push(entry);
  }

  const manifestPath = join(outDir, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify({ videos: manifestEntries }, null, 2) + '\n');
  console.log(`\n[prepare-videos] Wrote ${manifestPath}`);
}

main().catch((err) => {
  console.error('[prepare-videos] Failed:', err);
  process.exitCode = 1;
});
