import {
  AgentSessionEventTypes,
  ServerOptions,
  cli,
  defineAgent,
  log,
  voice,
  type JobContext,
  type VAD,
} from '@livekit/agents';
import * as cartesia from '@livekit/agents-plugin-cartesia';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import * as silero from '@livekit/agents-plugin-silero';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { InterviewDirectorLLM } from './director-llm.js';
import { EngineClient } from './engine-client.js';
import { InterviewSessionController } from './interview-session.js';
import { remainingSeconds, resolveInterviewTiming } from './timing-policy.js';

dotenv.config({ path: '.env.local' });
dotenv.config();

type ProcessData = { vad?: VAD };

const metadataSchema = z.object({
  sessionId: z.string().trim().min(1),
  startedAt: z.union([z.string().min(1), z.number()]),
  deadlineAt: z.union([z.string().min(1), z.number()]),
  candidateId: z.string().optional(),
  firstMessage: z.string().trim().min(1).optional(),
}).passthrough();

function parseMetadata(raw: string) {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('LiveKit dispatch metadata must be valid JSON');
  }
  const parsed = metadataSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid LiveKit dispatch metadata: ${parsed.error.message}`);
  }
  return parsed.data;
}

async function runInterview(ctx: JobContext<ProcessData>): Promise<void> {
  const config = loadConfig();
  const metadata = parseMetadata(ctx.job.metadata);
  const logger = log().child({
    component: 'voice-agent',
    sessionId: metadata.sessionId,
    jobId: ctx.job.id,
    room: ctx.room.name,
  });
  const timing = resolveInterviewTiming({
    startedAt: metadata.startedAt,
    deadlineAt: metadata.deadlineAt,
    configuredHardLimitSeconds: config.INTERVIEW_HARD_LIMIT_SECONDS,
    closingReserveSeconds: config.INTERVIEW_CLOSING_RESERVE_SECONDS,
  });
  const engine = new EngineClient(config);

  logger.info({
    startedAt: new Date(timing.startedAtMs).toISOString(),
    deadlineAt: new Date(timing.deadlineAtMs).toISOString(),
    remainingSeconds: remainingSeconds(timing),
  }, 'starting LiveKit interview job');

  const start = await engine.start(metadata.sessionId, {
    source: 'livekit',
    jobId: ctx.job.id,
    roomName: ctx.room.name,
    startedAt: new Date(timing.startedAtMs).toISOString(),
    deadlineAt: new Date(timing.deadlineAtMs).toISOString(),
  });
  if (start.sessionId !== metadata.sessionId) {
    throw new Error('Engine start response sessionId does not match dispatch metadata');
  }

  const tts = new cartesia.TTS({
    apiKey: config.CARTESIA_API_KEY,
    model: config.CARTESIA_MODEL,
    voice: config.CARTESIA_VOICE_ID,
    language: 'en',
    speed: 1.05,
  });
  tts.prewarm();
  ctx.addShutdownCallback(() => tts.close());

  let controller: InterviewSessionController;
  const director = new InterviewDirectorLLM(
    engine,
    metadata.sessionId,
    ctx.job.id,
    timing,
    (decision) => controller.directorDecision(decision),
  );

  const session = new voice.AgentSession({
    vad: ctx.proc.userData.vad,
    stt: new deepgram.STTv2({
      apiKey: config.DEEPGRAM_API_KEY,
      model: 'flux-general-en',
      eotThreshold: 0.7,
      // Deepgram's own default is 5_000ms; their docs recommend 7-10s for
      // speakers with thinking pauses. 1_200ms (the previous value here) was
      // far below even the default — Flux was force-ending the candidate's
      // turn after little over a second of any pause, mid-thought, well
      // before they'd said anything resembling a real answer.
      eotTimeoutMs: 8_000,
      mipOptOut: true,
    }),
    llm: director,
    tts,
    userAwayTimeout: null,
    transcriptionTimeout: 5_000,
    turnHandling: {
      turnDetection: 'stt',
      interruption: { enabled: true },
      // Preemptive generation calls `llm.chat()` speculatively on a
      // preliminary ("eager") transcript, before the turn is confirmed final,
      // and can retry up to 3x per turn on revised guesses if the candidate
      // keeps talking. That's safe for a stateless text generator, but
      // InterviewDirectorLLM is not one — every chat() call is a real,
      // synchronous side effect (interview-conversation.service.ts pushes to
      // InterviewSession.transcript and calls recordEventSafe before
      // returning). A speculative call on a truncated transcript would
      // permanently log a bogus partial "answer" and advance the question
      // index — which is exactly what produced garbled candidate lines
      // ("Name in and wait on it.") immediately followed by the next
      // question during testing. Must stay off for this LLM.
      preemptiveGeneration: { enabled: false },
    },
    connOptions: {
      llmConnOptions: { maxRetry: 2, timeoutMs: config.ENGINE_REQUEST_TIMEOUT_MS },
    },
  });

  controller = new InterviewSessionController(
    ctx,
    session,
    engine,
    metadata.sessionId,
    timing,
    logger,
  );

  session.on(AgentSessionEventTypes.SpeechCreated, (event) => {
    controller.trackSpeech(event.speechHandle);
  });
  session.on(AgentSessionEventTypes.UserStateChanged, (event) => {
    controller.trackUserState(event.newState);
  });
  session.on(AgentSessionEventTypes.UserInputTranscribed, (event) => {
    const text = event.transcript.trim();
    if (!text) return;
    void controller.publish({
      type: 'transcript',
      role: 'user',
      text,
      isFinal: event.isFinal,
      timestamp: new Date(event.createdAt).toISOString(),
    });
    if (event.isFinal) logger.info({ transcriptLength: text.length }, 'candidate turn transcribed');
  });
  session.on(AgentSessionEventTypes.AgentStateChanged, (event) => {
    logger.debug({ oldState: event.oldState, newState: event.newState }, 'agent state changed');
    const activity = event.newState === 'thinking' || event.newState === 'speaking'
      ? event.newState
      : 'idle';
    void controller.publish({
      type: 'activity',
      activity,
      timestamp: new Date(event.createdAt).toISOString(),
    });
  });
  session.on(AgentSessionEventTypes.ConversationItemAdded, (event) => {
    if (event.item.type !== 'message' || event.item.role !== 'assistant') return;
    const text = event.item.textContent?.trim();
    if (!text) return;
    void controller.publish({
      type: 'transcript',
      role: 'assistant',
      text,
      isFinal: true,
      timestamp: new Date(event.createdAt).toISOString(),
    });
  });
  session.on(AgentSessionEventTypes.Error, (event) => {
    logger.error({ err: event.error }, 'LiveKit agent session error');
  });
  session.on(AgentSessionEventTypes.Close, () => {
    if (!controller.isCompleting) void controller.finish('candidate_ended');
  });

  await session.start({
    room: ctx.room,
    agent: voice.Agent.create({
      instructions: [
        'You are IntervieHire’s professional voice interviewer.',
        'The IntervieHire engine is authoritative for every question, follow-up, and completion decision.',
        'Speak its response exactly. Never invent questions, coaching, evaluation criteria, or scores.',
      ].join(' '),
    }),
  });
  await ctx.connect();
  controller.startTimers();

  await controller.publish({
    type: 'session',
    state: 'started',
    deadlineAt: new Date(timing.deadlineAtMs).toISOString(),
    timestamp: new Date().toISOString(),
  });

  if (remainingSeconds(timing) === 0) {
    await controller.finish('time_limit', { speakClosing: false });
    return;
  }

  await ctx.waitForParticipant();
  if (controller.isCompleting) return;

  const firstQuestion = metadata.firstMessage ?? start.initialQuestion;
  const firstSpeech = session.say(firstQuestion, {
    allowInterruptions: true,
    addToChatCtx: true,
  });
  controller.trackSpeech(firstSpeech);
}

export default defineAgent<ProcessData>({
  prewarm: async (proc) => {
    proc.userData.vad = await silero.VAD.load({
      minSpeechDuration: 0.15,
      minSilenceDuration: 0.45,
      prefixPaddingDuration: 0.3,
    });
  },
  entry: async (ctx) => {
    try {
      await runInterview(ctx);
    } catch (error) {
      log().error({ err: error, jobId: ctx.job.id, room: ctx.room.name }, 'voice-agent job failed');
      ctx.shutdown('voice_agent_error');
      throw error;
    }
  },
});

const config = loadConfig();
cli.runApp(new ServerOptions({
  agent: fileURLToPath(import.meta.url),
  agentName: config.LIVEKIT_AGENT_NAME,
  host: '0.0.0.0',
  port: config.PORT,
  drainTimeout: 60_000,
}));
