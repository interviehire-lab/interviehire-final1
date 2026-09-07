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
import { RoomEvent } from '@livekit/rtc-node';
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

// The frontend now dispatches this agent (via room.connect()) before the
// candidate's mic permission has resolved, so it can join/warm up while the
// candidate is still clicking through permission prompts. That means
// `ctx.waitForParticipant()` alone (which resolves as soon as ANY participant
// joins the room) can resolve before the candidate's microphone track is
// actually published. A ~15-20s bound: long enough for a normal
// permission-grant, short enough that a stale frontend build (or a dropped
// data message) never hangs the interview — it just falls back to today's
// participant-only behavior.
const CANDIDATE_READY_TIMEOUT_MS = 18_000;

function isCandidateReadyMessage(value: unknown): value is { type: 'candidate-ready' } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).type === 'candidate-ready'
  );
}

/**
 * Waits until the candidate can actually hear and respond, not just until
 * some participant is in the room. Right after `publishMicrophone()`
 * succeeds, the frontend sends a reliable data message
 * `{ type: 'candidate-ready' }` (no `topic`, so any other data traffic on the
 * room is simply ignored here). We wait for that message, bounded by
 * `CANDIDATE_READY_TIMEOUT_MS`, so a frontend that hasn't shipped this change
 * yet (or a lost message) still proceeds via the old participant-only path
 * instead of stalling the interview.
 */
async function waitForCandidateReady(
  ctx: JobContext<ProcessData>,
  logger: ReturnType<typeof log>,
): Promise<void> {
  const onData = (payload: Uint8Array) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(payload));
    } catch {
      return; // Not JSON — ignore rather than crash the job.
    }
    if (!isCandidateReadyMessage(parsed)) return; // Some other message type on this channel.
    resolve?.();
  };
  let resolve: (() => void) | undefined;
  const candidateReady = new Promise<void>((res) => {
    resolve = res;
    ctx.room.on(RoomEvent.DataReceived, onData);
  });

  try {
    // Still require an actual participant in the room first — this is the
    // original, untimed wait. Only once someone has joined do we additionally
    // wait (bounded) for confirmation their mic is live.
    await ctx.waitForParticipant();

    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      candidateReady,
      new Promise<void>((res) => {
        timer = setTimeout(() => {
          logger.warn(
            { timeoutMs: CANDIDATE_READY_TIMEOUT_MS },
            'candidate-ready message not received in time; falling back to participant-only wait',
          );
          res();
        }, CANDIDATE_READY_TIMEOUT_MS);
      }),
    ]);
    if (timer) clearTimeout(timer);
  } finally {
    ctx.room.off(RoomEvent.DataReceived, onData);
  }
}

// `startResponseSchema` (engine-client.ts) has no question-count field today,
// and adding one would mean touching engine-client.ts/internal.routes.ts,
// which are out of scope here — so the intro deliberately doesn't state a count.
function buildIntro(candidateName: string | undefined, roleTitle: string | undefined): string {
  const name = candidateName?.trim();
  const role = roleTitle?.trim();

  const greeting = name ? `Hi ${name}, I'm Lina` : "Hi, I'm Lina";
  const forRole = role ? `your AI interviewer for the ${role} role` : 'your AI interviewer today';

  return `${greeting}, ${forRole}. I'll ask a few questions — take your time with each one. Let's get started.`;
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
    // The plugin defaults to 24kHz if unset. 48kHz is Opus's native max sample
    // rate for WebRTC voice (LiveKit publishes at up to 48kHz) — this avoids
    // leaving audible fidelity on the table for no bandwidth reason, though it
    // won't fully close the gap to Cartesia's own (non-real-time) playground.
    sampleRate: 48_000,
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
    outputOptions: {
      // Must match the Cartesia TTS's own `sampleRate` above — RoomIO publishes
      // the output track at its own default (24kHz) otherwise, independent of
      // what the TTS plugin declares, silently downsampling/mismatching audio.
      audioSampleRate: 48_000,
      // Default 200ms is too thin a prebuffer for Cartesia's bursty streaming
      // delivery: when TTS produces audio faster than real-time, early frames
      // get dropped from the ring buffer, which is what "choppy" sounds like.
      // Give it a larger cushion.
      queueSizeMs: 1_000,
    },
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

  await waitForCandidateReady(ctx, logger);
  if (controller.isCompleting) return;

  const firstQuestion = metadata.firstMessage ?? start.initialQuestion;
  const intro = buildIntro(start.candidateName, start.roleTitle);
  const firstSpeech = session.say(`${intro} ${firstQuestion}`, {
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
