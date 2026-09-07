'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Room,
  RoomEvent,
  Track,
  type LocalTrackPublication,
  type RemoteAudioTrack,
  type RemoteTrack,
} from 'livekit-client';
import { API_URL } from '@/lib/api';

export type VoiceActivity = 'idle' | 'thinking' | 'speaking';
export type VoiceTranscript = {
  role: 'candidate' | 'interviewer';
  text: string;
  isFinal: boolean;
};

type UseVoiceInterviewOptions = {
  sessionId: string;
  getInviteToken: () => string;
  onTranscript: (event: VoiceTranscript) => void;
  onActivity: (activity: VoiceActivity) => void;
  onEnded: (reason?: string) => void;
  onError: (message: string, error?: unknown) => void;
  /**
   * Whether the candidate has actually finished whatever pre-interview gates
   * the caller runs (permission grant, gaze calibration) and is ready to
   * hear the agent. Defaults to true (unchanged behavior) for callers that
   * don't have such a gate. The agent worker joins the room — and may start
   * speaking — well before this is true (it's dispatched right after
   * consent to hide connection latency), so this only controls whether
   * ALREADY-ARRIVED agent audio is actually played on this client; it's a
   * client-side backstop for `voice-agent`'s own (much longer)
   * CANDIDATE_READY_TIMEOUT_MS safety net, not the primary fix for making
   * the agent wait.
   */
  readyToListen?: boolean;
};

type LiveKitCredentials = {
  url: string;
  token: string;
  roomName?: string;
  startedAt?: string;
  deadlineAt?: string;
  hardLimitSeconds?: number;
};

function parseLiveKitMessage(payload: Uint8Array): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(payload));
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

// Consistent, greppable prefix (matches page.tsx's existing '[livekit] voice
// error' log) for every step of the connect → agent-join → first-audio
// sequence. This sequence spans two processes (this browser tab and the
// voice-agent worker) and several async gates, so when something goes wrong
// — like a candidate hearing the agent's voice while the UI still shows a
// connection error — a plain stack trace won't explain it; a timestamped
// trail of which step actually happened will.
function logVoice(event: string, data?: Record<string, unknown>) {
  console.info(`[livekit] ${event}`, { ts: new Date().toISOString(), ...data });
}

export function useVoiceInterview({
  sessionId,
  getInviteToken,
  onTranscript,
  onActivity,
  onEnded,
  onError,
  readyToListen,
}: UseVoiceInterviewOptions) {
  const callbacksRef = useRef({ onTranscript, onActivity, onEnded, onError });
  const roomRef = useRef<Room | null>(null);
  const publishedMicRef = useRef<{ track: MediaStreamTrack; publication: LocalTrackPublication } | null>(null);
  const audioElementsRef = useRef<Set<HTMLMediaElement>>(new Set());
  // Elements that arrived (TrackSubscribed fired) before readyToListen was
  // true — played as soon as it flips, by the effect below. A ref (not
  // state) since it's mutated from the TrackSubscribed closure and doesn't
  // itself need to trigger a re-render.
  const pendingAudioRef = useRef<Set<HTMLMediaElement>>(new Set());
  const readyToListenRef = useRef(readyToListen ?? true);
  useEffect(() => {
    readyToListenRef.current = readyToListen ?? true;
    if (readyToListenRef.current) {
      for (const element of pendingAudioRef.current) {
        void element.play().catch(() => {
          callbacksRef.current.onError('Interviewer audio was blocked by the browser. Click once in the room to enable audio.');
        });
      }
      pendingAudioRef.current.clear();
    }
  }, [readyToListen]);
  const activeRef = useRef(false);
  const deliberateStopRef = useRef(false);
  const endedDeliveredRef = useRef(false);
  const agentConnectedRef = useRef(false);
  const agentJoinTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // When connect() started — purely for elapsed-time context in logVoice calls
  // below, so a timeout firing (or not) can be read against how long each
  // prior step actually took.
  const connectStartMsRef = useRef<number | null>(null);
  const [connected, setConnected] = useState(false);
  // The raw LiveKit Room instance, reactively exposed once connect() resolves —
  // available to any consumer that needs direct Room access.
  const [room, setRoom] = useState<Room | null>(null);
  const [deadlineAt, setDeadlineAt] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [hardLimitSeconds, setHardLimitSeconds] = useState(1800);
  // The real remote agent-audio track, once LiveKit subscribes to it.
  // AIVisualAssistant feeds this straight into AgentAudioVisualizerAura's
  // `audioTrack` prop, which reads its live per-frame volume via LiveKit's
  // own useTrackVolume (Web Audio AnalyserNode) to drive the aura's motion.
  const [agentAudioTrack, setAgentAudioTrack] = useState<RemoteAudioTrack | null>(null);
  // Room-level `connected` only means the BROWSER reached LiveKit Cloud — the
  // voice-agent worker is dispatched to the room as a separate async process
  // and can take a few seconds to actually join, initialize VAD, and connect
  // to Deepgram/Cartesia. agentConnected tracks the worker's own explicit
  // `{type:'session', state:'started'}` data message (interview-session.ts's
  // `publish()`, sent once it has genuinely joined and started its timers) —
  // the real "ready" signal, not just room connectivity.
  const [agentConnected, setAgentConnected] = useState(false);

  callbacksRef.current = { onTranscript, onActivity, onEnded, onError };

  const emitEnded = useCallback((reason?: string) => {
    if (endedDeliveredRef.current) return;
    endedDeliveredRef.current = true;
    callbacksRef.current.onEnded(reason);
  }, []);

  const clearAgentJoinTimeout = useCallback(() => {
    if (agentJoinTimeoutRef.current != null) {
      clearTimeout(agentJoinTimeoutRef.current);
      agentJoinTimeoutRef.current = null;
    }
  }, []);

  const markAgentConnected = useCallback((reason: 'session-started-message' | 'audio-track-subscribed') => {
    if (agentConnectedRef.current) return;
    logVoice('agent connected', { reason, elapsedMs: connectStartMsRef.current ? Date.now() - connectStartMsRef.current : null });
    clearAgentJoinTimeout();
    agentConnectedRef.current = true;
    setAgentConnected(true);
  }, [clearAgentJoinTimeout]);

  const markAgentDisconnected = useCallback(() => {
    clearAgentJoinTimeout();
    agentConnectedRef.current = false;
    setAgentConnected(false);
  }, [clearAgentJoinTimeout]);

  const detachRemoteAudio = useCallback((track?: RemoteTrack) => {
    if (track?.kind === Track.Kind.Audio) {
      for (const element of track.detach()) {
        element.remove();
        audioElementsRef.current.delete(element);
        pendingAudioRef.current.delete(element);
      }
      return;
    }
    for (const element of audioElementsRef.current) element.remove();
    audioElementsRef.current.clear();
    pendingAudioRef.current.clear();
  }, []);

  const stop = useCallback(async () => {
    deliberateStopRef.current = true;
    activeRef.current = false;
    setConnected(false);
    setAgentAudioTrack(null);
    setRoom(null);
    markAgentDisconnected();

    const room = roomRef.current;
    roomRef.current = null;
    if (room) {
      const publishedMic = publishedMicRef.current;
      if (publishedMic) {
        // This is the proctoring stream's microphone track. Unpublish without
        // stopping it so recording/camera cleanup stays owned by useProctoring.
        await room.localParticipant.unpublishTrack(publishedMic.track, false).catch(() => undefined);
      }
      publishedMicRef.current = null;
      detachRemoteAudio();
      room.removeAllListeners();
      await room.disconnect();
    }
    callbacksRef.current.onActivity('idle');
  }, [detachRemoteAudio, markAgentDisconnected]);

  // connect() covers everything through room.connect() and event wiring —
  // deliberately WITHOUT publishing a microphone track. room.connect() reaching
  // LiveKit is what triggers the LiveKit Agents worker's dispatch (the access
  // token embeds RoomConfiguration.agents), so calling this alone, as early as
  // right after consent, gets the agent joining in parallel with the
  // permission-grant and calibration screens instead of serialized after them.
  const connect = useCallback(async () => {
    if (activeRef.current) return;

    connectStartMsRef.current = Date.now();
    logVoice('connect() starting', { sessionId });
    deliberateStopRef.current = false;
    endedDeliveredRef.current = false;
    setDeadlineAt(null);
    setStartedAt(null);
    setAgentAudioTrack(null);
    markAgentDisconnected();

    const inviteToken = getInviteToken();
    const query = inviteToken ? `?token=${encodeURIComponent(inviteToken)}` : '';
    const response = await fetch(`${API_URL}/api/interview/sessions/${sessionId}/livekit-token${query}`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) {
      logVoice('livekit-token fetch failed', { status: response.status, error: payload?.error });
      throw new Error(typeof payload?.error === 'string' && payload.error
        ? payload.error
        : `LiveKit connection setup failed (${response.status}).`);
    }
    const credentials = payload as LiveKitCredentials | null;
    if (!credentials?.url || !credentials?.token) throw new Error('The engine returned incomplete LiveKit credentials.');
    logVoice('livekit-token fetched', { roomName: credentials.roomName });

    setStartedAt(credentials.startedAt || new Date().toISOString());
    setHardLimitSeconds(Number(credentials.hardLimitSeconds) || 1800);
    setDeadlineAt(credentials.deadlineAt || null);

    const room = new Room({ adaptiveStream: true, dynacast: true, disconnectOnPageLeave: true });
    roomRef.current = room;
    setRoom(room);
    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind !== Track.Kind.Audio) return;
      logVoice('agent audio track subscribed', { trackSid: track.sid });
      // If real audio is already flowing, the agent is unambiguously
      // connected — this is the same fact the 'session started' data message
      // exists to confirm, just observed a different way. Treating it as an
      // equally valid signal closes a real gap: `ctx.agent` on the
      // voice-agent worker can briefly still read undefined right after
      // `ctx.connect()` resolves (an SDK-internal timing gap), which used to
      // silently drop that data message with zero trace on either side —
      // the client would show "couldn't connect you with your interviewer"
      // while the candidate could already hear them talking.
      markAgentConnected('audio-track-subscribed');
      setAgentAudioTrack(track as RemoteAudioTrack);
      const element = track.attach();
      // No `autoplay` attribute — playback is driven explicitly below so it
      // can be held back until readyToListen (e.g. the candidate is still on
      // the calibration screen), rather than the browser starting it the
      // instant the element has data.
      element.style.display = 'none';
      document.body.appendChild(element);
      audioElementsRef.current.add(element);
      if (readyToListenRef.current) {
        void element.play().catch(() => {
          callbacksRef.current.onError('Interviewer audio was blocked by the browser. Click once in the room to enable audio.');
        });
      } else {
        pendingAudioRef.current.add(element);
      }
    });
    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      if (track.kind === Track.Kind.Audio) setAgentAudioTrack(null);
      detachRemoteAudio(track);
    });
    room.on(RoomEvent.Reconnecting, () => {
      logVoice('room reconnecting');
      callbacksRef.current.onActivity('thinking');
    });
    room.on(RoomEvent.Reconnected, () => {
      logVoice('room reconnected');
      callbacksRef.current.onActivity('idle');
    });
    room.on(RoomEvent.DataReceived, (payload) => {
      const message = parseLiveKitMessage(payload);
      if (!message) return;
      if (message.type === 'transcript') {
        const text = typeof message.text === 'string' ? message.text.trim() : '';
        if (!text || (message.role !== 'user' && message.role !== 'assistant')) return;
        callbacksRef.current.onTranscript({
          role: message.role === 'user' ? 'candidate' : 'interviewer',
          text,
          isFinal: message.isFinal !== false,
        });
      } else if (message.type === 'activity') {
        const activity = message.activity;
        if (activity === 'idle' || activity === 'thinking' || activity === 'speaking') {
          callbacksRef.current.onActivity(activity);
        }
      } else if (message.type === 'interview-ended') {
        logVoice('interview-ended message received', { reason: message.reason });
        emitEnded(typeof message.reason === 'string' ? message.reason : 'director-completed');
      } else if (message.type === 'session' && message.state === 'started') {
        markAgentConnected('session-started-message');
      }
    });
    room.on(RoomEvent.Disconnected, () => {
      logVoice('room disconnected', { deliberate: deliberateStopRef.current });
      activeRef.current = false;
      setConnected(false);
      setAgentAudioTrack(null);
      markAgentDisconnected();
      detachRemoteAudio();
      callbacksRef.current.onActivity('idle');
      if (!deliberateStopRef.current) emitEnded('room-disconnected');
    });

    callbacksRef.current.onActivity('thinking');
    try {
      await room.connect(credentials.url, credentials.token, { autoSubscribe: true });
    } catch (error) {
      logVoice('room.connect() failed', { error: error instanceof Error ? error.message : String(error) });
      roomRef.current = null;
      setRoom(null);
      throw error;
    }
    logVoice('room.connect() resolved', { elapsedMs: Date.now() - connectStartMsRef.current });
    activeRef.current = true;
    setConnected(true);
    callbacksRef.current.onActivity('idle');

    // Safety net: if the worker never dispatches/joins (LiveKit region issue,
    // agent crash, a payload the worker rejects), don't leave the candidate
    // staring at "connecting" forever with no way to know something's wrong.
    // Attached here (not to publishMicrophone) since room.connect() succeeding
    // is what actually triggers the worker's dispatch. Now that TrackSubscribed
    // also calls markAgentConnected (see above), reaching this branch means
    // BOTH the 'session started' message AND real agent audio failed to
    // arrive within the window — a genuine failure, not the audio-without-
    // confirmation false positive this used to produce.
    clearAgentJoinTimeout();
    agentJoinTimeoutRef.current = setTimeout(() => {
      if (agentConnectedRef.current || deliberateStopRef.current) return;
      const diagnostics = {
        elapsedMs: connectStartMsRef.current ? Date.now() - connectStartMsRef.current : null,
        roomConnected: activeRef.current,
        hadAudioTrack: audioElementsRef.current.size > 0,
        sessionId,
      };
      logVoice('agent-join timeout fired', diagnostics);
      const ref = `${sessionId.slice(0, 8)}-${Date.now().toString(36)}`;
      callbacksRef.current.onError(
        `We couldn't confirm your interviewer joined (waited 20s). This is usually temporary — please refresh and try again. If it keeps happening, share this reference with support: ${ref}`,
      );
    }, 20_000);
  }, [clearAgentJoinTimeout, detachRemoteAudio, emitEnded, getInviteToken, markAgentDisconnected, sessionId]);

  // publishMicrophone() is called once the candidate's mic permission is
  // actually granted and the stream is available (today: once calibration
  // completes) — deliberately separate from connect() so a real, multi-second
  // LiveKit-agent-join delay isn't serialized behind permission-grant/calibration.
  // Publishes against the already-connected room from connect() (via roomRef,
  // not local state, so this doesn't depend on a render having landed).
  const publishMicrophone = useCallback(async (track?: MediaStreamTrack | null) => {
    const room = roomRef.current;
    if (!room || !activeRef.current) {
      throw new Error('publishMicrophone() was called before connect() completed. Call connect() first.');
    }
    if (!track || track.readyState !== 'live') {
      throw new Error('The granted microphone stream is unavailable. Recheck microphone permission and try again.');
    }
    try {
      const publication = await room.localParticipant.publishTrack(track, {
        source: Track.Source.Microphone,
      });
      publishedMicRef.current = { track, publication };
    } catch (error) {
      await room.disconnect();
      throw error;
    }
    // Tells the voice-agent the candidate can actually hear/respond now (it may
    // otherwise resolve waitForParticipant() before the mic is published and
    // speak the first question into a room nobody can answer in yet). Wire
    // shape coordinated with the voice-agent-side work — do not change it.
    room.localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify({ type: 'candidate-ready' })),
      { reliable: true },
    );
  }, []);

  const setMuted = useCallback((muted: boolean) => {
    const publication = publishedMicRef.current?.publication;
    if (!publication) return;
    if (muted) publication.mute();
    else publication.unmute();
  }, []);

  useEffect(() => () => {
    void stop();
  }, [stop]);

  return {
    connect,
    publishMicrophone,
    stop,
    setMuted,
    connected,
    room,
    startedAt,
    deadlineAt,
    hardLimitSeconds,
    agentAudioTrack,
    agentConnected,
  };
}
