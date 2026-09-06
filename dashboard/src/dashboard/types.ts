// Central type definitions for the dashboard's data contract.
//
// The dashboard is the SOURCE OF TRUTH for these shapes (per CLAUDE.md): the
// FastAPI backend and the interview engine conform to them, never the reverse.
// The camelCase shapes here are what `api.ts`'s mapper functions produce from the
// backend's snake_case payloads (`mapApplicantOutToCandidate`, `mapJobOutToJob`,
// `mapFullReportToCandidateReport`). Keep them in sync with those mappers.

import type { DifficultyLevel } from './constants';

// ── Candidate ──────────────────────────────────────────────────────────────

// The pipeline stage a candidate currently sits in (derived from decision +
// per-stage status in mapApplicantOutToCandidate).
export type CandidateStatus =
  | 'Hired'
  | 'Rejected'
  | 'Functional'
  | 'Screening'
  | 'Resume';

// Canonical interview-status labels emitted by mapInterviewStatus(). Unknown
// backend values fall through to a title-cased string, so treat this as the
// documented set rather than an exhaustive closed union.
export type InterviewStatusLabel =
  | 'Completed'
  | 'Incomplete'
  | 'Evaluating'
  | 'Attempting'
  | 'Not Started'
  | 'Slot Missed'
  | 'Scheduled'
  | 'Awaiting Schedule';

// A candidate/applicant as consumed by the dashboard UI (camelCase). Mirrors the
// object returned by mapApplicantOutToCandidate(ApplicantOut).
export interface Candidate {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  /** Resume-identity enrichment captured during sourcing/bulk upload. */
  linkedin?: string;
  resumeIdentitySource?: string;
  /** Link to an imported resume (set by bulk spreadsheet import). */
  resumeLink?: string;
  jobApplied: string;
  status: CandidateStatus;
  source: string;
  /** How the candidate was added (entry_method); null for legacy rows. */
  entryMethod: string | null;
  interviewStatus: InterviewStatusLabel | null;
  interviewScore: number | null;
  cheatProbability: string | null;
  matchScore: number | null;
  resumeText: string | null;
  resumeAnalysed: boolean | null;
  resumeShortlisted: boolean | null;
  decision: string | null;
  recruiterNotes: string;
  recruiterScreening: unknown | null;
  recruiterScreeningScore: number | null;
  screeningStatus: InterviewStatusLabel | null;
  screeningScore: number | null;
  attemptedAt: string | null;
  /** Set when an interview is scheduled/rescheduled for the candidate. */
  scheduledWindow?: { start: string; end: string; timezone: string } | null;
  /** Rehydrated resume-analysis result (parsed from resume_analysis_report). */
  resumeAnalysis?: unknown;
  /** Marks an object that originated from the live backend (vs. localStorage). */
  _backend?: boolean;
  /** Real backend UUID, adopted on demand for locally-added ("CAN-…") candidates. */
  backendId?: string;
  // Usage-analytics table extras — set by apiFetchUsageCandidates on top of the
  // shared mapper (the usage row carries job_id/created_at/match_score but no role).
  jobId?: string | null;
  registeredOn?: string;
  score?: number | string;
}

// A recruiter-org team member (Team table). Seed rows carry no backendId; members
// synced to the shared DB adopt one so apiUpdateMember can target them.
export interface TeamMember {
  name: string;
  email: string;
  designation: string;
  usertype: string;
  registeredOn: string;
  status: string;
  backendId?: string;
}

// ── Job ────────────────────────────────────────────────────────────────────

export interface ResumeCriteria {
  mustHave: string[];
  redFlags: string[];
  goodToHave: string[];
  goodToHaveMinMatch: number;
}

export interface ScreeningParamItem {
  name: string;
  required: boolean;
  flexibility: string;
  preferredResponse: string;
}

export interface ScreeningParamCategory {
  category: string;
  params: ScreeningParamItem[];
}

export interface StageToggle {
  enabled: boolean;
  listed?: boolean;
}

export interface PipelineConfig {
  careerPage: StageToggle;
  resumeAnalysis: StageToggle;
  recruiterScreening: StageToggle;
  functionalInterview: StageToggle;
}

export interface PipelineCounts {
  total: number;
  resume: number;
  screening: number;
  functional: number;
}

// A job/role as consumed by the dashboard UI (camelCase). Mirrors the object
// returned by mapJobOutToJob(JobOut). Blueprint sub-shapes (screeningBlueprint,
// functionalParameters) are produced by the engine factories in blueprint-engine
// and are left loosely typed until that module is converted.
export interface Job {
  id: string;
  roleName: string;
  cardName: string;
  companyName: string;
  customJobId: string;
  status: string;
  jobKind: string;
  experienceBand: string;
  description: string;
  tags: string[];
  createdBy: string;
  /** Human-friendly created label (e.g. "Recently", "26 Feb 2026"). */
  created?: string;
  /** Public reference code (e.g. "AKR…"), minted lazily on publish. */
  referenceId?: string;
  /** Flat question list carried on some jobs alongside the blueprint. */
  questions?: unknown[];
  resumeCriteria: ResumeCriteria;
  scoringConfig?: unknown;
  listedOnCareer: boolean;
  screeningParams: ScreeningParamCategory[];
  screeningBlueprint: { questions: unknown[] };
  functionalParameters: { topics: unknown[] };
  pipelineConfig: PipelineConfig;
  interviewSettings?: Record<string, unknown>;
  applicationQuestions?: any[];
  applicationsCloseAt?: string | null;
  pipeline: PipelineCounts;
  _backend?: boolean;
}

// Re-export so consumers can pull vocabulary unions from one place.
export type { DifficultyLevel };

// ── CandidateReport (Deep Analysis) ──────────────────────────────────────────
//
// MIRRORED from the interview engine's canonical type at
// interview-engine/apps/api/src/aviral-eval/types.ts. The engine's stored
// evaluation already matches this shape, so mapFullReportToCandidateReport passes
// a real report straight through. Keep these in lockstep with the engine — this is
// the shared contract; a change on either side must be reflected on the other.
// (The engine also has a parallel `EvalCandidateReport` in packages/shared; the
// aviral-eval shape below is the one the scoring pipeline actually emits.)

export type InterviewType =
  | 'technical'
  | 'behavioral'
  | 'system_design'
  | 'case_study'
  | 'sales'
  | 'hr_screening'
  | 'mixed'
  | 'custom'
  | 'exit_interview';

export type Recommendation =
  | 'strong_proceed'
  | 'proceed'
  | 'hold'
  | 'reject'
  | 'needs_human_review';

export type EvaluationConfidence = 'high' | 'medium' | 'low';
export type RedFlagSeverity = 'low' | 'medium' | 'high' | 'critical';
export type QuestionOrigin = 'predetermined' | 'generated_followup';
export type EvaluationMode =
  | 'model_answer_based'
  | 'rubric_only'
  | 'followup_contextual';

// Exit-interview-only unions (populated when interviewType === 'exit_interview').
export type AttritionSignal = 'regrettable' | 'neutral' | 'expected';
export type ExitSentiment = 'positive' | 'neutral' | 'negative';

// The canonical scoring dimensions (runtime-backed by DIMENSION_KEYS /
// EXIT_DIMENSION_KEYS in the engine's rubrics.ts). Used as the keys of
// dimensionScores and the `skill` of SkillScore.
export type DimensionKey =
  | 'model_answer_alignment'
  | 'factual_correctness'
  | 'completeness'
  | 'reasoning_quality'
  | 'clarity_structure'
  | 'role_level_alignment'
  | 'communication_quality';
export type ExitDimensionKey =
  | 'sentiment'
  | 'candor'
  | 'specificity'
  | 'constructiveness';

export interface RedFlag {
  label: string;
  severity: RedFlagSeverity;
  reason: string;
}

export interface DimensionScore {
  score: number;
  reason: string;
  evidence?: string[];
  missing?: string[];
}

export interface ModelAnswerComparison {
  coveredRequiredPoints: string[];
  missedRequiredPoints: string[];
  coveredBonusPoints: string[];
  incorrectClaims: string[];
}

export interface FollowupAnalysis {
  addressedFollowup: boolean;
  improvedPreviousAnswer: boolean;
  contradictedPreviousAnswer: boolean;
  handledProbeWell: boolean;
  followupValue: 'high' | 'medium' | 'low';
  reason: string;
}

// One graded answer — the element of CandidateReport.questionBreakdown.
export interface ResponseEvaluation {
  answerId: string;
  questionId: string;
  questionText?: string;
  questionOrigin: QuestionOrigin;
  evaluationMode: EvaluationMode;
  overallScore: number;
  dimensionScores: Record<string, DimensionScore>;
  modelAnswerComparison?: ModelAnswerComparison;
  followupAnalysis?: FollowupAnalysis;
  strengths: string[];
  weaknesses: string[];
  redFlags: RedFlag[];
  followUpRecommendations: string[];
  evaluationConfidence: EvaluationConfidence;
  summary: string;
  transcriptOnly: true;
  // Deterministic scoring breakdown (computed from the LLM judgment):
  // finalScore = 0.45*rubricCoverageScore + 0.55*dimensionScore - redFlagPenalty
  rubricCoverageScore?: number;
  dimensionScore?: number;
  redFlagPenalty?: number;
  finalScore?: number;
  rawLlmScore?: number;
}

export interface SkillScore {
  skill: string;
  score: number;
  evidenceAnswerIds: string[];
}

export interface ProctoringViolation {
  eventType: string;
  severity: RedFlagSeverity;
  occurredAt?: string;
  detail?: string;
}

export interface ProctoringSummary {
  totalEvents: number;
  bySeverity: Record<string, number>;
  penalty: number;
  integrityScore: number;
  violations: ProctoringViolation[];
}

export interface ScoreBreakdown {
  rubricCoverageAvg: number;
  dimensionAvg: number;
  redFlagPenaltyAvg: number;
  answerAggregate: number;
  proctoringPenalty: number;
  finalScore: number;
  formula: string;
}

export interface ExitVerbatim {
  theme: string;
  quote: string;
  sentiment: ExitSentiment;
}

// The canonical Deep Analysis report. Mirrors the engine's aviral-eval
// CandidateReport verbatim.
export interface CandidateReport {
  interviewId: string;
  candidateId: string;
  roleTitle: string;
  interviewType: InterviewType;
  overallScore: number;
  recommendation: Recommendation;
  recommendationConfidence: EvaluationConfidence;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  redFlags: RedFlag[];
  skillScores: SkillScore[];
  questionBreakdown: ResponseEvaluation[];
  suggestedNextSteps: string[];
  transcriptOnly: true;
  proctoring?: ProctoringSummary;
  scoreBreakdown?: ScoreBreakdown;
  evaluationEngine?: string;
  futureSignalPlaceholders: {
    audioAnalysisEnabled: false;
    videoAnalysisEnabled: false;
  };
  // Exit-interview fields — populated ONLY when interviewType === 'exit_interview'.
  // In an exit report overallScore carries overall sentiment (0-100) and
  // recommendation is a storage-compat placeholder; read attritionSignal instead.
  attritionSignal?: AttritionSignal;
  topReasons?: string[];
  verbatimHighlights?: ExitVerbatim[];
}
