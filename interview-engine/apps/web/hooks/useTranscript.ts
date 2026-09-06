'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { API_URL } from '@/lib/api';
import { analyzeAiToneHeuristics, type AiToneAssessment } from '@interviehire/shared';

// ─────────────────────────────────────────────────────────────────────────────
// useTranscript — client-side transcript capture for the interview room.
//
// Responsibilities:
//   • stamp every utterance with a timestamp relative to interview start
//   • queue events and flush them to the backend in batches
//   • survive network interruptions (failed flushes are re-queued + retried;
//     a final flush is attempted on tab close via sendBeacon)
//
// The backend ALSO captures the conversation server-side, so this layer is
// additive — duplicates are removed during finalization. That means a flaky mic
// or STT never produces an empty transcript.
// ─────────────────────────────────────────────────────────────────────────────

export type TranscriptSpeaker = 'candidate' | 'interviewer';
export type TranscriptSource = 'convai' | 'browser_stt' | 'whisper' | 'manual';

export interface TranscriptEventInput {
  speaker: TranscriptSpeaker;
  text: string;
  source: TranscriptSource;
  isFinal?: boolean;
}

interface QueuedEvent extends TranscriptEventInput {
  timestampMs: number;
  createdAt: string;
}

const FLUSH_INTERVAL_MS = 4000;

export function useTranscript(sessionId: string) {
  const startRef = useRef<number>(Date.now());
  const queueRef = useRef<QueuedEvent[]>([]);
  const flushingRef = useRef(false);

  // Live flagcheck: accumulate the candidate's finalized speech and run the
  // synchronous tier-1 AI-tone heuristics over it so the room can surface a
  // warning badge in real time. The server re-runs (and blends an LLM pass) on
  // the saved transcript; this is the instant client-side signal only.
  const candidateTextRef = useRef<string>('');
  const [aiToneAssessment, setAiToneAssessment] = useState<AiToneAssessment | null>(null);

  // Live-transcription status for the room's debug caption bar, driven by
  // acceptExternalTranscript() below (the LiveKit director's transcript
  // events) — flips to 'listening' once the first utterance arrives.
  const [sttStatus, setSttStatus] = useState<'unsupported' | 'unavailable' | 'idle' | 'listening' | 'error'>('idle');
  const [sttError, setSttError] = useState<string | null>(null);
  // Live caption text (interim + final), for the demo/debug on-screen caption —
  // separate from queueRef, which only holds committed events for the backend.
  const [liveCaption, setLiveCaption] = useState('');

  // Mark the interview start so timestamps are relative to it.
  const markStart = useCallback(() => {
    startRef.current = Date.now();
  }, []);

  const nowMs = useCallback(() => Math.max(0, Date.now() - startRef.current), []);

  const flush = useCallback(async () => {
    if (flushingRef.current || !sessionId) return;
    if (queueRef.current.length === 0) return;
    flushingRef.current = true;
    const batch = queueRef.current.splice(0, queueRef.current.length);
    try {
      const res = await fetch(`${API_URL}/api/interviews/${sessionId}/transcript/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: batch }),
      });
      if (!res.ok) throw new Error(`flush failed: ${res.status}`);
    } catch {
      // Network interruption: put the batch back at the front and retry later.
      queueRef.current = [...batch, ...queueRef.current];
    } finally {
      flushingRef.current = false;
    }
  }, [sessionId]);

  const recordEvent = useCallback((event: TranscriptEventInput) => {
    const text = (event.text || '').trim();
    if (!text) return; // ignore empty text up front

    // Tier-1 flagcheck over the candidate's finalized speech so far.
    if (event.speaker === 'candidate' && (event.isFinal ?? true)) {
      candidateTextRef.current = `${candidateTextRef.current} ${text}`.trim();
      setAiToneAssessment(analyzeAiToneHeuristics(candidateTextRef.current));
    }

    queueRef.current.push({
      speaker: event.speaker,
      text,
      source: event.source,
      isFinal: event.isFinal ?? true,
      timestampMs: Math.max(0, Date.now() - startRef.current),
      createdAt: new Date().toISOString(),
    });
  }, []);

  // The LiveKit voice agent persists both sides through
  // handleCandidateTranscript(), so this only updates browser-visible state.
  // It intentionally does not enqueue another transcript event (which would
  // duplicate the server-owned conversation).
  const acceptExternalTranscript = useCallback((
    speaker: TranscriptSpeaker,
    text: string,
    isFinal = true,
  ) => {
    const clean = text.trim();
    if (!clean) return;
    setLiveCaption(clean);
    setSttError(null);
    setSttStatus('listening');
    if (speaker === 'candidate' && isFinal) {
      candidateTextRef.current = `${candidateTextRef.current} ${clean}`.trim();
      setAiToneAssessment(analyzeAiToneHeuristics(candidateTextRef.current));
    }
  }, []);

  // Periodic background flush.
  useEffect(() => {
    if (!sessionId) return;
    const id = setInterval(() => { void flush(); }, FLUSH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [sessionId, flush]);

  // Best-effort final flush if the interview ends unexpectedly (tab close/reload).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => {
      if (!sessionId || queueRef.current.length === 0) return;
      try {
        const blob = new Blob(
          [JSON.stringify({ events: queueRef.current })],
          { type: 'application/json' },
        );
        navigator.sendBeacon?.(`${API_URL}/api/interviews/${sessionId}/transcript/event`, blob);
      } catch {
        /* nothing more we can do on unload */
      }
    };
    window.addEventListener('pagehide', handler);
    window.addEventListener('beforeunload', handler);
    return () => {
      window.removeEventListener('pagehide', handler);
      window.removeEventListener('beforeunload', handler);
    };
  }, [sessionId]);

  const finalize = useCallback(async () => {
    await flush();
    try {
      const res = await fetch(`${API_URL}/api/interviews/${sessionId}/transcript/finalize`, { method: 'POST' });
      return await res.json();
    } catch {
      return null;
    }
  }, [sessionId, flush]);

  const downloadUrl = useCallback(
    () => `${API_URL}/api/interviews/${sessionId}/transcript/file`,
    [sessionId],
  );

  return {
    aiToneAssessment,
    sttStatus,
    sttError,
    liveCaption,
    markStart,
    nowMs,
    recordEvent,
    acceptExternalTranscript,
    flush,
    finalize,
    downloadUrl,
  };
}
