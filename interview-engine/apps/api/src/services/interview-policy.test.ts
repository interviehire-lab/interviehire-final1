import { describe, expect, it } from 'vitest';

import {
  FUNCTIONAL_HARD_LIMIT_SECONDS,
  SCREENING_HARD_LIMIT_SECONDS,
  deadlineFor,
  hardLimitSeconds,
  hasResumeForRequirement,
  secondsRemaining,
  shouldForceClose,
  targetSeconds,
} from './interview-policy.js';

describe('interview timing policy', () => {
  it('accepts either extracted text or a persisted upload marker as a resume', () => {
    expect(hasResumeForRequirement('  Experienced engineer  ', {})).toBe(true);
    expect(hasResumeForRequirement(null, { resumeUploaded: true })).toBe(true);
    expect(hasResumeForRequirement('  ', { resumeUploaded: false })).toBe(false);
  });

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

  it('caps recruiter-screening sessions to 5 minutes regardless of hardDurationSeconds', () => {
    expect(hardLimitSeconds({ stage: 'screening', hardDurationSeconds: 1_800 })).toBe(SCREENING_HARD_LIMIT_SECONDS);
    expect(SCREENING_HARD_LIMIT_SECONDS).toBe(300);
    expect(deadlineFor(startedAt, { stage: 'screening' }).toISOString()).toBe('2026-09-05T00:05:00.000Z');
    expect(targetSeconds({ stage: 'screening' })).toBe(SCREENING_HARD_LIMIT_SECONDS);
  });

  it('caps functional sessions to 25 minutes regardless of hardDurationSeconds', () => {
    expect(hardLimitSeconds({ stage: 'functional', hardDurationSeconds: 1_800 })).toBe(FUNCTIONAL_HARD_LIMIT_SECONDS);
    expect(FUNCTIONAL_HARD_LIMIT_SECONDS).toBe(1_500);
    expect(deadlineFor(startedAt, { stage: 'functional' }).toISOString()).toBe('2026-09-05T00:25:00.000Z');
  });

  it('is reload-proof: re-deriving the deadline from the same persisted startedAt never changes it', () => {
    const settings = { stage: 'screening' };
    const first = deadlineFor(startedAt, settings).toISOString();
    // Simulate a page reload re-calling /start — startedAt is unchanged (the
    // engine only ever stamps it once), so the deadline must be identical.
    const second = deadlineFor(startedAt, settings).toISOString();
    expect(second).toBe(first);
  });
});
