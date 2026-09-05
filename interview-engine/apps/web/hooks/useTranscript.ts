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
//   • optionally drive the browser Web Speech API to capture candidate speech
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
  const recognitionRef = useRef<any>(null);
  const avatarRecorderRef = useRef<MediaRecorder | null>(null);
  const avatarStreamRef = useRef<MediaStream | null>(null);
  const avatarStartMsRef = useRef<number>(0);
  const avatarSegTimerRef = useRef<any>(null);
  const avatarActiveRef = useRef<boolean>(false);

  // Live flagcheck: accumulate the candidate's finalized speech and run the
  // synchronous tier-1 AI-tone heuristics over it so the room can surface a
  // warning badge in real time. The server re-runs (and blends an LLM pass) on
  // the saved transcript; this is the instant client-side signal only.
  const candidateTextRef = useRef<string>('');
  const [aiToneAssessment, setAiToneAssessment] = useState<AiToneAssessment | null>(null);

  // Visibility into browser STT — this used to fail 100% silently (no console
  // output, no UI, zero transcript captured) for any of: unsupported browser
  // (Firefox/Safari have no SpeechRecognition), mic permission actually denied,
  // no network reaching the browser's speech backend, or repeated 'no-speech'/
  // 'not-allowed'/'service-not-allowed' errors. `sttStatus`/`sttError` let the
  // room show a real indicator instead of silently producing an empty transcript.
  const [sttStatus, setSttStatus] = useState<'unsupported' | 'idle' | 'listening' | 'error'>('idle');
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

  // ── Browser Web Speech API capture for candidate speech (UE5 room) ──
  const startBrowserSTT = useCallback(() => {
    if (typeof window === 'undefined') return false;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      console.error('[STT] SpeechRecognition unsupported in this browser — candidate speech will NOT be captured. Use Chrome or Edge.');
      setSttStatus('unsupported');
      setSttError('Speech recognition is not supported in this browser (need Chrome or Edge).');
      return false;
    }
    if (recognitionRef.current) return false;
    try {
      const rec = new SR();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'en-US';
      rec.onresult = (e: any) => {
        setSttStatus('listening');
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i += 1) {
          const result = e.results[i];
          const transcript = result[0]?.transcript ?? '';
          if (result.isFinal) {
            recordEvent({ speaker: 'candidate', text: transcript, source: 'browser_stt', isFinal: true });
          } else {
            interim += transcript;
          }
        }
        setLiveCaption(interim || (queueRef.current[queueRef.current.length - 1]?.text ?? ''));
      };
      rec.onerror = (e: any) => {
        // A silent no-speech timeout is normal (candidate pausing) — everything
        // else is worth knowing about, since this used to fail with zero trace.
        if (e?.error === 'no-speech') return;
        console.error('[STT] recognition error:', e?.error, e?.message || '');
        setSttStatus('error');
        setSttError(String(e?.error || 'unknown error'));
      };
      rec.onend = () => {
        // auto-restart while we still hold the ref (network blips end recognition)
        if (recognitionRef.current === rec) {
          try { rec.start(); } catch (err) { console.error('[STT] restart failed:', err); }
        }
      };
      rec.start();
      recognitionRef.current = rec;
      setSttStatus('idle'); // flips to 'listening' on first onresult
      return true;
    } catch (err) {
      console.error('[STT] failed to start:', err);
      setSttStatus('error');
      setSttError(String((err as any)?.message || err));
      return false;
    }
  }, [recordEvent]);

  const stopBrowserSTT = useCallback(() => {
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    try { rec?.stop(); } catch { /* noop */ }
  }, []);

  useEffect(() => () => { stopBrowserSTT(); }, [stopBrowserSTT]);

  // ── Avatar/interviewer voice capture ──
  // The Convai avatar's voice arrives as audio inside the cross-origin pixel-
  // streaming iframe, so it can't be read directly. Instead we capture the
  // interview TAB's audio output (which carries the avatar's voice, NOT the
  // candidate's mic) via getDisplayMedia, record it for the whole interview, and
  // upload it on stop — the backend transcribes it with Whisper into interviewer
  // lines. Must be called from a user gesture (browser requirement).
  // Upload one finished audio segment (a self-contained webm) for server-side
  // (Deepgram) transcription. startMs anchors the segment on the interview clock.
  const uploadAvatarSegment = useCallback(async (blob: Blob, startMs: number) => {
    if (!blob.size || !sessionId) return null;
    try {
      // Fields MUST come before the file (@fastify/multipart's req.file() only
      // exposes fields parsed before the file part).
      const form = new FormData();
      form.append('speaker', 'interviewer');
      form.append('startMs', String(Math.max(0, Math.round(startMs))));
      form.append('file', blob, `interviewer-${Date.now()}.webm`);
      const res = await fetch(`${API_URL}/api/interviews/${sessionId}/transcript/audio`, { method: 'POST', body: form });
      return await res.json().catch(() => null);
    } catch {
      return null;
    }
  }, [sessionId]);

  // Record the avatar/interviewer audio in ~20s SEGMENTS, uploading each as a
  // complete webm. Segmenting (vs one blob at the end) makes a 20–30 min
  // interview robust: each chunk is transcribed as it's captured, nothing is lost
  // if the tab closes mid-interview, and we never upload one giant file.
  const SEGMENT_MS = 20000;
  const recordOneSegment = useCallback((stream: MediaStream) => {
    if (!avatarActiveRef.current) return;
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    const segStartMs = nowMs();
    avatarStartMsRef.current = segStartMs; // so stopAvatarCapture can anchor the final partial segment
    const chunks: BlobPart[] = [];
    let rec: MediaRecorder;
    try { rec = new MediaRecorder(stream, { mimeType }); } catch { return; }
    avatarRecorderRef.current = rec;
    rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      void uploadAvatarSegment(blob, segStartMs);
      // Chain the next segment while capture is still active.
      if (avatarActiveRef.current && avatarStreamRef.current) recordOneSegment(avatarStreamRef.current);
    };
    rec.start();
    avatarSegTimerRef.current = setTimeout(() => {
      try { rec.stop(); } catch { /* noop */ }
    }, SEGMENT_MS);
  }, [nowMs, uploadAvatarSegment]);

  // Capture the avatar's voice from the DEVICE's audio output. Browsers can't
  // read it silently, so we use getDisplayMedia — the candidate must pick a
  // surface (Entire Screen / this tab) AND tick "Share audio". We keep only the
  // audio track. Must be called from a user gesture.
  const startAvatarCapture = useCallback(async (): Promise<{ ok: boolean; reason?: string }> => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
      return { ok: false, reason: 'Audio capture is not supported in this browser. Use Chrome or Edge.' };
    }
    if (avatarActiveRef.current) return { ok: true };
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        // Ask for clean system/tab audio (no AEC/AGC that would mangle speech).
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } as any,
      });
      const audioTracks = stream.getAudioTracks();
      stream.getVideoTracks().forEach((t) => t.stop());
      if (!audioTracks.length) {
        stream.getTracks().forEach((t) => t.stop());
        return { ok: false, reason: 'No audio was shared. Re-share and CHECK the "Share tab audio" / "Share system audio" box.' };
      }
      const audioStream = new MediaStream(audioTracks);
      avatarStreamRef.current = audioStream;
      avatarActiveRef.current = true;
      // If the candidate stops sharing from the browser bar, mark inactive.
      audioTracks[0].addEventListener('ended', () => { avatarActiveRef.current = false; });
      recordOneSegment(audioStream);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, reason: err?.name === 'NotAllowedError' ? 'Screen/audio sharing was denied — it’s required to record the interviewer.' : 'Could not start interviewer audio capture.' };
    }
  }, [recordOneSegment]);

  // Same as startAvatarCapture, but records from an audio stream we ALREADY have
  // (the audio track siphoned off the proctoring screen-share). This avoids a
  // second getDisplayMedia prompt — the candidate only shares their screen once.
  // Falls back to startAvatarCapture (a dedicated prompt) if no audio is given.
  const startAvatarCaptureFromStream = useCallback(
    (audioStream: MediaStream | null): { ok: boolean; reason?: string } => {
      if (avatarActiveRef.current) return { ok: true };
      const audioTracks = audioStream?.getAudioTracks() ?? [];
      if (!audioTracks.length) {
        return { ok: false, reason: 'No audio was shared. Re-share your screen and CHECK the "Share system/tab audio" box.' };
      }
      const audio = new MediaStream(audioTracks);
      avatarStreamRef.current = audio;
      avatarActiveRef.current = true;
      audioTracks[0].addEventListener('ended', () => { avatarActiveRef.current = false; });
      recordOneSegment(audio);
      return { ok: true };
    },
    [recordOneSegment],
  );

  // Stop avatar capture: end the current segment (which uploads it) and release
  // the shared stream. Returns the last upload result (or null).
  const stopAvatarCapture = useCallback(async (): Promise<any> => {
    avatarActiveRef.current = false;
    if (avatarSegTimerRef.current) { clearTimeout(avatarSegTimerRef.current); avatarSegTimerRef.current = null; }
    const rec = avatarRecorderRef.current;
    avatarRecorderRef.current = null;
    let result: any = null;
    if (rec && rec.state !== 'inactive') {
      const segStartMs = avatarStartMsRef.current;
      const blob: Blob = await new Promise((resolve) => {
        const chunks: BlobPart[] = [];
        rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
        rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
        try { rec.requestData?.(); rec.stop(); } catch { resolve(new Blob([], { type: 'audio/webm' })); }
      });
      result = await uploadAvatarSegment(blob, segStartMs);
    }
    avatarStreamRef.current?.getTracks().forEach((t) => t.stop());
    avatarStreamRef.current = null;
    return result;
  }, [uploadAvatarSegment]);

  useEffect(() => () => {
    avatarStreamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  return {
    aiToneAssessment,
    sttStatus,
    sttError,
    liveCaption,
    markStart,
    nowMs,
    recordEvent,
    flush,
    finalize,
    downloadUrl,
    startBrowserSTT,
    stopBrowserSTT,
    startAvatarCapture,
    startAvatarCaptureFromStream,
    stopAvatarCapture,
  };
}
