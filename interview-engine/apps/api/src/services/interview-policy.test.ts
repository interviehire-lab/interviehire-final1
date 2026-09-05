import { describe, expect, it } from 'vitest';

import {
  deadlineFor,
  hardLimitSeconds,
  secondsRemaining,
  shouldForceClose,
} from './interview-policy.js';

describe('interview timing policy', () => {
  const startedAt = new Date('2026-09-05T00:00:00.000Z');

  it('never permits a configured limit above 30 minutes', () => {
    expect(hardLimitSeconds({ hardDurationSeconds: 9_999 })).toBe(1_800);
    expect(deadlineFor(startedAt, {}).toISOString()).toBe('2026-09-05T00:30:00.000Z');
  });

  it('allows shorter recruiter limits', () => {
    expect(hardLimitSeconds({ hardDurationSeconds: 1_200 })).toBe(1_200);
  });

  it('uses the persisted start time and enters forced closing with 45 seconds left', () => {
    const now = new Date('2026-09-05T00:29:15.000Z');
    expect(secondsRemaining(startedAt, {}, now)).toBe(45);
    expect(shouldForceClose(startedAt, {}, now)).toBe(true);
  });
});
