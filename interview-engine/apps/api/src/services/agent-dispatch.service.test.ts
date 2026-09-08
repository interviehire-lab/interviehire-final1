import { describe, expect, it, vi } from 'vitest';
import { ensureAgentDispatched } from './agent-dispatch.service.js';

// Regression coverage for a real production incident: a candidate's token
// endpoint returned 200, but the voice-agent worker never received a job at
// all for their room, because the only dispatch path was the token's
// embedded RoomConfiguration.agents (which only fires when LiveKit creates
// the room, and isn't guaranteed even then). ensureAgentDispatched() is the
// fix — this suite pins its decision matrix so a future change can't
// silently reintroduce a path where nobody dispatches the agent.

function makeParams() {
  return { roomName: 'interview-abc123', agentName: 'interviehire-interviewer', metadata: '{"sessionId":"abc123"}' };
}

describe('ensureAgentDispatched', () => {
  it('dispatches explicitly when the room does not exist yet (the common brand-new-interview case)', async () => {
    const roomService = { listParticipants: vi.fn().mockRejectedValue(new Error('twirp: not_found: requested room does not exist')) };
    const createDispatch = vi.fn().mockResolvedValue(undefined);
    const logger = { info: vi.fn(), error: vi.fn() };

    const outcome = await ensureAgentDispatched(
      { roomService, dispatchClient: { createDispatch }, logger },
      makeParams(),
    );

    expect(createDispatch).toHaveBeenCalledWith('interview-abc123', 'interviehire-interviewer', {
      metadata: '{"sessionId":"abc123"}',
    });
    expect(outcome).toEqual({ dispatched: true, reason: 'room-not-found' });
    expect(logger.info).toHaveBeenCalledWith(
      { roomName: 'interview-abc123', agentName: 'interviehire-interviewer' },
      'explicitly dispatched agent for interview session',
    );
  });

  it('dispatches explicitly when the room exists but has no live (non-candidate) participant — the retry case', async () => {
    const roomService = {
      listParticipants: vi.fn().mockResolvedValue([{ identity: 'candidate-abc123-def456' }]),
    };
    const createDispatch = vi.fn().mockResolvedValue(undefined);

    const outcome = await ensureAgentDispatched(
      { roomService, dispatchClient: { createDispatch } },
      makeParams(),
    );

    expect(createDispatch).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ dispatched: true, reason: 'no-live-agent' });
  });

  it('does NOT dispatch a second agent when a live agent is already in the room', async () => {
    const roomService = {
      listParticipants: vi.fn().mockResolvedValue([
        { identity: 'candidate-abc123-def456' },
        { identity: 'agent-AW_xyz' },
      ]),
    };
    const createDispatch = vi.fn().mockResolvedValue(undefined);

    const outcome = await ensureAgentDispatched(
      { roomService, dispatchClient: { createDispatch } },
      makeParams(),
    );

    expect(createDispatch).not.toHaveBeenCalled();
    expect(outcome).toEqual({ dispatched: false, reason: 'live-agent-present' });
  });

  it('treats a room with only candidate identities (two tabs / duplicate join) as having no live agent', async () => {
    const roomService = {
      listParticipants: vi.fn().mockResolvedValue([
        { identity: 'candidate-abc123-def456' },
        { identity: 'candidate-abc123-aaaa11' },
      ]),
    };
    const createDispatch = vi.fn().mockResolvedValue(undefined);

    const outcome = await ensureAgentDispatched(
      { roomService, dispatchClient: { createDispatch } },
      makeParams(),
    );

    expect(createDispatch).toHaveBeenCalledTimes(1);
    expect(outcome.dispatched).toBe(true);
  });

  it('does not throw and reports dispatch-failed when createDispatch itself errors', async () => {
    const roomService = { listParticipants: vi.fn().mockResolvedValue([]) };
    const createDispatch = vi.fn().mockRejectedValue(new Error('LiveKit API unreachable'));
    const logger = { info: vi.fn(), error: vi.fn() };

    const outcome = await ensureAgentDispatched(
      { roomService, dispatchClient: { createDispatch }, logger },
      makeParams(),
    );

    expect(outcome).toEqual({ dispatched: false, reason: 'dispatch-failed' });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error), roomName: 'interview-abc123' }),
      'explicit agent dispatch failed; falling back to token-embedded room-creation dispatch',
    );
  });

  it('works without a logger (logger is optional)', async () => {
    const roomService = { listParticipants: vi.fn().mockResolvedValue([]) };
    const createDispatch = vi.fn().mockResolvedValue(undefined);

    await expect(
      ensureAgentDispatched({ roomService, dispatchClient: { createDispatch } }, makeParams()),
    ).resolves.toEqual({ dispatched: true, reason: 'no-live-agent' });
  });

  it('treats an empty participant list the same as "no live agent" (dispatches)', async () => {
    const roomService = { listParticipants: vi.fn().mockResolvedValue([]) };
    const createDispatch = vi.fn().mockResolvedValue(undefined);

    const outcome = await ensureAgentDispatched(
      { roomService, dispatchClient: { createDispatch } },
      makeParams(),
    );

    expect(outcome).toEqual({ dispatched: true, reason: 'no-live-agent' });
  });
});
