import type { JobContext, UserState, voice } from '@livekit/agents';
import type { EngineClient, CompletionReason, DirectorResponse } from './engine-client.js';
import type { InterviewTiming } from './timing-policy.js';
import { HARD_ANSWER_LIMIT_SECONDS, remainingSeconds } from './timing-policy.js';

const TIME_LIMIT_CLOSING =
  "We've reached the interview time limit. Thank you for your time. I'll end the session now, and your report will be prepared automatically.";

const LONG_ANSWER_NUDGE =
  "Sorry to jump in — in the interest of time, could you wrap that up in a sentence or two?";

type VoiceEvent =
  | { type: 'activity'; activity: 'idle' | 'thinking' | 'speaking'; timestamp: string }
  | { type: 'transcript'; role: 'user' | 'assistant'; text: string; isFinal: boolean; timestamp: string }
  | { type: 'interview-ended'; reason: CompletionReason; timestamp: string }
  | { type: 'session'; state: string; reason?: CompletionReason; deadlineAt?: string; timestamp: string };

type AgentLogger = {
  debug(object: object, message: string): void;
  info(object: object, message: string): void;
  warn(object: object, message: string): void;
  error(object: object, message: string): void;
};

export class InterviewSessionController {
  #closingTimer?: NodeJS.Timeout;
  #hardTimer?: NodeJS.Timeout;
  #answerTimer?: NodeJS.Timeout;
  #completionStarted = false;
  #roomDeleted = false;
  #currentSpeech?: ReturnType<voice.AgentSession['say']>;

  constructor(
    private readonly ctx: JobContext,
    private readonly session: voice.AgentSession,
    private readonly engine: EngineClient,
    private readonly sessionId: string,
    private readonly timing: InterviewTiming,
    private readonly logger: AgentLogger,
  ) {}

  get isCompleting(): boolean {
    return this.#completionStarted;
  }

  startTimers(): void {
    const now = Date.now();
    this.#closingTimer = setTimeout(
      () => void this.finish('time_limit', { speakClosing: true }),
      Math.max(0, this.timing.closingAtMs - now),
    );
    this.#hardTimer = setTimeout(
      () => void this.#forceDisconnectAtDeadline(),
      Math.max(0, this.timing.deadlineAtMs - now),
    );
  }

  trackSpeech(handle: ReturnType<voice.AgentSession['say']>): void {
    this.#currentSpeech = handle;
  }

  // Independent of the interview-wide deadline: a single answer running past
  // the hard per-answer limit still burns Deepgram/Cartesia/DeepSeek cost even
  // with time left overall. Only fires on the hard limit — see the comment on
  // HARD_ANSWER_LIMIT_SECONDS for why a softer nudge isn't attempted here.
  trackUserState(newState: UserState): void {
    if (this.#answerTimer) {
      clearTimeout(this.#answerTimer);
      this.#answerTimer = undefined;
    }
    if (newState !== 'speaking' || this.#completionStarted) return;
    this.#answerTimer = setTimeout(
      () => void this.#nudgeLongAnswer(),
      HARD_ANSWER_LIMIT_SECONDS * 1000,
    );
  }

  async #nudgeLongAnswer(): Promise<void> {
    if (this.#completionStarted) return;
    this.logger.info({ sessionId: this.sessionId }, 'candidate answer exceeded the per-answer hard limit');
    const nudge = this.session.say(LONG_ANSWER_NUDGE, { allowInterruptions: true, addToChatCtx: true });
    this.trackSpeech(nudge);
  }

  directorDecision(decision: DirectorResponse): void {
    if (!decision.shouldEnd) return;
    const reason = decision.completionReason ?? 'all_questions_asked';
    void this.finish(reason, { waitForCurrentSpeech: true });
  }

  async publish(event: VoiceEvent): Promise<void> {
    try {
      await this.ctx.agent?.publishData(new TextEncoder().encode(JSON.stringify(event)), {
        reliable: true,
        topic: 'interviehire.voice',
      });
    } catch (error) {
      this.logger.warn({ err: error, eventType: event.type }, 'failed to publish voice event');
    }
  }

  async finish(
    reason: CompletionReason,
    options: { speakClosing?: boolean; waitForCurrentSpeech?: boolean } = {},
  ): Promise<void> {
    if (this.#completionStarted) return;
    this.#completionStarted = true;
    if (this.#closingTimer) clearTimeout(this.#closingTimer);
    if (this.#answerTimer) clearTimeout(this.#answerTimer);

    this.logger.info({ reason, remainingSeconds: remainingSeconds(this.timing) }, 'ending interview');
    await this.publish({
      type: 'session',
      state: 'closing',
      reason,
      timestamp: new Date().toISOString(),
    });

    try {
      if (options.speakClosing) {
        try {
          await this.session.interrupt({ force: true });
        } catch {
          // There may be no active utterance to interrupt.
        }
        const closing = this.session.say(TIME_LIMIT_CLOSING, {
          allowInterruptions: false,
          addToChatCtx: true,
        });
        this.trackSpeech(closing);
        await this.#untilDeadline(closing.waitForPlayout());
      } else if (options.waitForCurrentSpeech && this.#currentSpeech) {
        await this.#untilDeadline(this.#currentSpeech.waitForPlayout());
      }
    } catch (error) {
      this.logger.warn({ err: error }, 'closing message did not finish before disconnect');
    }

    await this.#recordCompletion(reason);
    await this.publish({ type: 'interview-ended', reason, timestamp: new Date().toISOString() });
    await this.#disconnectRoom();
    if (this.#hardTimer) clearTimeout(this.#hardTimer);
    this.ctx.shutdown(reason);
  }

  async #forceDisconnectAtDeadline(): Promise<void> {
    this.logger.warn({ sessionId: this.sessionId }, 'hard interview deadline reached');
    await this.publish({
      type: 'interview-ended',
      reason: 'time_limit',
      timestamp: new Date().toISOString(),
    });
    await this.#disconnectRoom();
    if (!this.#completionStarted) {
      this.#completionStarted = true;
      await this.#recordCompletion('time_limit');
    }
    this.ctx.shutdown('time_limit');
  }

  async #disconnectRoom(): Promise<void> {
    if (this.#roomDeleted) return;
    this.#roomDeleted = true;
    try {
      await this.ctx.deleteRoom();
    } catch (error) {
      this.logger.error({ err: error }, 'failed to delete LiveKit room');
    }
  }

  async #recordCompletion(reason: CompletionReason): Promise<void> {
    try {
      await this.engine.complete(this.sessionId, reason, {
        completedAt: new Date().toISOString(),
        durationSeconds: Math.min(
          this.timing.hardLimitSeconds,
          Math.max(0, Math.round((Date.now() - this.timing.startedAtMs) / 1000)),
        ),
        source: 'livekit',
      });
    } catch (error) {
      this.logger.error({ err: error, reason }, 'engine completion callback failed');
    }
  }

  async #untilDeadline<T>(promise: Promise<T>): Promise<T> {
    const remainingMs = Math.max(0, this.timing.deadlineAtMs - Date.now());
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('hard deadline reached')), remainingMs);
      }),
    ]);
  }
}
