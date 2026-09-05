import { describe, expect, it } from 'vitest';
import { resolveInterviewTiming, remainingSeconds } from './timing-policy.js';

describe('resolveInterviewTiming', () => {
  const startedAt = '2026-09-05T10:00:00.000Z';

  it('never lets metadata extend the absolute 30-minute limit', () => {
    const timing = resolveInterviewTiming({
      startedAt,
      deadlineAt: '2026-09-05T11:00:00.000Z',
      configuredHardLimitSeconds: 1800,
      closingReserveSeconds: 45,
    });

    expect(timing.deadlineAtMs).toBe(Date.parse(startedAt) + 1_800_000);
    expect(timing.closingAtMs).toBe(timing.deadlineAtMs - 45_000);
  });

  it('honours a shorter server-issued deadline', () => {
    const timing = resolveInterviewTiming({
      startedAt,
      deadlineAt: '2026-09-05T10:20:00.000Z',
      configuredHardLimitSeconds: 1800,
      closingReserveSeconds: 45,
    });

    expect(remainingSeconds(timing, Date.parse(startedAt))).toBe(1200);
  });

  it('rejects a deadline at or before the persisted start time', () => {
    expect(() => resolveInterviewTiming({
      startedAt,
      deadlineAt: startedAt,
      configuredHardLimitSeconds: 1800,
      closingReserveSeconds: 45,
    })).toThrow('deadlineAt must be after startedAt');
  });
});
