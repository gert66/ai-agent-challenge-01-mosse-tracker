/**
 * Generation counter used to detect a stale in-flight async operation.
 *
 * The tracking loop, Reset/Re-select handlers, and video loading all await
 * a video seek. If Reset, Re-select, a video switch, or Pause happens while
 * one of those awaits is in flight, the resumed code must not go on to
 * touch state (like `tracker`) that the newer action has already torn
 * down. Each such action bumps the token before doing its own work; any
 * pending await checks `isRunCurrent` immediately after it resolves and
 * bails out if a newer run has since started.
 */
export interface RunToken {
  id: number;
}

export function createRunToken(): RunToken {
  return { id: 0 };
}

/** Starts a new generation and returns its id. */
export function bumpRunToken(token: RunToken): number {
  token.id += 1;
  return token.id;
}

/** True if `myRunId` is still the token's current generation. */
export function isRunCurrent(token: RunToken, myRunId: number): boolean {
  return token.id === myRunId;
}
