export const ABSOLUTE_HARD_LIMIT_SECONDS = 30 * 60;

// Per-answer guardrail, independent of the interview-wide deadline above: a
// candidate rambling on a single answer still burns Deepgram/Cartesia/DeepSeek
// cost even with time left on the clock. Only the hard limit is actively
// enforced (a mid-speech interrupt) — see InterviewSessionController.
// trackUserState(); the soft value is kept here for the same reasoning
// documented in LiveKit_MIGRATION.md, in case a gentler nudge is added later.
export const SOFT_ANSWER_LIMIT_SECONDS = 90;
export const HARD_ANSWER_LIMIT_SECONDS = 150;

export type InterviewTiming = {
  startedAtMs: number;
  deadlineAtMs: number;
  closingAtMs: number;
  hardLimitSeconds: number;
};

function timestamp(value: string | number, field: string): number {
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${field} in LiveKit dispatch metadata`);
  return parsed;
}

/**
 * The persisted startedAt/deadlineAt values supplied by the engine are
 * authoritative. The local ceiling is a second safety boundary and can only
 * shorten a session; it can never extend the server-issued deadline.
 */
export function resolveInterviewTiming(input: {
  startedAt: string | number;
  deadlineAt?: string | number;
  configuredHardLimitSeconds: number;
  closingReserveSeconds: number;
}): InterviewTiming {
  const startedAtMs = timestamp(input.startedAt, 'startedAt');
  const hardLimitSeconds = Math.min(
    Math.floor(input.configuredHardLimitSeconds),
    ABSOLUTE_HARD_LIMIT_SECONDS,
  );
  const maximumDeadline = startedAtMs + hardLimitSeconds * 1000;
  const suppliedDeadline = input.deadlineAt === undefined
    ? maximumDeadline
    : timestamp(input.deadlineAt, 'deadlineAt');

  if (suppliedDeadline <= startedAtMs) {
    throw new Error('LiveKit dispatch deadlineAt must be after startedAt');
  }

  const deadlineAtMs = Math.min(suppliedDeadline, maximumDeadline);
  const closingAtMs = Math.max(
    startedAtMs,
    deadlineAtMs - input.closingReserveSeconds * 1000,
  );

  return { startedAtMs, deadlineAtMs, closingAtMs, hardLimitSeconds };
}

export function remainingSeconds(timing: InterviewTiming, nowMs = Date.now()): number {
  return Math.max(0, Math.ceil((timing.deadlineAtMs - nowMs) / 1000));
}
