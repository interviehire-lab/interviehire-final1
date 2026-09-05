import {
  DEFAULT_API_CONNECT_OPTIONS,
  type APIConnectOptions,
  type ChatContext,
  type ToolContextLike,
  llm,
} from '@livekit/agents';
import type { EngineClient, DirectorResponse } from './engine-client.js';
import type { InterviewTiming } from './timing-policy.js';
import { remainingSeconds } from './timing-policy.js';

type DecisionCallback = (decision: DirectorResponse) => void;

export class InterviewDirectorLLM extends llm.LLM {
  constructor(
    private readonly engine: EngineClient,
    private readonly sessionId: string,
    private readonly jobId: string,
    private readonly timing: InterviewTiming,
    private readonly onDecision: DecisionCallback,
  ) {
    super();
  }

  label(): string {
    return 'interviehire.engine-director';
  }

  override get model(): string {
    return 'interviehire-director';
  }

  override get provider(): string {
    return 'interviehire';
  }

  chat(options: {
    chatCtx: ChatContext;
    toolCtx?: ToolContextLike;
    connOptions?: APIConnectOptions;
  }): llm.LLMStream {
    return new InterviewDirectorStream(this, {
      chatCtx: options.chatCtx,
      toolCtx: options.toolCtx,
      connOptions: options.connOptions ?? DEFAULT_API_CONNECT_OPTIONS,
      engine: this.engine,
      sessionId: this.sessionId,
      jobId: this.jobId,
      timing: this.timing,
      onDecision: this.onDecision,
    });
  }
}

class InterviewDirectorStream extends llm.LLMStream {
  readonly #engine: EngineClient;
  readonly #sessionId: string;
  readonly #jobId: string;
  readonly #timing: InterviewTiming;
  readonly #onDecision: DecisionCallback;

  constructor(
    director: InterviewDirectorLLM,
    options: {
      chatCtx: ChatContext;
      toolCtx?: ToolContextLike;
      connOptions: APIConnectOptions;
      engine: EngineClient;
      sessionId: string;
      jobId: string;
      timing: InterviewTiming;
      onDecision: DecisionCallback;
    },
  ) {
    super(director, options);
    this.#engine = options.engine;
    this.#sessionId = options.sessionId;
    this.#jobId = options.jobId;
    this.#timing = options.timing;
    this.#onDecision = options.onDecision;
  }

  protected async run(): Promise<void> {
    const message = [...this.chatCtx.items]
      .reverse()
      .find((item) => item.type === 'message' && item.role === 'user');
    if (!message || message.type !== 'message') return;

    const transcript = message.textContent?.trim();
    if (!transcript) return;

    const result = await this.#engine.turn(
      this.#sessionId,
      transcript,
      {
        source: 'livekit',
        jobId: this.#jobId,
        turnId: message.id,
        capturedAt: new Date().toISOString(),
        remainingSeconds: remainingSeconds(this.#timing),
      },
      message.id,
    );

    this.queue.put({
      id: `engine-${message.id}`,
      delta: { role: 'assistant', content: result.ai.text },
    });
    this.#onDecision(result.ai);
  }
}
