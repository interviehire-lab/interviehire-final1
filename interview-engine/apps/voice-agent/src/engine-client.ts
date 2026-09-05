import { z } from 'zod';
import type { VoiceAgentConfig } from './config.js';

const startResponseSchema = z.object({
  sessionId: z.string().min(1),
  candidateName: z.string().optional(),
  roleTitle: z.string().optional(),
  initialQuestion: z.string().trim().min(1),
  startedAt: z.string().datetime(),
  deadlineAt: z.string().datetime(),
  hardLimitSeconds: z.number().int().positive(),
}).passthrough();

const directorResponseSchema = z.object({
  ai: z.object({
    text: z.string().trim().min(1),
    interviewPhase: z.enum(['questioning', 'follow_up', 'closing']).optional(),
    shouldEnd: z.boolean().default(false),
    completionReason: z.enum([
      'director_completed',
      'all_questions_asked',
      'time_limit',
      'candidate_ended',
    ]).nullable().optional(),
    deadlineAt: z.string().datetime().optional(),
    hardLimitSeconds: z.number().int().positive().optional(),
  }).passthrough(),
}).passthrough();

export type EngineStartResponse = z.infer<typeof startResponseSchema>;
export type DirectorResponse = z.infer<typeof directorResponseSchema>['ai'];
export type CompletionReason =
  | 'director_completed'
  | 'all_questions_asked'
  | 'time_limit'
  | 'candidate_ended';

export class EngineRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'EngineRequestError';
  }
}

export class EngineClient {
  readonly #baseUrl: URL;
  readonly #secret: string;
  readonly #timeoutMs: number;

  constructor(config: Pick<
    VoiceAgentConfig,
    'ENGINE_INTERNAL_URL' | 'INTERNAL_SERVICE_SECRET' | 'ENGINE_REQUEST_TIMEOUT_MS'
  >) {
    this.#baseUrl = new URL(config.ENGINE_INTERNAL_URL.replace(/\/$/, '') + '/');
    this.#secret = config.INTERNAL_SERVICE_SECRET;
    this.#timeoutMs = config.ENGINE_REQUEST_TIMEOUT_MS;
  }

  start(sessionId: string, details: Record<string, unknown>): Promise<EngineStartResponse> {
    return this.#post(
      `internal/livekit/sessions/${encodeURIComponent(sessionId)}/start`,
      details,
      startResponseSchema,
      `livekit-start:${sessionId}`,
    );
  }

  turn(
    sessionId: string,
    text: string,
    metrics: Record<string, unknown>,
    turnId: string,
  ): Promise<{ ai: DirectorResponse }> {
    return this.#post(
      `internal/livekit/sessions/${encodeURIComponent(sessionId)}/turn`,
      { text, turnId, metrics },
      directorResponseSchema,
      `livekit-turn:${sessionId}:${turnId}`,
    );
  }

  complete(
    sessionId: string,
    reason: CompletionReason,
    details: Record<string, unknown>,
  ): Promise<unknown> {
    return this.#post(
      `internal/livekit/sessions/${encodeURIComponent(sessionId)}/complete`,
      { reason, ...details },
      z.unknown(),
      `livekit-complete:${sessionId}`,
    );
  }

  async #post<T>(
    path: string,
    body: Record<string, unknown>,
    schema: z.ZodType<T>,
    idempotencyKey: string,
  ): Promise<T> {
    const response = await fetch(new URL(path, this.#baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': this.#secret,
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.#timeoutMs),
    });

    const payload = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
      const error = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
      throw new EngineRequestError(
        typeof error.error === 'string' ? error.error : `Engine request failed with HTTP ${response.status}`,
        response.status,
        typeof error.code === 'string' ? error.code : undefined,
      );
    }

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new EngineRequestError(`Engine returned an invalid response for ${path}: ${parsed.error.message}`);
    }
    return parsed.data;
  }
}
