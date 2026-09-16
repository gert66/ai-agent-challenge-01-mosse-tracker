# MOSSE correlation-filter tracker

This document describes the tracker implemented in `src/tracker/` — a pure
TypeScript, DOM-independent port of the MOSSE (Minimum Output Sum of Squared
Error) correlation filter:

> D. S. Bolme, J. R. Beveridge, B. A. Draper, Y. M. Lui, "Visual Object
> Tracking using Adaptive Correlation Filters", *CVPR 2010*.

The FFT used throughout (`src/tracker/fft.ts`) is a hand-written iterative
radix-2 Cooley-Tukey implementation (1D, applied separably to rows then
columns for 2D transforms) — there is no runtime FFT dependency.

## Overview

MOSSE tracks a single rectangular target by learning a correlation filter
`H*` in the frequency domain such that correlating a new frame's patch `F`
against `H*` produces a response surface with a sharp peak at the target's
new location:

```
response = IFFT(F ⊙ H*)
```

The filter is trained (and adapted online) from log-scaled, normalized,
windowed patches, and its quality is quantified per-frame by the Peak-to-
Sidelobe Ratio (PSR), which drives the tracker's lost/recovered state
machine.

## Preprocessing (`preprocessPatch`)

Every extracted patch (training or tracking) goes through:

1. `log(1 + x)` — compression of the (0..255) grayscale range, reducing the
   influence of bright outliers and improving robustness to illumination
   changes.
2. Zero-mean, unit-variance normalization.
3. A 2D Hanning (cosine) window — tapers the patch to zero at its borders,
   which both reduces spectral leakage in the FFT and de-emphasizes
   background pixels that enter the crop near the target's edges.

## Target and training (`init`)

The filter window is the selected rectangle padded up to the next power of
two in each dimension independently (`nextPow2`), since the FFT requires
power-of-two sizes; this is the `searchWindowScale = 1.0` default behaviour.

The training target `G` is a 2D Gaussian (`sigma = 2.0` by default) with its
peak at `(0, 0)` and circular wraparound distance (`min(d, size - d)` per
axis) — this matches the FFT's convention that a translation of `s` pixels
in the spatial domain produces a response peak at index `s` (with negative
shifts wrapping to the top of the index range), so the same convention is
used for the training target and for interpreting the response peak.

Training draws `numWarps = 8` samples (the first is the untouched patch;
the rest are small random affine perturbations — rotation ±0.2 rad, scale
0.9–1.1, translation ±2 px) from a seeded PRNG (mulberry32, seeded via
`options.seed`) so results are fully deterministic given the same seed.
This mirrors Bolme et al.'s use of synthetic affine warps of the single
initial frame to train a filter that generalizes to small
appearance/pose changes instead of overfitting to one exact patch.

For each warp `i` producing spectrum `F_i`:

```
A += G ⊙ conj(F_i)
B += F_i ⊙ conj(F_i)
H* = A / (B + λ)     (λ = lambda = 1e-4, regularisation)
```

## Per-frame update (`update`)

1. Crop the window at the current rectangle's center (bilinear sampling,
   clamped at the frame border so partially out-of-frame rectangles never
   throw), preprocess, and take its FFT `F`.
2. Compute `response = IFFT(F ⊙ H*)` and locate its maximum.
3. Refine the peak to sub-pixel precision with a 3×3 parabolic fit
   (independently in x and y, using circularly-wrapped neighbours).
4. Convert the (possibly wrapped) peak position to a signed displacement
   `(dx, dy)` and compute the PSR: `(peak - mean(sidelobe)) /
   std(sidelobe)`, where the sidelobe excludes an 11×11 window (radius 5,
   with circular wraparound) around the peak.
5. **If `psr >= psrLostThreshold` (6.0):** shift the rectangle by
   `(dx, dy)`, re-crop at the new position, and adapt the filter with
   exponential forgetting:
   ```
   A = (1 - lr) * A + lr * (G ⊙ conj(F_new))
   B = (1 - lr) * B + lr * (F_new ⊙ conj(F_new))
   H* = A / (B + λ)
   ```
   (`lr = learningRate = 0.125`). State is `'recovered'` if the previous
   frame was lost, otherwise `'tracking'`.
6. **If `psr < psrLostThreshold`:** the filter is *not* updated and the
   rectangle is left unchanged (no drift while the target is
   unavailable); `lostStreak` increments and state becomes `'lost'` once
   `lostStreak >= minLostFramesToDeclare` (default 1, i.e. immediately).

`confidence` is `clamp((psr - psrLostThreshold) / (psrGoodThreshold -
psrLostThreshold), 0, 1)` — 0 at or below the lost threshold, 1 at or above
the good threshold (12.0 by default), linear in between.

## Parameter defaults

| Option                   | Default   | Meaning                                            |
|--------------------------|-----------|-----------------------------------------------------|
| `learningRate`           | 0.125     | Online filter adaptation rate                       |
| `lambda`                 | 1e-4      | Regularisation added to `B` before division         |
| `sigma`                  | 2.0       | Std-dev of the Gaussian training target             |
| `numWarps`               | 8         | Training samples (1 identity + 7 random affine)     |
| `psrLostThreshold`       | 6.0       | Below this PSR, tracking is considered lost         |
| `psrGoodThreshold`       | 12.0      | At/above this PSR, confidence saturates at 1         |
| `minLostFramesToDeclare` | 1         | Consecutive low-PSR frames before state = `'lost'`  |
| `searchWindowScale`      | 1.0       | Filter window size relative to the selected rect     |
| `seed`                   | fixed     | Seeds the PRNG used to generate training warps       |

## Known limitation

Because the filter window is only padded up to the *next* power of two
above the selected rectangle, a target that is small relative to that
padding (i.e. a lot of background inside the window) can accumulate a
small sub-pixel bias per frame under sustained motion, as fresh background
is continually revealed on the leading edge and discarded on the trailing
edge of the crop. This is a well-known characteristic of fixed-size
correlation-filter trackers (not specific to this implementation) and is
mitigated by the Hanning window and by the online filter adaptation, which
partially re-learns the target's changing context. Targets that fill more
of their padded window track with negligible drift.
