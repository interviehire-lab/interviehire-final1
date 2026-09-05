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

export type VoiceProvider = 'legacy' | 'livekit';
export type VoiceActivity = 'idle' | 'thinking' | 'speaking';
export type VoiceTranscript = {
  role: 'candidate' | 'interviewer';
  text: string;
  isFinal: boolean;
};

type StartOptions = {
  firstQuestion: string;
  microphoneTrack?: MediaStreamTrack | null;
};

type UseVoiceInterviewOptions = {
  provider: VoiceProvider;
  sessionId: string;
  getInviteToken: () => string;
  onTranscript: (event: VoiceTranscript) => void;
  onActivity: (activity: VoiceActivity) => void;
  onEnded: (reason?: string) => void;
  onError: (message: string, error?: unknown) => void;
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

export function useVoiceInterview({
  provider,
  sessionId,
  getInviteToken,
  onTranscript,
  onActivity,
  onEnded,
  onError,
}: UseVoiceInterviewOptions) {
  const callbacksRef = useRef({ onTranscript, onActivity, onEnded, onError });
  const roomRef = useRef<Room | null>(null);
  const publishedMicRef = useRef<{ track: MediaStreamTrack; publication: LocalTrackPublication } | null>(null);
  const audioElementsRef = useRef<Set<HTMLMediaElement>>(new Set());
  const activeRef = useRef(false);
  const deliberateStopRef = useRef(false);
  const endedDeliveredRef = useRef(false);
  const agentConnectedRef = useRef(false);
  const agentJoinTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [connected, setConnected] = useState(false);
  const [deadlineAt, setDeadlineAt] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [hardLimitSeconds, setHardLimitSeconds] = useState(1800);
  // The real remote agent-audio track, once LiveKit subscribes to it — this is
  // AgentAudioVisualizerAura's `audioTrack` input, giving it a genuine
  // per-frame waveform (via @livekit/components-react's own AnalyserNode-based
  // useTrackVolume, smoothed there) instead of anything we compute ourselves.
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

  const markAgentConnected = useCallback(() => {
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
      }
      return;
    }
    for (const element of audioElementsRef.current) element.remove();
    audioElementsRef.current.clear();
  }, []);

  const stop = useCallback(async () => {
    deliberateStopRef.current = true;
    activeRef.current = false;
    setConnected(false);
    setAgentAudioTrack(null);
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

  const start = useCallback(async ({ firstQuestion: _firstQuestion, microphoneTrack }: StartOptions) => {
    if (provider === 'legacy') return;
    if (activeRef.current) return;

    deliberateStopRef.current = false;
    endedDeliveredRef.current = false;
    setDeadlineAt(null);
    setStartedAt(null);
    setAgentAudioTrack(null);
    markAgentDisconnected();

    if (!microphoneTrack || microphoneTrack.readyState !== 'live') {
      throw new Error('The granted microphone stream is unavailable. Recheck microphone permission and try again.');
    }

    const inviteToken = getInviteToken();
    const query = inviteToken ? `?token=${encodeURIComponent(inviteToken)}` : '';
    const response = await fetch(`${API_URL}/api/interview/sessions/${sessionId}/livekit-token${query}`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) {
      throw new Error(typeof payload?.error === 'string' && payload.error
        ? payload.error
        : `LiveKit connection setup failed (${response.status}).`);
    }
    const credentials = payload as LiveKitCredentials | null;
    if (!credentials?.url || !credentials?.token) throw new Error('The engine returned incomplete LiveKit credentials.');

    setStartedAt(credentials.startedAt || new Date().toISOString());
    setHardLimitSeconds(Number(credentials.hardLimitSeconds) || 1800);
    setDeadlineAt(credentials.deadlineAt || null);

    const room = new Room({ adaptiveStream: true, dynacast: true, disconnectOnPageLeave: true });
    roomRef.current = room;
    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind !== Track.Kind.Audio) return;
      setAgentAudioTrack(track as RemoteAudioTrack);
      const element = track.attach();
      element.autoplay = true;
      element.style.display = 'none';
      document.body.appendChild(element);
      audioElementsRef.current.add(element);
      void element.play().catch(() => {
        callbacksRef.current.onError('Interviewer audio was blocked by the browser. Click once in the room to enable audio.');
      });
    });
    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      if (track.kind === Track.Kind.Audio) setAgentAudioTrack(null);
      detachRemoteAudio(track);
    });
    room.on(RoomEvent.Reconnecting, () => callbacksRef.current.onActivity('thinking'));
    room.on(RoomEvent.Reconnected, () => callbacksRef.current.onActivity('idle'));
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
        emitEnded(typeof message.reason === 'string' ? message.reason : 'director-completed');
      } else if (message.type === 'session' && message.state === 'started') {
        markAgentConnected();
      }
    });
    room.on(RoomEvent.Disconnected, () => {
      activeRef.current = false;
      setConnected(false);
      setAgentAudioTrack(null);
      markAgentDisconnected();
      detachRemoteAudio();
      callbacksRef.current.onActivity('idle');
      if (!deliberateStopRef.current) emitEnded('room-disconnected');
    });

    callbacksRef.current.onActivity('thinking');
    await room.connect(credentials.url, credentials.token, { autoSubscribe: true });
    try {
      const publication = await room.localParticipant.publishTrack(microphoneTrack, {
        source: Track.Source.Microphone,
      });
      publishedMicRef.current = { track: microphoneTrack, publication };
    } catch (error) {
      await room.disconnect();
      throw error;
    }
    activeRef.current = true;
    setConnected(true);
    callbacksRef.current.onActivity('idle');

    // Safety net: if the worker never dispatches/joins (LiveKit region issue,
    // agent crash, a payload the worker rejects), don't leave the candidate
    // staring at "connecting" forever with no way to know something's wrong.
    clearAgentJoinTimeout();
    agentJoinTimeoutRef.current = setTimeout(() => {
      if (agentConnectedRef.current || deliberateStopRef.current) return;
      callbacksRef.current.onError("Couldn't connect you with your interviewer. Please refresh and try again.");
    }, 20_000);
  }, [clearAgentJoinTimeout, detachRemoteAudio, emitEnded, getInviteToken, provider, sessionId]);

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
    start,
    stop,
    setMuted,
    connected,
    startedAt,
    deadlineAt,
    hardLimitSeconds,
    agentAudioTrack,
    agentConnected,
  };
}
