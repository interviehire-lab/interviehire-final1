import { afterEach, describe, expect, it, vi } from 'vitest';
import { InterviewSessionController } from './interview-session.js';
import type { InterviewTiming } from './timing-policy.js';
import { HARD_ANSWER_LIMIT_SECONDS } from './timing-policy.js';

// These fakes model only the surface InterviewSessionController actually
// touches on JobContext / voice.AgentSession / EngineClient — not the real
// LiveKit/Fastify SDK shapes, which are heavy to construct and irrelevant to
// the policy being tested here (timing, dispatch-of-events, idempotency).

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeCtx(overrides: { agent?: unknown } = {}) {
  return {
    agent: overrides.agent,
    deleteRoom: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn(),
  } as any;
}

function makeSession(overrides: { say?: any; interrupt?: any } = {}) {
  return {
    say: overrides.say ?? vi.fn(() => ({ waitForPlayout: vi.fn().mockResolvedValue(undefined) })),
    interrupt: overrides.interrupt ?? vi.fn().mockResolvedValue(undefined),
  } as any;
}

function makeEngine() {
  return { complete: vi.fn().mockResolvedValue(undefined) } as any;
}

function makeTiming(overrides: Partial<InterviewTiming> = {}): InterviewTiming {
  const startedAtMs = overrides.startedAtMs ?? Date.now();
  return {
    startedAtMs,
    deadlineAtMs: startedAtMs + 60_000,
    closingAtMs: startedAtMs + 55_000,
    hardLimitSeconds: 60,
    ...overrides,
  };
}

afterEach(() => {
  // Safety net: a test that throws before its own vi.useRealTimers() would
  // otherwise leak fake timers into every test that runs after it.
  vi.useRealTimers();
});

describe('publish() — the ctx.agent readiness race', () => {
  // Regression coverage for the bug fixed in this codebase: ctx.agent (the
  // LiveKit SDK's own LocalParticipant getter) can briefly still read
  // `undefined` right after ctx.connect() resolves. publish() used to read it
  // with a bare `?.`, silently dropping the event with no log — the exact
  // failure behind candidates hearing the agent while the client never got
  // the 'session started' message.

  it('publishes immediately when the agent participant is already available', async () => {
    const publishData = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx({ agent: { publishData } });
    const logger = makeLogger();
    const controller = new InterviewSessionController(ctx, makeSession(), makeEngine(), 'sess-1', makeTiming(), logger);

    await controller.publish({ type: 'activity', activity: 'idle', timestamp: 't' });

    expect(publishData).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('waits for ctx.agent to appear before publishing instead of dropping the event', async () => {
    vi.useFakeTimers();
    const publishData = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx(); // agent starts undefined, simulating the SDK timing gap
    const logger = makeLogger();
    const controller = new InterviewSessionController(ctx, makeSession(), makeEngine(), 'sess-1', makeTiming(), logger);

    const publishPromise = controller.publish({ type: 'activity', activity: 'idle', timestamp: 't' });
    await vi.advanceTimersByTimeAsync(250);
    ctx.agent = { publishData }; // the getter "resolves" mid-poll
    await vi.advanceTimersByTimeAsync(150);
    await publishPromise;

    expect(publishData).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('drops the event and logs a warning (not silently) if the agent never becomes available', async () => {
    vi.useFakeTimers();
    const ctx = makeCtx(); // agent never appears
    const logger = makeLogger();
    const controller = new InterviewSessionController(ctx, makeSession(), makeEngine(), 'sess-1', makeTiming(), logger);

    const publishPromise = controller.publish({ type: 'activity', activity: 'idle', timestamp: 't' });
    await vi.advanceTimersByTimeAsync(5_000);
    await publishPromise;

    expect(logger.warn).toHaveBeenCalledWith(
      { eventType: 'activity' },
      'ctx.agent still unavailable after waiting; dropping voice event',
    );
  });

  it('logs but does not throw when publishData itself rejects', async () => {
    const publishData = vi.fn().mockRejectedValue(new Error('AbortError: operation aborted'));
    const ctx = makeCtx({ agent: { publishData } });
    const logger = makeLogger();
    const controller = new InterviewSessionController(ctx, makeSession(), makeEngine(), 'sess-1', makeTiming(), logger);

    await expect(
      controller.publish({ type: 'activity', activity: 'idle', timestamp: 't' }),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'activity' }),
      'failed to publish voice event',
    );
  });
});

describe('trackUserState — long-answer nudge', () => {
  it('nudges once a candidate speaks past the hard per-answer limit', async () => {
    vi.useFakeTimers();
    const say = vi.fn(() => ({ waitForPlayout: vi.fn().mockResolvedValue(undefined) }));
    const ctx = makeCtx({ agent: { publishData: vi.fn().mockResolvedValue(undefined) } });
    const session = makeSession({ say });
    const controller = new InterviewSessionController(ctx, session, makeEngine(), 'sess-1', makeTiming(), makeLogger());

    controller.trackUserState('speaking');
    await vi.advanceTimersByTimeAsync(HARD_ANSWER_LIMIT_SECONDS * 1000);

    expect(say).toHaveBeenCalledWith(
      expect.stringContaining('wrap that up'),
      expect.objectContaining({ allowInterruptions: true }),
    );
  });

  it('resets the timer when the candidate stops speaking before the limit', async () => {
    vi.useFakeTimers();
    const say = vi.fn(() => ({ waitForPlayout: vi.fn().mockResolvedValue(undefined) }));
    const session = makeSession({ say });
    const controller = new InterviewSessionController(makeCtx(), session, makeEngine(), 'sess-1', makeTiming(), makeLogger());

    controller.trackUserState('speaking');
    await vi.advanceTimersByTimeAsync((HARD_ANSWER_LIMIT_SECONDS - 5) * 1000);
    controller.trackUserState('idle'); // candidate finished in time
    await vi.advanceTimersByTimeAsync(30_000);

    expect(say).not.toHaveBeenCalled();
  });

  it('does not nudge once the interview has already started completing', async () => {
    vi.useFakeTimers();
    const say = vi.fn(() => ({ waitForPlayout: vi.fn().mockResolvedValue(undefined) }));
    const ctx = makeCtx({ agent: { publishData: vi.fn().mockResolvedValue(undefined) } });
    const session = makeSession({ say });
    const controller = new InterviewSessionController(ctx, session, makeEngine(), 'sess-1', makeTiming(), makeLogger());

    await controller.finish('candidate_ended');
    say.mockClear();
    controller.trackUserState('speaking');
    await vi.advanceTimersByTimeAsync(HARD_ANSWER_LIMIT_SECONDS * 1000);

    expect(say).not.toHaveBeenCalled();
  });
});

describe('directorDecision', () => {
  it('does nothing when the director says shouldEnd is false', () => {
    const controller = new InterviewSessionController(makeCtx(), makeSession(), makeEngine(), 'sess-1', makeTiming(), makeLogger());
    const finishSpy = vi.spyOn(controller, 'finish').mockResolvedValue(undefined);

    controller.directorDecision({ text: 'go on', shouldEnd: false });

    expect(finishSpy).not.toHaveBeenCalled();
  });

  it('ends the interview with the directors completion reason, waiting for the current speech to finish', () => {
    const controller = new InterviewSessionController(makeCtx(), makeSession(), makeEngine(), 'sess-1', makeTiming(), makeLogger());
    const finishSpy = vi.spyOn(controller, 'finish').mockResolvedValue(undefined);

    controller.directorDecision({ text: 'done', shouldEnd: true, completionReason: 'candidate_ended' });

    expect(finishSpy).toHaveBeenCalledWith('candidate_ended', { waitForCurrentSpeech: true });
  });

  it('defaults the completion reason to all_questions_asked when the director omits it', () => {
    const controller = new InterviewSessionController(makeCtx(), makeSession(), makeEngine(), 'sess-1', makeTiming(), makeLogger());
    const finishSpy = vi.spyOn(controller, 'finish').mockResolvedValue(undefined);

    controller.directorDecision({ text: 'done', shouldEnd: true });

    expect(finishSpy).toHaveBeenCalledWith('all_questions_asked', { waitForCurrentSpeech: true });
  });
});

describe('finish()', () => {
  it('is idempotent — a second call for any reason is a no-op', async () => {
    const engine = makeEngine();
    const ctx = makeCtx({ agent: { publishData: vi.fn().mockResolvedValue(undefined) } });
    const controller = new InterviewSessionController(ctx, makeSession(), engine, 'sess-1', makeTiming(), makeLogger());

    await controller.finish('candidate_ended');
    await controller.finish('time_limit');

    expect(engine.complete).toHaveBeenCalledTimes(1);
    expect(engine.complete).toHaveBeenCalledWith('sess-1', 'candidate_ended', expect.any(Object));
    expect(ctx.shutdown).toHaveBeenCalledTimes(1);
  });

  it('speaks a closing message, waits for playout, then records completion and disconnects', async () => {
    const waitForPlayout = vi.fn().mockResolvedValue(undefined);
    const say = vi.fn(() => ({ waitForPlayout }));
    const engine = makeEngine();
    const ctx = makeCtx({ agent: { publishData: vi.fn().mockResolvedValue(undefined) } });
    const session = makeSession({ say });
    const controller = new InterviewSessionController(ctx, session, engine, 'sess-1', makeTiming(), makeLogger());

    await controller.finish('time_limit', { speakClosing: true });

    expect(session.interrupt).toHaveBeenCalledWith({ force: true });
    expect(say).toHaveBeenCalledWith(expect.stringContaining('time limit'), expect.objectContaining({ allowInterruptions: false }));
    expect(waitForPlayout).toHaveBeenCalledTimes(1);
    expect(engine.complete).toHaveBeenCalledWith('sess-1', 'time_limit', expect.any(Object));
    expect(ctx.deleteRoom).toHaveBeenCalledTimes(1);
    expect(ctx.shutdown).toHaveBeenCalledWith('time_limit');
  });

  it('still completes cleanly when there is nothing playing to interrupt', async () => {
    const engine = makeEngine();
    const ctx = makeCtx({ agent: { publishData: vi.fn().mockResolvedValue(undefined) } });
    const session = makeSession({ interrupt: vi.fn().mockRejectedValue(new Error('nothing to interrupt')) });
    const controller = new InterviewSessionController(ctx, session, engine, 'sess-1', makeTiming(), makeLogger());

    await expect(controller.finish('time_limit', { speakClosing: true })).resolves.toBeUndefined();

    expect(engine.complete).toHaveBeenCalled();
    expect(ctx.shutdown).toHaveBeenCalled();
  });

  it('still records completion and disconnects even when the closing speech hangs past the hard deadline', async () => {
    vi.useFakeTimers();
    const hangingWaitForPlayout = () => new Promise<void>(() => {}); // never resolves — simulates a stuck TTS
    const say = vi.fn(() => ({ waitForPlayout: hangingWaitForPlayout }));
    const engine = makeEngine();
    const ctx = makeCtx({ agent: { publishData: vi.fn().mockResolvedValue(undefined) } });
    const session = makeSession({ say });
    const now = Date.now();
    const timing = makeTiming({ startedAtMs: now, deadlineAtMs: now + 2_000, closingAtMs: now + 1_000 });
    const logger = makeLogger();
    const controller = new InterviewSessionController(ctx, session, engine, 'sess-1', timing, logger);

    const finishPromise = controller.finish('time_limit', { speakClosing: true });
    await vi.advanceTimersByTimeAsync(2_100);
    await finishPromise;

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'closing message did not finish before disconnect',
    );
    expect(engine.complete).toHaveBeenCalledWith('sess-1', 'time_limit', expect.any(Object));
    expect(ctx.shutdown).toHaveBeenCalledWith('time_limit');
  });

  it('logs but does not throw when the room was already deleted (LiveKit "not found")', async () => {
    const engine = makeEngine();
    const ctx = makeCtx({ agent: { publishData: vi.fn().mockResolvedValue(undefined) } });
    ctx.deleteRoom = vi.fn().mockRejectedValue(Object.assign(new Error('requested room does not exist'), { status: 404 }));
    const logger = makeLogger();
    const controller = new InterviewSessionController(ctx, makeSession(), engine, 'sess-1', makeTiming(), logger);

    await expect(controller.finish('candidate_ended')).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error) }), 'failed to delete LiveKit room');
    expect(ctx.shutdown).toHaveBeenCalled(); // the interview still ends cleanly for the candidate
  });

  it('caps the recorded duration at hardLimitSeconds even if wall-clock time overruns it', async () => {
    const engine = makeEngine();
    const ctx = makeCtx({ agent: { publishData: vi.fn().mockResolvedValue(undefined) } });
    const longAgo = Date.now() - 999_999_000;
    const timing = makeTiming({ startedAtMs: longAgo, hardLimitSeconds: 60, deadlineAtMs: longAgo + 60_000, closingAtMs: longAgo + 55_000 });
    const controller = new InterviewSessionController(ctx, makeSession(), engine, 'sess-1', timing, makeLogger());

    await controller.finish('candidate_ended');

    const [, , details] = (engine.complete as any).mock.calls[0];
    expect(details.durationSeconds).toBe(60);
  });
});

describe('startTimers() — the hard-deadline safety net', () => {
  it('force-disconnects at the hard deadline when nothing else has ended the interview', async () => {
    vi.useFakeTimers();
    const engine = makeEngine();
    const ctx = makeCtx({ agent: { publishData: vi.fn().mockResolvedValue(undefined) } });
    const now = Date.now();
    // closingAtMs pushed far out so only the hard timer fires in this window —
    // isolates #forceDisconnectAtDeadline from the closing-flow path tested above.
    const timing = makeTiming({ startedAtMs: now, closingAtMs: now + 999_000, deadlineAtMs: now + 2_000 });
    const logger = makeLogger();
    const controller = new InterviewSessionController(ctx, makeSession(), engine, 'sess-1', timing, logger);

    controller.startTimers();
    await vi.advanceTimersByTimeAsync(2_100);

    expect(logger.warn).toHaveBeenCalledWith({ sessionId: 'sess-1' }, 'hard interview deadline reached');
    expect(engine.complete).toHaveBeenCalledWith('sess-1', 'time_limit', expect.any(Object));
    expect(ctx.deleteRoom).toHaveBeenCalledTimes(1);
    expect(ctx.shutdown).toHaveBeenCalledWith('time_limit');
  });

  it('is a no-op for completion-recording if the interview already ended via another path', async () => {
    vi.useFakeTimers();
    const engine = makeEngine();
    const ctx = makeCtx({ agent: { publishData: vi.fn().mockResolvedValue(undefined) } });
    const now = Date.now();
    const timing = makeTiming({ startedAtMs: now, closingAtMs: now + 999_000, deadlineAtMs: now + 5_000 });
    const controller = new InterviewSessionController(ctx, makeSession(), engine, 'sess-1', timing, makeLogger());

    controller.startTimers();
    await controller.finish('candidate_ended'); // candidate hangs up well before the hard deadline
    await vi.advanceTimersByTimeAsync(5_500); // let the hard timer fire anyway

    expect(engine.complete).toHaveBeenCalledTimes(1);
    expect(engine.complete).toHaveBeenCalledWith('sess-1', 'candidate_ended', expect.any(Object));
  });
});
