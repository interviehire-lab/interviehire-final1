export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type InterviewStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'EVALUATED' | 'CANCELLED';

// How early a candidate may enter the room before their scheduled slot. Shared
// between the candidate room (UX countdown lobby) and the engine's
// POST /sessions/:id/start (the server-side enforcement that makes the lock
// real). Single source of truth — do not redefine this locally.
export const EARLY_ENTRY_MS = 10 * 60 * 1000;

export interface ClientToServerTranscript {
  type: 'candidate_transcript';
  sessionId: string;
  text: string;
  timestamp: number;
  speaker?: 'candidate';
  source?: 'typed' | 'speech_to_text';
  latencyMs?: number;
  wpm?: number;
}
export interface ServerToUESpeak {
  type: 'avatar_speak';
  sessionId: string;
  text: string;
  interviewPhase: 'greeting' | 'questioning' | 'follow_up' | 'closing';
  emotionState: 'neutral' | 'encouraging' | 'curious' | 'serious';
}
export interface UEToServerAvatarStatus {
  type: 'avatar_status';
  sessionId: string;
  isSpeaking: boolean;
}
export interface ProctoringPayload {
  type: 'proctoring_event';
  sessionId: string;
  eventType: string;
  severity: Severity;
  metadata: Record<string, unknown>;
  timestamp: number;
}
export interface EvaluationMetric {
  score: number;
  reasoning: string;
}
export interface EvaluationReport {
  answerDepth: EvaluationMetric;
  confidence: EvaluationMetric;
  communication: EvaluationMetric;
  domainKnowledge: EvaluationMetric;
  problemSolving: EvaluationMetric;
  overallScore: number;
  recommendation: 'STRONG_HIRE' | 'HIRE' | 'MAYBE' | 'NO_HIRE';
  strengths: string[];
  risks: string[];
  summary: string;
}

export * from './evaluation';
export * from './flagcheck/flagcheckTranscription';
