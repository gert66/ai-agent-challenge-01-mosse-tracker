import { describe, expect, it } from 'vitest';
import { bumpRunToken, createRunToken, isRunCurrent } from '../../src/app/runToken';

describe('RunToken', () => {
  it('starts at generation 0, which is current', () => {
    const token = createRunToken();
    expect(isRunCurrent(token, 0)).toBe(true);
  });

  it('bump returns a new id that is current, and the old id is stale', () => {
    const token = createRunToken();
    const first = bumpRunToken(token);
    expect(isRunCurrent(token, first)).toBe(true);

    const second = bumpRunToken(token);
    expect(second).not.toBe(first);
    expect(isRunCurrent(token, second)).toBe(true);
    expect(isRunCurrent(token, first)).toBe(false);
  });

  it('models the tracking-loop guard: an await that resolves after a Reset/Re-select/video-switch must see itself as stale', () => {
    const token = createRunToken();
    const myRunId = bumpRunToken(token); // e.g. Start captures the current run id

    // Simulate Reset/Re-select/video switch/Pause happening while an await
    // (like the seek in the tracking loop) is in flight.
    bumpRunToken(token);

    // The resumed code must observe that it is no longer the current run
    // and bail out before touching torn-down state.
    expect(isRunCurrent(token, myRunId)).toBe(false);
  });

  it('repeated bumps remain monotonically increasing', () => {
    const token = createRunToken();
    const ids = [bumpRunToken(token), bumpRunToken(token), bumpRunToken(token)];
    expect(new Set(ids).size).toBe(3);
    expect(isRunCurrent(token, ids[2])).toBe(true);
    expect(isRunCurrent(token, ids[0])).toBe(false);
    expect(isRunCurrent(token, ids[1])).toBe(false);
  });
});
