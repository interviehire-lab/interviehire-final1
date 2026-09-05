export const INTERVIEW_TARGET_SECONDS = 25 * 60;
export const INTERVIEW_HARD_LIMIT_SECONDS = 30 * 60;
export const INTERVIEW_CLOSING_RESERVE_SECONDS = 45;

type SessionSettings = Record<string, unknown> | null | undefined;

function finitePositiveNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

/**
 * Recruiters may configure a shorter interview, but no setting may raise the
 * platform's absolute 30-minute cost/safety ceiling.
 */
export function hardLimitSeconds(settings: SessionSettings): number {
  const configured = finitePositiveNumber(settings?.hardDurationSeconds);
  return Math.min(Math.floor(configured ?? INTERVIEW_HARD_LIMIT_SECONDS), INTERVIEW_HARD_LIMIT_SECONDS);
}

export function deadlineFor(startedAt: Date, settings: SessionSettings): Date {
  return new Date(startedAt.getTime() + hardLimitSeconds(settings) * 1000);
}

export function secondsRemaining(startedAt: Date, settings: SessionSettings, now = new Date()): number {
  return Math.max(0, Math.ceil((deadlineFor(startedAt, settings).getTime() - now.getTime()) / 1000));
}

export function shouldForceClose(startedAt: Date, settings: SessionSettings, now = new Date()): boolean {
  return secondsRemaining(startedAt, settings, now) <= INTERVIEW_CLOSING_RESERVE_SECONDS;
}
