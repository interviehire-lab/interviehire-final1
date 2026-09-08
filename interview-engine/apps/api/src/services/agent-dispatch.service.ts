export interface RoomParticipantsLister {
  listParticipants(roomName: string): Promise<Array<{ identity: string }>>;
}

export interface AgentDispatcher {
  createDispatch(roomName: string, agentName: string, opts: { metadata: string }): Promise<unknown>;
}

export interface DispatchLogger {
  info?(obj: Record<string, unknown>, msg: string): void;
  error?(obj: Record<string, unknown>, msg: string): void;
}

export type DispatchOutcome =
  | { dispatched: true; reason: 'room-not-found' | 'no-live-agent' }
  | { dispatched: false; reason: 'live-agent-present' | 'dispatch-failed' };

/**
 * Ensures a LiveKit agent is present in the room, dispatching one explicitly
 * rather than trusting the access token's embedded RoomConfiguration.agents
 * to fire reliably at room-creation time. That embedded dispatch only fires
 * when LiveKit itself creates the room, and even then isn't guaranteed —
 * production logs showed a candidate's token issued fine (200) while the
 * voice-agent worker never received a job at all for a brand-new room. So
 * explicit dispatch is the primary path here, skipped only when a live
 * (non-candidate) participant is confirmed already in the room.
 */
export async function ensureAgentDispatched(
  deps: { roomService: RoomParticipantsLister; dispatchClient: AgentDispatcher; logger?: DispatchLogger },
  params: { roomName: string; agentName: string; metadata: string },
): Promise<DispatchOutcome> {
  const { roomService, dispatchClient, logger } = deps;
  const { roomName, agentName, metadata } = params;

  let hasLiveAgent = false;
  let roomLookupFailed = false;
  try {
    const participants = await roomService.listParticipants(roomName);
    hasLiveAgent = participants.some((p) => !p.identity.startsWith('candidate-'));
  } catch {
    // listParticipants throws when the room doesn't exist yet — the normal
    // first-connect case. Fall through and dispatch explicitly.
    roomLookupFailed = true;
  }

  if (hasLiveAgent) {
    return { dispatched: false, reason: 'live-agent-present' };
  }

  try {
    await dispatchClient.createDispatch(roomName, agentName, { metadata });
    logger?.info?.({ roomName, agentName }, 'explicitly dispatched agent for interview session');
    return { dispatched: true, reason: roomLookupFailed ? 'room-not-found' : 'no-live-agent' };
  } catch (err) {
    logger?.error?.(
      { err, roomName, agentName },
      'explicit agent dispatch failed; falling back to token-embedded room-creation dispatch',
    );
    return { dispatched: false, reason: 'dispatch-failed' };
  }
}
