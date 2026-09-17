# Tooling notes

## Video transcoding

The three supplied source videos are not browser-playable in their original
formats:

- `synthetic_easy.mp4` and `synthetic_occlusion.mp4` are MPEG-4 Part 2
  ("DivX/Xvid"-style) video in an MP4 container, which no mainstream browser
  can decode natively despite the `.mp4` extension.
- `vtest.avi` is stored in an AVI container, which browsers do not support
  as a `<video>` source at all.

`scripts/prepare-videos.mjs` transcodes all three into H.264/yuv420p MP4s
under `public/videos/`, which every modern browser can play back directly.

The script uses the **`ffmpeg-static`** and **`ffprobe-static`** npm
packages — these vendor prebuilt `ffmpeg`/`ffprobe` binaries as npm
dependencies, so no system-wide ffmpeg install (and no sudo/root) is
required. Metadata for `public/videos/manifest.json` (width, height, fps,
frame count, duration) is read back from the transcoded output via
`ffprobe -show_streams -show_format -of json`.

Exact ffmpeg invocation used per video (from `scripts/prepare-videos.mjs`):

```
ffmpeg -y -i <source> \
  -vf scale=trunc(iw/2)*2:trunc(ih/2)*2 \
  -c:v libx264 -pix_fmt yuv420p -profile:v baseline -level 3.0 \
  -movflags +faststart -an \
  public/videos/<output>.mp4
```

- `-vf scale=trunc(iw/2)*2:trunc(ih/2)*2` guarantees even width/height
  (required by yuv420p) while leaving already-even sources unchanged.
- `-profile:v baseline -level 3.0` maximizes browser/device compatibility.
- `-movflags +faststart` moves the moov atom to the front of the file so
  playback can start before the file is fully downloaded.
- `-an` drops audio (the source videos are silent tracking footage).

Re-running `npm run prepare-videos` regenerates the same three output files
and manifest from the untouched source videos in the repo root; it is safe
to re-run at any time.

## Regenerating the videos

```
npm install
npm run prepare-videos
```

This overwrites `public/videos/*.mp4` and `public/videos/manifest.json`.
The original `synthetic_easy.mp4`, `synthetic_occlusion.mp4`, and
`vtest.avi` files in the repo root are read-only inputs and are never
modified by the script.

Verified source codecs (via `ffprobe -show_streams`): `synthetic_easy.mp4`
and `synthetic_occlusion.mp4` are indeed MPEG-4 Part 2 (`codec_name:
mpeg4`) in an MP4 container; `vtest.avi` is `msmpeg4v3` in an AVI
container. All three outputs are confirmed `codec_name: h264`, `pix_fmt:
yuv420p`, with resolution, frame rate, frame count and duration matching
their sources exactly.

## External generation tools

No external app-generation tool (e.g. Lovable) was used for the UI/UX
polish pass or anywhere else in this project. All markup, CSS, and
TypeScript were written directly in this repository.

## Agent permissions

A git-ignored `.claude/settings.local.json` allowlists repo-local `npm`,
`npx`, and `node` execution for the autonomous build agent, per the
repository owner's approval. It contains no secrets and is not part of
the delivered code.
