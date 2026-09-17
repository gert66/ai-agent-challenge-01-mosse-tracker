import { describe, expect, it } from 'vitest';
import { frameToX, psrChartMax, psrToY } from '../../src/app/timeline';

describe('frameToX', () => {
  it('maps frame 0 to x=0 and the last frame to the plot width', () => {
    expect(frameToX(0, 10, 100)).toBe(0);
    expect(frameToX(9, 10, 100)).toBe(100);
  });

  it('interpolates linearly for frames in between', () => {
    expect(frameToX(4, 9, 80)).toBeCloseTo(40);
  });

  it('does not divide by zero for a single-frame series', () => {
    expect(frameToX(0, 1, 100)).toBe(0);
    expect(frameToX(0, 0, 100)).toBe(0);
  });
});

describe('psrToY', () => {
  it('maps 0 to the bottom of the plot and maxPsr to the top', () => {
    expect(psrToY(0, 20, 50)).toBe(50);
    expect(psrToY(20, 20, 50)).toBe(0);
  });

  it('clamps values outside [0, maxPsr]', () => {
    expect(psrToY(-5, 20, 50)).toBe(50);
    expect(psrToY(999, 20, 50)).toBe(0);
  });

  it('interpolates linearly in between', () => {
    expect(psrToY(10, 20, 50)).toBeCloseTo(25);
  });
});

describe('psrChartMax', () => {
  it('is comfortably above the good threshold when PSR values are all low', () => {
    const results = [{ psr: 1 }, { psr: 2 }];
    expect(psrChartMax(results, 12)).toBeCloseTo(15);
  });

  it('grows to cover an observed spike above the good threshold', () => {
    const results = [{ psr: 1 }, { psr: 40 }];
    expect(psrChartMax(results, 12)).toBeCloseTo(44);
  });

  it('never returns 0 for an empty series', () => {
    expect(psrChartMax([], 0)).toBeGreaterThan(0);
  });
});
