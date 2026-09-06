export const INTERVIEW_TARGET_SECONDS = 25 * 60;
export const INTERVIEW_HARD_LIMIT_SECONDS = 30 * 60;
export const INTERVIEW_CLOSING_RESERVE_SECONDS = 45;

// Recruiter-screening and functional-screening sessions are tagged with a
// `stage` in their settings (stamped by backend/app/utils/ai_sync.py) and run
// to their own fixed caps — independent of the general conversational-interview
// settings above, and not overridable by a recruiter's `hardDurationSeconds`
// (that knob configures the platform's cost ceiling; these two are fixed
// product limits for the two screening stages).
export const SCREENING_HARD_LIMIT_SECONDS = 5 * 60;
export const FUNCTIONAL_HARD_LIMIT_SECONDS = 25 * 60;

type SessionSettings = Record<string, unknown> | null | undefined;

function finitePositiveNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function stageOf(settings: SessionSettings): string | null {
  const stage = (settings as { stage?: unknown } | null | undefined)?.stage;
  return typeof stage === 'string' ? stage : null;
}

/**
 * Recruiters may configure a shorter interview, but no setting may raise the
 * platform's absolute 30-minute cost/safety ceiling. Recruiter-screening and
 * functional-screening sessions instead run to their own fixed stage caps
 * (5 min / 25 min) regardless of `hardDurationSeconds`.
 */
export function hardLimitSeconds(settings: SessionSettings): number {
  const stage = stageOf(settings);
  if (stage === 'screening') return SCREENING_HARD_LIMIT_SECONDS;
  if (stage === 'functional') return FUNCTIONAL_HARD_LIMIT_SECONDS;
  const configured = finitePositiveNumber(settings?.hardDurationSeconds);
  return Math.min(Math.floor(configured ?? INTERVIEW_HARD_LIMIT_SECONDS), INTERVIEW_HARD_LIMIT_SECONDS);
}

/**
 * The pacing target the director prompts against. For stage-tagged sessions
 * this equals the hard limit itself — every second of a fixed 5/25-minute
 * screening counts, so the director should aim to cover all remaining
 * questions within the whole window, not leave slack below the cap the way
 * the general conversational interview does (target 25 min, hard limit 30).
 */
export function targetSeconds(settings: SessionSettings): number {
  const stage = stageOf(settings);
  if (stage === 'screening') return SCREENING_HARD_LIMIT_SECONDS;
  if (stage === 'functional') return FUNCTIONAL_HARD_LIMIT_SECONDS;
  return INTERVIEW_TARGET_SECONDS;
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
