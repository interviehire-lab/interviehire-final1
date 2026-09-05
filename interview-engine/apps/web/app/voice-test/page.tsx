'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { AIVisualAssistant, type AssistantMode } from '@/app/interviewcandidateroom/AIVisualAssistant';
import { roomStyles } from '@/app/interviewcandidateroom/roomStyles';
import { useVoiceInterview, type VoiceActivity, type VoiceTranscript } from '@/hooks/useVoiceInterview';

// Minimal harness for manually testing the real-time voice pipeline (director +
// LiveKit + AgentAudioVisualizerAura) with a real back-and-forth conversation,
// without the full candidate-room consent/permission/proctoring flow. Talks to
// the same demo session data as /interviewcandidateroom's sessionId=demo-session
// path, via POST /api/interview/voice-test-session.

type Phase = 'preparing' | 'ready' | 'connecting' | 'live' | 'ended' | 'error';

export default function VoiceTestPage() {
  const [phase, setPhase] = useState<Phase>('preparing');
  const [sessionId, setSessionId] = useState('');
  const [initialQuestion, setInitialQuestion] = useState('');
  const [activity, setActivity] = useState<VoiceActivity>('idle');
  const [transcript, setTranscript] = useState<VoiceTranscript[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [micOn, setMicOn] = useState(true);
  const micStreamRef = useRef<MediaStream | null>(null);

  const handleTranscript = useCallback((event: VoiceTranscript) => {
    setTranscript((current) => {
      // Coalesce partial→final updates for the same speaker into one line
      // instead of spamming the list with every interim transcript tick.
      const last = current[current.length - 1];
      if (last && last.role === event.role && !last.isFinal) {
        return [...current.slice(0, -1), event];
      }
      return [...current, event];
    });
  }, []);

  const handleActivity = useCallback((next: VoiceActivity) => setActivity(next), []);

  const handleEnded = useCallback((reason?: string) => {
    setPhase('ended');
    setActivity('idle');
    if (reason) console.info('[voice-test] call ended:', reason);
  }, []);

  const handleError = useCallback((message: string, error?: unknown) => {
    console.error('[voice-test] voice error', error || message);
    setErrorMsg(message);
    setPhase('error');
  }, []);

  const voice = useVoiceInterview({
    provider: 'livekit',
    sessionId,
    getInviteToken: () => '',
    onTranscript: handleTranscript,
    onActivity: handleActivity,
    onEnded: handleEnded,
    onError: handleError,
  });

  const prepareSession = useCallback(async () => {
    setPhase('preparing');
    setErrorMsg('');
    setTranscript([]);
    try {
      const created = await api<{ sessionId: string }>('/api/interview/voice-test-session', { method: 'POST' });
      const started = await api<{ initialQuestion: string }>(
        `/api/interview/sessions/${created.sessionId}/start`,
        { method: 'POST' },
      );
      setSessionId(created.sessionId);
      setInitialQuestion(started.initialQuestion);
      setPhase('ready');
    } catch (error) {
      handleError(error instanceof Error ? error.message : 'Failed to prepare a test session.', error);
    }
  }, [handleError]);

  useEffect(() => {
    void prepareSession();
    // Prepare once on mount only — re-preparing is done explicitly via the
    // "New session" button, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startCall() {
    setErrorMsg('');
    setPhase('connecting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      await voice.start({ firstQuestion: initialQuestion, microphoneTrack: stream.getAudioTracks()[0] || null });
      setPhase('live');
    } catch (error) {
      handleError(error instanceof Error ? error.message : 'Could not start the voice call.', error);
    }
  }

  async function endCall() {
    await voice.stop();
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
    setPhase('ended');
    setActivity('idle');
  }

  function toggleMic() {
    const next = !micOn;
    micStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = next; });
    voice.setMuted(!next);
    setMicOn(next);
  }

  function newSession() {
    void endCall().then(() => prepareSession());
  }

  const assistantMode: AssistantMode = phase === 'connecting' || phase === 'preparing'
    ? 'connecting'
    : phase === 'live'
      ? activity
      : phase === 'ended'
        ? 'complete'
        : 'idle';

  const canStart = phase === 'ready';
  const isLive = phase === 'live';

  return (
    <div className="voice-test-page">
      <style>{roomStyles}</style>
      <style>{`
        .voice-test-page { min-height: 100vh; background: #060810; color: #e5e7eb; font-family: system-ui, sans-serif; display: flex; flex-direction: column; }
        .vt-header { padding: 14px 20px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,.08); }
        .vt-title { font-weight: 600; font-size: 15px; }
        .vt-badge { font-size: 11px; padding: 3px 8px; border-radius: 999px; background: rgba(255,255,255,.08); text-transform: uppercase; letter-spacing: .04em; }
        .vt-body { flex: 1; display: grid; grid-template-columns: minmax(280px, 420px) 1fr; gap: 0; min-height: 0; }
        .vt-visual { position: relative; min-height: 320px; }
        .vt-panel { display: flex; flex-direction: column; border-left: 1px solid rgba(255,255,255,.08); min-height: 0; }
        .vt-controls { padding: 14px 16px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; border-bottom: 1px solid rgba(255,255,255,.08); }
        .vt-btn { padding: 7px 14px; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.04); color: #e5e7eb; font-size: 13px; cursor: pointer; }
        .vt-btn:disabled { opacity: .4; cursor: not-allowed; }
        .vt-btn.danger { border-color: #f95738; color: #f95738; }
        .vt-btn.primary { background: #d4ff00; color: #06141b; border-color: #d4ff00; font-weight: 600; }
        .vt-error { padding: 10px 16px; background: rgba(249,87,56,.12); color: #fca5a5; font-size: 13px; border-bottom: 1px solid rgba(249,87,56,.3); }
        .vt-transcript { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
        .vt-line { max-width: 80%; padding: 8px 12px; border-radius: 10px; font-size: 13.5px; line-height: 1.4; }
        .vt-line.candidate { align-self: flex-end; background: #1f2937; }
        .vt-line.interviewer { align-self: flex-start; background: rgba(103,232,249,.12); border: 1px solid rgba(103,232,249,.25); }
        .vt-line.partial { opacity: .55; font-style: italic; }
        .vt-line-role { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; opacity: .6; margin-bottom: 3px; }
        .vt-empty { opacity: .4; font-size: 13px; padding: 16px; }
      `}</style>

      <header className="vt-header">
        <div className="vt-title">Voice pipeline test (LiveKit)</div>
        <div className="vt-badge">{phase}</div>
      </header>

      {errorMsg && <div className="vt-error">{errorMsg}</div>}

      <div className="vt-body">
        <div className="vt-visual">
          <AIVisualAssistant mode={assistantMode} useAura audioTrack={voice.agentAudioTrack} />
        </div>

        <div className="vt-panel">
          <div className="vt-controls">
            {!isLive ? (
              <button className="vt-btn primary" disabled={!canStart} onClick={startCall}>
                {phase === 'connecting' ? 'Connecting…' : 'Start call'}
              </button>
            ) : (
              <>
                <button className="vt-btn" onClick={toggleMic}>{micOn ? 'Mute' : 'Unmute'}</button>
                <button className="vt-btn danger" onClick={endCall}>End call</button>
              </>
            )}

            <button className="vt-btn" disabled={isLive || phase === 'connecting' || phase === 'preparing'} onClick={newSession}>
              New session
            </button>
          </div>

          <div className="vt-transcript">
            {transcript.length === 0 && <div className="vt-empty">Transcript will appear here once the call starts.</div>}
            {transcript.map((line, index) => (
              <div key={index} className={`vt-line ${line.role}${line.isFinal ? '' : ' partial'}`}>
                <div className="vt-line-role">{line.role}</div>
                {line.text}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
