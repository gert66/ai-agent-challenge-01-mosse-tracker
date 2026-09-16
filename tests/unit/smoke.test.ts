import { describe, expect, it } from 'vitest';

describe('smoke', () => {
  it('sanity check: test runner executes', () => {
    expect(1 + 1).toBe(2);
  });
});
