'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { WS_URL, API_URL } from '@/lib/api';
import { GazeCalibration } from '@/hooks/GazeCalibration';
import { useProctoring, getBestViolationRecordingMimeType } from '@/hooks/useProctoring';
import { useTranscript } from '@/hooks/useTranscript';
import { Check, Mic, MonitorUp, ShieldCheck, Video } from 'lucide-react';
import type { CalibrationResult } from '@/hooks/useGazeCalibration';
import { roomStyles } from './roomStyles';
import { WaitingRoom } from './WaitingRoom';
import { AIVisualAssistant, type AssistantMode } from './AIVisualAssistant';
import { EARLY_ENTRY_MS } from '@interviehire/shared';
import { useVoiceInterview, type VoiceActivity, type VoiceTranscript } from '@/hooks/useVoiceInterview';

// How early a candidate may enter the room before their scheduled slot. The
// lobby unlocks and the engine's /start accepts a start once inside this window.
// EARLY_ENTRY_MS is imported from @interviehire/shared so it can never drift
// out of sync with the engine's interview.routes.ts.
// Bump when the consent wording materially changes so prior consents re-prompt.
const CONSENT_VERSION = '2026-07-01';
// Where the candidate reads the full privacy policy (linked from the consent
// gate). Override per-deployment; falls back to the marketing-site path.
const PRIVACY_URL = process.env.NEXT_PUBLIC_PRIVACY_URL || 'https://www.interviehire.com/privacy';
const CLOSING_LINE = "Thanks. That completes our interview. I'll end the session now, and your report will be prepared automatically.";

// Whether this session already has a matching, still-current "granted" consent
// stored locally. Only a matching-version grant counts; older wording or a
// decline re-prompts. Used to restore consent WITHOUT flashing the gate.
function hasStoredConsent(id: string): boolean {
  if (typeof window === 'undefined' || !id) return false;
  try {
    const raw = localStorage.getItem(`ih_consent_${id}`);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return parsed?.consentVersion === CONSENT_VERSION && parsed?.action === 'granted';
  } catch {
    return false;
  }
}

// Neutral calibration used both when the candidate explicitly skips gaze
// calibration and when proctoring is off for this job (no camera → no gaze
// tracking, so calibration is meaningless — the guard falls back to defaults).
const DEFAULT_CALIBRATION: CalibrationResult = {
  thresholdX: 0.18,
  thresholdY: 0.22,
  neutralX: 0,
  neutralY: 0,
  pointData: [],
  qualityScore: 0,
  accepted: true,
  rejectionReason: null,
  rangeX: 0,
  rangeY: 0,
  // Zero-config: no vertical sweep → the guard falls back to the default band and seeds the
  // live pitch baseline from the first live frame (headPitchDeg is ignored when untrusted).
  vTopEdge: 0,
  vBottomEdge: 0,
  vSweep: 0,
  headPitchDeg: 0,
};

const QUESTIONS: { text: string; tag: string; hint: string }[] = [
  {
    text: 'Tell me about a time you handled a difficult situation at work — what was the context, and how did you navigate it?',
    tag: 'Behavioural',
    hint: 'Take a breath. Aim for a 60–90 second answer.',
  },
  {
    text: 'Walk me through a project you are most proud of. What was your specific contribution and the measurable outcome?',
    tag: 'Experience',
    hint: 'Use numbers where you can. Keep it focused on your role.',
  },
  {
    text: 'Describe a disagreement you had with a teammate. How did you reach a resolution?',
    tag: 'Teamwork',
    hint: 'Show how you listen, not just how you argue.',
  },
  {
    text: 'Where do you see the biggest opportunity for impact in this role within your first 90 days?',
    tag: 'Strategy',
    hint: 'Be specific and tie it back to the company.',
  },
];

export default function Interview() {
  const [sessionId, setSessionId] = useState('demo-session');
  const [calibration, setCalibration] = useState<CalibrationResult | null>(null);
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [messages, setMessages] = useState<any[]>([
    { speaker: 'ai', text: 'Welcome. I will ask a few structured questions. Please answer naturally with examples.' },
  ]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [questions, setQuestions] = useState<{ text: string; tag: string; hint: string }[]>(QUESTIONS);
  const [elapsed, setElapsed] = useState(0);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  // Real-time "is the candidate actually speaking" signal for the self-view
  // highlight — separate from micOn (which only means "not manually muted").
  const [voiceActive, setVoiceActive] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const transcript = useTranscript(sessionId);
  const acceptExternalTranscript = transcript.acceptExternalTranscript;
  const wsRef = useRef<WebSocket | null>(null);
  // WebSocket reconnect-with-backoff. isDeliberateCloseRef is set right before any
  // close WE initiate (unmount cleanup, endCall) so the onclose handler below can
  // tell that apart from an unexpected drop and skip reconnecting.
  const isDeliberateCloseRef = useRef(false);
  const wsReconnectAttemptRef = useRef(0);
  const wsReconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const assistantThinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const candidateWasSpeakingRef = useRef(false);
  const [wsReconnecting, setWsReconnecting] = useState(false);
  const [assistantActivity, setAssistantActivity] = useState<'idle' | 'thinking' | 'speaking'>('idle');
  // Per-candidate invite token from the link (?ih_invite=). Forwarded to the
  // token-enforced engine endpoints (/start, GET session, WS register).
  const inviteTokenRef = useRef('');
  const sessionStartedRef = useRef(false);
  const captureStartedRef = useRef(false);
  const [transcriptReady, setTranscriptReady] = useState(false);

  // Post-interview report flow: legacy sessions use server ASR (with browser STT
  // fallback); conversational sessions are persisted by the adaptive director.
  // Both finalize and evaluate into the same report without a manual paste step.
  const [ended, setEnded] = useState(false);
  const [reportStatus, setReportStatus] = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  const [report, setReport] = useState<any>(null);
  // Recruiter-screening vs functional distinction: same room, same session mechanics,
  // driven off the stage the backend stamped into InterviewSession.settings.
  const [screeningOutcome, setScreeningOutcome] = useState<{ fits: boolean; link?: string; fitLabel?: string } | null>(null);
  const screeningEndTriggeredRef = useRef(false);
  // Per-job interview settings + branding, synced from the recruiter dashboard.
  const [interviewSettings, setInterviewSettings] = useState<any>(null);
  const [interviewSettingsLoaded, setInterviewSettingsLoaded] = useState(false);
  // Deliberately opt-in: unlike mature proctoring, real-time voice is new,
  // metered, and must be enabled explicitly per job. LiveKit is the only
  // voice provider — no per-job choice needed.
  const conversationalInterviewEnabled = interviewSettings?.conversationalInterview === true;
  const voiceProvider = conversationalInterviewEnabled ? 'livekit' : 'legacy';
  const voiceInterviewEnabled = voiceProvider !== 'legacy';
  const [branding, setBranding] = useState<{ name?: string; primaryColor?: string; logoUrl?: string; whiteLabel?: boolean } | null>(null);
  const [startError, setStartError] = useState('');
  // Scheduled-slot barrier: when a session has a future scheduledAt, the room is
  // locked behind a countdown lobby until (scheduledAt − EARLY_ENTRY_MS). null =
  // no schedule (plain link / demo) → no lobby. scheduleChecked gates the initial
  // render so we don't flash the permission gate before the slot is known.
  const [scheduledAtMs, setScheduledAtMs] = useState<number | null>(null);
  const [scheduleChecked, setScheduleChecked] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [deadlineNowMs, setDeadlineNowMs] = useState(() => Date.now());

  // Smooth over the conversational gap after an answer. The orb moves into a
  // thinking state briefly instead of appearing frozen while the next response
  // travels through transcription, evaluation, and the WebSocket.
  useEffect(() => {
    if (voiceActive) {
      candidateWasSpeakingRef.current = true;
      if (assistantThinkTimerRef.current) clearTimeout(assistantThinkTimerRef.current);
      return;
    }
    if (!candidateWasSpeakingRef.current || assistantActivity === 'speaking') return;
    candidateWasSpeakingRef.current = false;
    setAssistantActivity('thinking');
    assistantThinkTimerRef.current = setTimeout(() => setAssistantActivity('idle'), 4200);
  }, [voiceActive, assistantActivity]);

  // --- Informed-consent gate (DPDP/GDPR): must precede ANY camera / mic /
  // screen capture. Biometric (face+gaze+voice) gets its own explicit consent;
  // 18+, recording+AI, privacy policy and cookies are captured alongside it, and
  // the decision is persisted server-side as a security log. ---
  const [consentGiven, setConsentGiven] = useState(false);
  const [consentDeclined, setConsentDeclined] = useState(false);
  // Whether we've had a chance to restore a prior consent from localStorage.
  // The consent gate stays hidden (behind a neutral loader) until this flips, so
  // a returning, already-consented candidate never sees the gate flash on load.
  const [consentChecked, setConsentChecked] = useState(false);
  const [isAdult, setIsAdult] = useState(false);
  const [agreeData, setAgreeData] = useState(false);
  const [agreeBiometric, setAgreeBiometric] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [agreeCookies, setAgreeCookies] = useState(false);

  // --- Pre-interview permission gate (after consent). Prompts fire only when the
  // candidate clicks "Grant required access" — never silently on load. All three
  // (camera, microphone, screen share) must be granted, then an explicit click
  // proceeds into the interview. ---
  const [permissionsRequested, setPermissionsRequested] = useState(false);
  const [micGranted, setMicGranted] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const [permissionsAcknowledged, setPermissionsAcknowledged] = useState(false);

  const seenVoiceQuestionsRef = useRef<Set<number>>(new Set());
  const questionsRef = useRef(questions);
  const endingRef = useRef(false);
  const endCallRef = useRef<() => Promise<void>>(async () => {});

  // The dashboard's "Launch test interview" opens this room with ?sessionId=…
  // (the FastAPI test-session created from the job blueprint). Use it when
  // present; otherwise fall back to the keyless demo session below.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const queryId = params.get('sessionId') || params.get('session');
    const token = params.get('ih_invite') || params.get('token');
    if (token) inviteTokenRef.current = token;
    // Resolve the real session id first, then restore any prior consent for it —
    // both in this one effect run so the "already agreed" state lands in a single
    // render. Setting consentChecked here (never before) is what keeps the gate
    // hidden until we've decided, so a returning candidate sees no flash.
    const resolvedId = queryId || 'demo-session';
    if (queryId) setSessionId(queryId);
    if (hasStoredConsent(resolvedId)) setConsentGiven(true);
    setConsentChecked(true);
  }, []);

  // Re-restore consent if the session id changes AFTER mount (e.g. the demo
  // bootstrap swaps in a real id). This can only reveal a prior consent — it
  // never re-shows the gate — so it can't cause the flash we just fixed.
  useEffect(() => {
    if (hasStoredConsent(sessionId)) setConsentGiven(true);
  }, [sessionId]);

  // Load per-job interview settings + company branding + the dynamic question
  // list for a real session — all three come from the same GET /sessions/:id
  // response, so one fetch covers what used to be two separate effects
  // independently hitting the identical endpoint (visible in the engine log
  // as the same GET firing twice per page load). Best effort: on any failure
  // we stay permissive so the interview still runs.
  useEffect(() => {
    if (!sessionId || sessionId === 'demo-session') {
      setQuestions(QUESTIONS);
      setInterviewSettingsLoaded(true);
      return;
    }
    setInterviewSettingsLoaded(false);
    let alive = true;
    (async () => {
      try {
        const tokenQS = inviteTokenRef.current ? `?token=${encodeURIComponent(inviteTokenRef.current)}` : '';
        const res = await fetch(`${API_URL}/api/interview/sessions/${sessionId}${tokenQS}`);
        if (res.status === 403) { if (alive) setStartError('This interview link is invalid or has expired.'); return; }
        if (!res.ok) return;
        const s = await res.json();
        if (!alive) return;
        setInterviewSettings(s?.settings || {});
        if (s?.company) setBranding({ name: s.company.name, primaryColor: s.company.primaryColor, logoUrl: s.company.logoUrl, whiteLabel: !!s?.settings?.whiteLabel });
        // Arm the scheduled-slot lobby if a future slot exists.
        const at = s?.scheduledAt ? new Date(s.scheduledAt).getTime() : NaN;
        if (Number.isFinite(at)) setScheduledAtMs(at);
        if (s?.jobRole?.questions) {
          const activeQuestions = s.jobRole.questions
            .filter((q: any) => q.isActive !== false)
            .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
          if (activeQuestions.length > 0) {
            setQuestions(activeQuestions.map((q: any) => ({
              text: q.text,
              tag: q.topicCategories?.[0] || 'Technical',
              hint: q.difficulty ? `${q.difficulty} difficulty. Take your time to answer.` : 'Think structured and explain with examples.',
            })));
          }
        }
      } catch (err) {
        console.error('Failed to load session data:', err);
      } finally {
        if (alive) {
          setScheduleChecked(true);
          setInterviewSettingsLoaded(true);
        }
      }
    })();
    return () => { alive = false; };
  }, [sessionId]);

  useEffect(() => {
    questionsRef.current = questions;
  }, [questions]);

  function handleVoiceTranscript(message: VoiceTranscript) {
    acceptExternalTranscript(message.role, message.text, message.isFinal);
    if (message.role !== 'interviewer' || !message.isFinal) return;

    setMessages((current) => [...current, { speaker: 'ai', text: message.text }]);
    const normalized = message.text.replace(/\s+/g, ' ').trim().toLowerCase();
    const matchedIndex = questionsRef.current.findIndex(
      (item) => item.text.replace(/\s+/g, ' ').trim().toLowerCase() === normalized,
    );
    if (matchedIndex >= 0 && !seenVoiceQuestionsRef.current.has(matchedIndex)) {
      seenVoiceQuestionsRef.current.add(matchedIndex);
      setQuestionIndex(matchedIndex);
    }
    if (normalized.includes(CLOSING_LINE.toLowerCase())) void endCallRef.current();
  }

  function handleVoiceActivity(activity: VoiceActivity) {
    if (assistantThinkTimerRef.current) clearTimeout(assistantThinkTimerRef.current);
    setAssistantActivity(activity);
  }

  const voice = useVoiceInterview({
    provider: voiceProvider,
    sessionId,
    getInviteToken: () => inviteTokenRef.current,
    onTranscript: handleVoiceTranscript,
    onActivity: handleVoiceActivity,
    onEnded: () => void endCallRef.current(),
    onError: (detail, error) => {
      console.error(`[${voiceProvider}] voice error`, error || detail);
      setStartError(`Voice interview error: ${detail}`);
      setAssistantActivity('idle');
    },
  });

  const voiceDeadlineMs = useMemo(() => {
    const explicit = voice.deadlineAt ? Date.parse(voice.deadlineAt) : NaN;
    if (Number.isFinite(explicit)) return explicit;
    const started = voice.startedAt ? Date.parse(voice.startedAt) : NaN;
    return Number.isFinite(started) ? started + voice.hardLimitSeconds * 1000 : null;
  }, [voice.deadlineAt, voice.hardLimitSeconds, voice.startedAt]);

  // This countdown is candidate feedback and a last-resort client fallback. The
  // engine and voice worker own the authoritative 30-minute deadline, so a page
  // refresh or a suspended browser timer cannot extend the interview.
  useEffect(() => {
    if (voiceProvider !== 'livekit' || !voiceDeadlineMs || ended) return;
    const tick = () => {
      const now = Date.now();
      setDeadlineNowMs(now);
      if (now >= voiceDeadlineMs) void endCallRef.current();
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [ended, voiceDeadlineMs, voiceProvider]);

  // Lobby heartbeat: drives the countdown and auto-unlocks the room the moment
  // the entry window opens. Only runs while genuinely waiting, so it stops once
  // the interview is reachable. Demo sessions never gate.
  const unlockAtMs = scheduledAtMs != null ? scheduledAtMs - EARLY_ENTRY_MS : null;
  const lobbyLocked = sessionId !== 'demo-session' && !startError && unlockAtMs != null && nowMs < unlockAtMs;
  // Live STT captions (below) only show in demo/debug — a real candidate's room
  // should stay clean, but this is exactly what lets us SEE whether the browser
  // is actually transcribing anything, instead of finding out only after the
  // interview ends with an empty "Transcript unavailable" report.
  const isDemoOrDebug = sessionId === 'demo-session' || showDebug;
  useEffect(() => {
    if (!lobbyLocked) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [lobbyLocked]);

  // --- WebSocket + demo session bootstrap (unchanged proctoring contract) ---
  // Reconnects with backoff (1s, doubling to a 10s cap) on an unexpected drop —
  // e.g. a flaky network mid-interview — re-sending the same 'register' message
  // on reopen so the server re-binds this candidate's socket. A deliberate close
  // (unmount cleanup below, or endCall()) sets isDeliberateCloseRef first so
  // onclose knows not to reconnect.
  useEffect(() => {
    let alive = true;
    isDeliberateCloseRef.current = false;
    async function bootstrapDemoSession() {
      if (sessionId !== 'demo-session') return;
      try {
        const res = await fetch(`${API_URL}/api/interview/demo-session`);
        if (!res.ok) return;
        const json = await res.json();
        if (alive && json?.sessionId) setSessionId(json.sessionId);
      } catch (error) {
        console.error('demo-session bootstrap failed', error);
      }
    }

    function connectWebSocket() {
      if (!alive) return;
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.onopen = () => {
        wsReconnectAttemptRef.current = 0;
        setWsReconnecting(false);
        ws.send(JSON.stringify({ type: 'register', role: 'candidate', sessionId, token: inviteTokenRef.current || undefined }));
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'error' && msg.code === 'INVALID_TOKEN') {
          setStartError('This interview link is invalid or has expired.');
          return;
        }
      };
      ws.onclose = () => {
        if (!alive || isDeliberateCloseRef.current) return;
        setWsReconnecting(true);
        const attempt = wsReconnectAttemptRef.current;
        const delay = Math.min(1000 * 2 ** attempt, 10000);
        wsReconnectAttemptRef.current = attempt + 1;
        wsReconnectTimeoutRef.current = setTimeout(() => {
          if (alive && !isDeliberateCloseRef.current) connectWebSocket();
        }, delay);
      };
      setSocket(ws);
    }

    bootstrapDemoSession();
    connectWebSocket();
    return () => {
      alive = false;
      isDeliberateCloseRef.current = true;
      if (wsReconnectTimeoutRef.current) {
        clearTimeout(wsReconnectTimeoutRef.current);
        wsReconnectTimeoutRef.current = null;
      }
      if (assistantThinkTimerRef.current) clearTimeout(assistantThinkTimerRef.current);
      wsRef.current?.close();
    };
  }, [sessionId]);

  // Recruiter-configurable per-job toggle (InterviewSettings.proctoring, synced via
  // ai_sync.py into InterviewSession.settings and returned as-is by GET
  // /sessions/:id). Missing/undefined (older sessions, demo) stays permissive —
  // only an explicit `false` turns proctoring off.
  const proctoringSettingEnabled = interviewSettings?.proctoring !== false;

  // --- Proctoring engine (all features) ---
  // Gate proctoring on consent AND an explicit permission request AND the
  // recruiter's proctoring toggle: no camera/mic/screen capture or model loading
  // happens until the candidate has agreed in the consent gate AND clicked "Grant
  // required access" in the permission gate below AND the job has proctoring on.
  const { videoRef, events, state, requestRequiredPermissions, startProctoringSession, endProctoringSession, getScreenAudioStream, getScreenVideoStream, screenShareError } = useProctoring(sessionId, socket, calibration, consentGiven && permissionsRequested && proctoringSettingEnabled);

  // When proctoring is off there's no camera feed to calibrate gaze against, so
  // skip the GazeCalibration screen entirely and fall straight into the interview
  // with the neutral default (the timer/transcript-capture effects below are all
  // gated on `calibration` being set, proctoring or not).
  useEffect(() => {
    if (!proctoringSettingEnabled && permissionsAcknowledged && !calibration) {
      setCalibration(DEFAULT_CALIBRATION);
    }
  }, [proctoringSettingEnabled, permissionsAcknowledged, calibration]);

  // --- Lock scroll to a fullscreen room while mounted ---
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // --- Proctoring debug overlay: toggle with Ctrl+Shift+D (or backtick `) ---
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') || e.key === '`') {
        e.preventDefault();
        setShowDebug((v) => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Which stage this session is (stamped by the backend into InterviewSession.settings
  // — see ai_sync.py). Undefined for demo/legacy sessions, which behave exactly as before.
  const sessionStage = interviewSettings?.stage as 'screening' | 'functional' | undefined;
  const SCREENING_DURATION_SECONDS = 300;

  // --- Elapsed timer (starts once calibration is done) ---
  useEffect(() => {
    if (!calibration) return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [calibration]);

  // --- Recruiter screening: hard 5-minute cutoff, auto-ends the call exactly once ---
  useEffect(() => {
    if (sessionStage !== 'screening') return;
    if (ended || screeningEndTriggeredRef.current) return;
    if (elapsed >= SCREENING_DURATION_SECONDS) {
      screeningEndTriggeredRef.current = true;
      endCall();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionStage, elapsed, ended]);

  // --- Recording lifecycle ---
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const [recordingStatus, setRecordingStatus] = useState('Idle');
  // Full-interview recording mix: candidate mic + Lina's tab audio, combined via Web
  // Audio API so the uploaded file has both voices alongside the shared-screen video.
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioMixCtxRef = useRef<AudioContext | null>(null);

  async function startRecording() {
    try {
      const original = videoRef.current?.srcObject as MediaStream | null;
      const screenVideo = getScreenVideoStream?.() ?? null;
      const screenAudio = getScreenAudioStream?.() ?? null;
      // Permission was granted in the explicit pre-interview gate. Keep this one
      // stream for recording and LiveKit so starting voice does not create a
      // competing microphone capture lifecycle.
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
      micStreamRef.current = micStream;

      let recordStream: MediaStream | null = null;
      if (screenVideo) {
        const ctx = new AudioContext();
        const dest = ctx.createMediaStreamDestination();
        if (micStream) ctx.createMediaStreamSource(micStream).connect(dest);
        if (screenAudio) ctx.createMediaStreamSource(screenAudio).connect(dest);
        audioMixCtxRef.current = ctx;

        recordStream = new MediaStream([...screenVideo.getVideoTracks(), ...dest.stream.getAudioTracks()]);
      } else if (original) {
        // Fallback: screen share unavailable for some reason — keep the old
        // webcam recording behavior and include the already-granted mic.
        recordStream = new MediaStream([
          ...original.getVideoTracks(),
          ...(micStream?.getAudioTracks() || []),
        ]);
      }

      if (!recordStream) {
        setRecordingStatus('Grant camera or screen access first');
        return;
      }

      const mimeType = getBestViolationRecordingMimeType() || 'video/webm';
      const mr = new MediaRecorder(recordStream, { mimeType });
      chunksRef.current = [];
      mr.ondataavailable = (ev: any) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      mr.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const form = new FormData();
        form.append('file', blob, `recording-${Date.now()}.webm`);
        setRecordingStatus('Uploading recording…');
        try {
          const res = await fetch(`${API_URL}/api/interview/sessions/${sessionId}/recording`, { method: 'POST', body: form });
          if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
          setRecordingStatus('Recording uploaded');
        } catch (err) {
          console.error('recording upload failed', err);
          setRecordingStatus('Recording upload failed');
        }
      };
      recorderRef.current = mr;
      mr.start(5000);
      setRecordingStatus('Recording video + audio');
    } catch (err) {
      console.error('startRecording error', err);
    }
  }

  function stopRecordingCapture() {
    recorderRef.current?.stop();
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    audioMixCtxRef.current?.close().catch(() => {});
    audioMixCtxRef.current = null;
  }

  // --- Auto-start the recorded session once calibrated + connected ---
  useEffect(() => {
    if (!calibration || !interviewSettingsLoaded || sessionStartedRef.current) return;
    if (socket?.readyState !== WebSocket.OPEN) return;
    sessionStartedRef.current = true;
    (async () => {
      try {
        setRecordingStatus('Starting session…');
        // Engage the engine's proctoring engine (gaze/face/object/tab/etc) and
        // its integrity scoring — detection is gated until this is called.
        startProctoringSession();
        // Honor the recruiter's interview settings enforced server-side at /start
        // (disabled / late / reattempt / CV required). On a block, surface the
        // message and stop instead of proceeding into a broken room.
        const startTokenQS = inviteTokenRef.current ? `?token=${encodeURIComponent(inviteTokenRef.current)}` : '';
        const startRes = await fetch(`${API_URL}/api/interview/sessions/${sessionId}/start${startTokenQS}`, { method: 'POST' });
        const startJson = await startRes.json().catch(() => null);
        // Hard-block ONLY on a 4xx recruiter-policy gate (disabled / late /
        // no-reattempt / CV-required / invalid invite). On a 5xx or network
        // error, log and PROCEED into the interview instead of trapping the
        // candidate behind "Internal Server Error" — the room still runs on its
        // synced/blueprint questions, and a transient engine/session error must
        // not block a legitimately scheduled candidate.
        if (startRes.status >= 400 && startRes.status < 500) {
          const msg = startJson?.error || 'This interview could not be started.';
          setStartError(msg);
          try { endProctoringSession(); } catch { /* noop */ }
          setRecordingStatus('');
          return;
        }
        if (!startRes.ok) {
          console.error(`Engine /start returned ${startRes.status}; proceeding into the interview anyway.`);
        }
        await startRecording();
        if (voiceInterviewEnabled) {
          const firstQuestion = String(startJson?.initialQuestion || questionsRef.current[0]?.text || '').trim();
          setAssistantActivity('thinking');
          await voice.start({
            firstQuestion,
            microphoneTrack: micStreamRef.current?.getAudioTracks()[0] || null,
          });
        }
        // Transcript capture (markStart + browser STT + auto interviewer-audio
        // capture) is started in the calibration-gated effect below — NOT here —
        // so it never depends on the proctoring WebSocket being OPEN. A flaky WS
        // for a scheduled session used to block this whole effect, so candidate
        // STT never started and the interview captured zero transcript events.
      } catch (err) {
        console.error('startSession failed', err);
        if (voiceInterviewEnabled) {
          setStartError(`Voice interview could not start: ${err instanceof Error ? err.message : 'Unknown voice provider error'}`);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calibration, socket, interviewSettingsLoaded, voiceInterviewEnabled, voice]);

  // Start transcript capture as soon as calibration is done, independent of the
  // proctoring WebSocket. Flag-off candidate speech prefers server-side
  // Deepgram/Whisper with browser STT as a keyless/error fallback. Flag-on calls
  // are transcribed and persisted by LiveKit's Deepgram STT plus the
  // server-side director.
  useEffect(() => {
    if (!calibration || !interviewSettingsLoaded || captureStartedRef.current) return;
    captureStartedRef.current = true;
    transcript.markStart();
    if (voiceInterviewEnabled) return;
    const micStream = videoRef.current?.srcObject as MediaStream | null;
    void transcript.startCandidateCaptureFromStream(micStream).then((result) => {
      if (!result.ok) transcript.startBrowserSTT();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calibration, interviewSettingsLoaded, voiceInterviewEnabled]);

  // End → stop candidate capture, finalize the .txt, complete the session, and
  // evaluate into the report. Fully automatic.
  async function endCall() {
    if (endingRef.current) return;
    endingRef.current = true;
    await voice.stop();
    // Mark this as a deliberate close BEFORE closing the socket so the reconnect
    // handler doesn't try to reopen it once the interview is over.
    isDeliberateCloseRef.current = true;
    if (wsReconnectTimeoutRef.current) {
      clearTimeout(wsReconnectTimeoutRef.current);
      wsReconnectTimeoutRef.current = null;
    }
    wsRef.current?.close();
    setWsReconnecting(false);
    setEnded(true);
    setReportBusy(true);
    try {
      stopRecordingCapture();
      transcript.stopBrowserSTT();
      endProctoringSession();

      setReportStatus('Transcribing interview audio…');
      await transcript.stopCandidateCapture();

      await transcript.flush();

      setReportStatus('Building transcript…');
      const fin = await transcript.finalize();
      if (fin?.status === 'finalized' || fin?.status === 'empty') setTranscriptReady(true);

      await fetch(`${API_URL}/api/interview/sessions/${sessionId}/complete${inviteTokenRef.current ? `?token=${encodeURIComponent(inviteTokenRef.current)}` : ''}`, { method: 'POST' });

      setReportStatus('Generating report from transcript…');
      const eRes = await fetch(`${API_URL}/api/interviews/${sessionId}/report`, { method: 'POST' });
      const eJson = await eRes.json();
      if (eRes.ok && eJson?.evaluation) {
        setReport(eJson.evaluation);
        setReportStatus(`Report generated (engine: ${eJson.engine}).`);

        if (sessionStage === 'screening') {
          setReportStatus('Checking fit for the next round…');
          try {
            const oRes = await fetch(`${API_URL}/api/interviews/${sessionId}/screening-outcome`, { method: 'POST' });
            const oJson = await oRes.json();
            if (oRes.ok) setScreeningOutcome(oJson);
            // On failure we deliberately leave screeningOutcome null — the room falls
            // back to showing the raw report card instead of trapping the candidate.
          } catch {
            /* best-effort — fall back to the raw report card */
          }
        }
      } else {
        setReportStatus(eJson?.error || 'Report generation failed.');
      }
    } catch (err) {
      console.error('endCall failed', err);
      setReportStatus(err instanceof Error ? err.message : 'Could not generate the report.');
    } finally {
      setReportBusy(false);
    }
  }

  endCallRef.current = endCall;

  function toggleMic() {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    const next = !micOn;
    stream?.getAudioTracks().forEach((t) => (t.enabled = next));
    if (voiceInterviewEnabled) voice.setMuted(!next);
    setMicOn(next);
  }

  function toggleCam() {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    const next = !camOn;
    stream?.getVideoTracks().forEach((t) => (t.enabled = next));
    setCamOn(next);
  }

  // --- Voice-activity detection for the self-view highlight ---
  // Taps the SAME mic track already attached to videoRef by useProctoring (no
  // second getUserMedia prompt). Polls briefly for the stream to appear (its
  // exact attach timing lives inside useProctoring, not observable from here),
  // then runs a simple RMS-volume-over-threshold check on an animation-frame
  // loop, with a short hangover so the highlight doesn't flicker between words.
  useEffect(() => {
    if (!consentGiven || !permissionsRequested) return;
    let cancelled = false;
    let audioCtx: AudioContext | null = null;
    let raf = 0;
    let attachRetry: ReturnType<typeof setTimeout> | null = null;
    let hangoverTimer: ReturnType<typeof setTimeout> | null = null;

    function attach() {
      if (cancelled) return;
      const stream = videoRef.current?.srcObject as MediaStream | null;
      const track = stream?.getAudioTracks()?.[0];
      if (!track) { attachRetry = setTimeout(attach, 300); return; }

      try {
        audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const source = audioCtx.createMediaStreamSource(new MediaStream([track]));
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const SPEAKING_THRESHOLD = 0.04; // RMS on a 0-1 scale — tuned for normal mic gain
        const HANGOVER_MS = 400; // keeps the highlight steady between syllables

        const tick = () => {
          if (cancelled) return;
          analyser.getByteTimeDomainData(data);
          let sumSquares = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sumSquares += v * v;
          }
          const rms = Math.sqrt(sumSquares / data.length);
          if (rms > SPEAKING_THRESHOLD) {
            setVoiceActive(true);
            if (hangoverTimer) clearTimeout(hangoverTimer);
            hangoverTimer = setTimeout(() => setVoiceActive(false), HANGOVER_MS);
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        // AudioContext unsupported/blocked — the highlight just never lights up,
        // nothing else in the room depends on this.
      }
    }
    attach();

    return () => {
      cancelled = true;
      if (attachRetry) clearTimeout(attachRetry);
      if (hangoverTimer) clearTimeout(hangoverTimer);
      if (raf) cancelAnimationFrame(raf);
      audioCtx?.close().catch(() => {});
      setVoiceActive(false);
    };
  }, [consentGiven, permissionsRequested]);

  // --- Informed-consent gate handlers ---
  const consentComplete = isAdult && agreeData && agreeBiometric && agreePrivacy && agreeCookies;

  // "Select all" master toggle — tick/untick every consent at once.
  function setAllConsents(value: boolean) {
    setIsAdult(value);
    setAgreeData(value);
    setAgreeBiometric(value);
    setAgreePrivacy(value);
    setAgreeCookies(value);
  }

  // The consent options shown in the gate. Fewer checkboxes for the candidate,
  // but each still maps to the individual per-purpose flags persisted in the DB
  // (age / privacy / cookies / recording+AI / biometric) so the audit trail stays
  // granular. Biometric is kept as its OWN checkbox — GDPR Art. 9 / BIPA require a
  // separate, specific consent for it, so it must not be bundled with the others.
  const consentItems = [
    {
      key: 'eligibility',
      checked: isAdult && agreePrivacy && agreeCookies,
      onChange: (v: boolean) => {
        setIsAdult(v);
        setAgreePrivacy(v);
        setAgreeCookies(v);
      },
      title: (
        <>
          I am 18 or older and agree to the{' '}
          <a
            href={PRIVACY_URL}
            target="_blank"
            rel="noreferrer"
            className="consent-link"
            onClick={(e) => e.stopPropagation()}
          >
            Privacy Policy
          </a>
        </>
      ),
      detail: 'Under-18 candidates need verifiable parental/guardian consent. Includes the strictly-necessary cookies and local storage used to run this interview and remember your consent.',
    },
    {
      key: 'data',
      checked: agreeData,
      onChange: (v: boolean) => setAgreeData(v),
      title: 'I consent to this interview being recorded and evaluated by AI',
      detail: 'Your answers (transcript and recording) are processed and may be handled by service providers outside India.',
    },
    {
      key: 'biometric',
      checked: agreeBiometric,
      onChange: (v: boolean) => setAgreeBiometric(v),
      title: 'I explicitly consent to the processing of my biometric data',
      detail: 'Facial-geometry / landmark, gaze, and voice data are captured for interview-integrity monitoring (proctoring). This is a separate, specific consent.',
    },
  ];

  function buildConsentRecord(action: 'granted' | 'declined') {
    return {
      sessionId,
      action,
      consentVersion: CONSENT_VERSION,
      // Per-purpose consent so each can be audited (and later withdrawn) on its own.
      scopes: {
        age18Plus: isAdult,
        dataProcessing: agreeData, // recording + AI evaluation + cross-border processing
        biometric: agreeBiometric, // face-geometry / gaze / voice
        privacyPolicy: agreePrivacy,
        cookies: agreeCookies, // strictly-necessary cookies + local storage
      },
      inviteToken: inviteTokenRef.current || undefined,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      locale: typeof navigator !== 'undefined' ? navigator.language : undefined,
      grantedAt: new Date().toISOString(),
    };
  }

  // Persist the decision to the server security log. Best effort: the localStorage
  // record is the immediate proof and the gate still blocks capture, so a network
  // blip must never trap a consenting candidate behind a failed request.
  function persistConsent(record: ReturnType<typeof buildConsentRecord>) {
    try {
      fetch(`${API_URL}/api/interview/consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
        keepalive: true,
      }).catch(() => { /* logged server-side is best-effort */ });
    } catch {
      /* ignore */
    }
  }

  // Record informed consent before any capture begins: client-side proof
  // (version + timestamp + scope) plus the server security log.
  function grantConsent() {
    if (!consentComplete) return;
    const record = buildConsentRecord('granted');
    try {
      localStorage.setItem(`ih_consent_${sessionId}`, JSON.stringify(record));
    } catch {
      /* non-fatal: gate still blocks capture below */
    }
    persistConsent(record);
    setConsentGiven(true);
  }

  // Log the decline too (audit trail: the candidate was offered and refused) —
  // then show the "nothing recorded" screen; capture never starts.
  function declineConsent() {
    persistConsent(buildConsentRecord('declined'));
    setConsentDeclined(true);
  }

  // --- Permission gate state ---
  // Camera and screen-share are proctoring-specific (face/gaze/object detection and
  // screen-share-based violation monitoring, respectively — see useProctoring.ts).
  // When the recruiter has turned proctoring off for this job, neither is required
  // to enter the interview; only the microphone (needed for answer STT) is.
  const cameraReady = !proctoringSettingEnabled || (state.cameraActive && !state.permissionDenied);
  const micReady = micGranted;
  const screenShareReady = !proctoringSettingEnabled || !state.screenShareSupported || state.screenShareReadyBeforeInterview;
  const allPermissionsReady = cameraReady && micReady && screenShareReady;

  // Prompt for camera + microphone + screen share only after the candidate asks
  // for it via the "Grant required access" button — never silently on load. Each
  // click re-requests ONLY the permissions still missing, so a candidate who
  // denied one can click again to be re-prompted. (This re-prompts when the
  // earlier denial was a dismiss; a hard browser "Block" can only be undone from
  // the browser's site settings — the gate message guides that case.)
  async function grantAllPermissions() {
    // Screen share + fullscreen (only if not already shared). getDisplayMedia must
    // run inside the click gesture, so kick it off first and synchronously.
    const screenPromise = screenShareReady
      ? Promise.resolve()
      : Promise.resolve(requestRequiredPermissions()).catch(() => {});
    // Microphone (only if not already granted). Release the track immediately — the
    // transcript layer re-opens the mic when the interview starts; we only need the
    // granted permission here.
    let micPromise: Promise<unknown> = Promise.resolve();
    if (!micReady) {
      setMicDenied(false);
      micPromise = navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((s) => { s.getTracks().forEach((t) => t.stop()); setMicGranted(true); })
        .catch(() => { setMicGranted(false); setMicDenied(true); });
    }
    // Camera (only if not already active). It's acquired by the proctoring effect
    // when proctoringEnabled flips true. First request: flip false->true. Retry
    // (already requested but still not active): toggle off->on so the effect
    // re-runs and the browser is asked again.
    if (!cameraReady) {
      if (permissionsRequested) {
        setPermissionsRequested(false);
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      setPermissionsRequested(true);
    }
    await Promise.allSettled([screenPromise, micPromise]);
  }

  // --- Live integrity computation ---
  const activeViolation = useMemo(() => {
    const high = events.find((e) => e.severity === 'HIGH' || e.severity === 'CRITICAL');
    return high || events[0] || null;
  }, [events]);

  const integrity = activeViolation
    ? { label: prettyEvent(activeViolation.eventType), tone: 'alert' as const }
    : state.gazeAwayDetected
    ? { label: `Looking ${state.gazeDirection ?? 'away'}`, tone: 'warn' as const }
    : { label: 'Monitored', tone: 'ok' as const };

  const liveKitRemainingSeconds = voiceDeadlineMs == null
    ? voice.hardLimitSeconds
    : Math.max(0, Math.ceil((voiceDeadlineMs - deadlineNowMs) / 1000));
  const clockSeconds = voiceProvider === 'livekit'
    ? liveKitRemainingSeconds
    : sessionStage === 'screening'
      ? Math.max(0, SCREENING_DURATION_SECONDS - elapsed)
      : elapsed;
  const mm = String(Math.floor(clockSeconds / 60)).padStart(2, '0');
  const ss = String(clockSeconds % 60).padStart(2, '0');
  const clock = `${mm}:${ss}`;
  // The LiveKit worker joins the room as a separate async dispatch, well
  // after room.connect() itself resolves — voice.connected being true (or
  // assistantActivity swinging to 'idle' once the mic publishes) does NOT
  // mean the interviewer is actually there yet. Hold the visual in
  // 'connecting' (a proper waiting room, not a flash of whatever room-level
  // state happened to be true) until the worker's own readiness signal
  // (voice.agentConnected) arrives.
  const awaitingAgent = voiceInterviewEnabled && !ended && !voice.agentConnected;
  const assistantMode: AssistantMode = reportBusy
    ? 'thinking'
    : ended
      ? 'complete'
      : awaitingAgent || wsReconnecting || socket?.readyState !== 1
        ? 'connecting'
        : assistantActivity === 'speaking'
          ? 'speaking'
          : assistantActivity === 'thinking'
            ? 'thinking'
            : calibration
              ? 'listening'
              : 'idle';
  const assistantModeLabel = assistantMode === 'connecting'
    ? 'Connecting'
    : assistantMode === 'complete'
      ? 'Complete'
      : assistantMode.charAt(0).toUpperCase() + assistantMode.slice(1);
  const qIdx = Math.min(questionIndex, Math.max(0, questions.length - 1));
  const question = questions[qIdx] || { text: 'No questions loaded.', tag: 'Interview', hint: 'Please wait.' };

  const isMobileDevice = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const mobileBlocked = !!interviewSettings && interviewSettings.allowMobile === false && isMobileDevice;
  const wl = !!(interviewSettings && interviewSettings.whiteLabel && branding);

  // Whole-screen proctoring relies on MediaTrackSettings.displaySurface, which
  // Firefox and Safari don't expose (and their "share window" is visually a full
  // screen), so those browsers can't be reliably proctored. Require a Chromium
  // browser (Chrome, Edge, Brave, Opera, …), which reports displaySurface.
  const isUnsupportedBrowser =
    typeof navigator !== 'undefined' &&
    (/firefox\/|fxios\//i.test(navigator.userAgent) ||
      (/safari\//i.test(navigator.userAgent) &&
        !/chrome\/|chromium\/|crios\/|edg[a-z]*\//i.test(navigator.userAgent)));

  if (mobileBlocked) {
    return (
      <>
        <style>{roomStyles}</style>
        <div className="gate">
          <div className="gate-card">
            <p className="gate-eyebrow">Desktop required</p>
            <h1 className="gate-title">Please switch to a desktop</h1>
            <p className="gate-sub">This interview must be taken on a desktop or laptop. Open this link on a computer to continue.</p>
          </div>
        </div>
      </>
    );
  }

  if (isUnsupportedBrowser) {
    return (
      <>
        <style>{roomStyles}</style>
        <div className="gate">
          <div className="gate-card" style={{ textAlign: 'center' }}>
            <p className="gate-eyebrow">Unsupported browser</p>
            <h1 className="gate-title">Open in Chrome or Edge</h1>
          </div>
        </div>
      </>
    );
  }

  // Hold on a light loading gate until we know whether this session has a future
  // scheduled slot — avoids flashing the permission gate before the lobby appears.
  if (!startError && sessionId !== 'demo-session' && !scheduleChecked) {
    return (
      <>
        <style>{roomStyles}</style>
        <div className="gate">
          <div className="gate-card">
            <p className="gate-eyebrow">Interview lobby</p>
            <h1 className="gate-title">Preparing your interview…</h1>
            <p className="gate-sub">One moment while we load your session.</p>
          </div>
        </div>
      </>
    );
  }

  // Scheduled-slot barrier: locked until (scheduledAt − EARLY_ENTRY_MS).
  if (lobbyLocked && scheduledAtMs != null && unlockAtMs != null) {
    return (
      <>
        <style>{roomStyles}</style>
        <WaitingRoom scheduledAtMs={scheduledAtMs} unlockAtMs={unlockAtMs} nowMs={nowMs} brand={branding} />
      </>
    );
  }

  return (
    <>
      <style>{roomStyles}</style>

      {/* Interview blocked by the recruiter's settings (disabled / late / reattempt / CV) */}
      {startError && (
        <div className="gate">
          <div className="gate-card">
            <p className="gate-eyebrow">Interview unavailable</p>
            <h1 className="gate-title">Can&apos;t start this interview</h1>
            <p className="gate-sub">{startError}</p>
          </div>
        </div>
      )}

      {/* Neutral cover while we restore any prior consent from localStorage.
          Covers the room so neither the consent gate nor the interview flashes
          before we know whether this candidate already agreed. */}
      {!startError && !consentChecked && (
        <div className="gate">
          <div className="gate-card" style={{ textAlign: 'center' }}>
            <div className="gate-spinner" />
            <p className="gate-sub">Preparing your interview…</p>
          </div>
        </div>
      )}

      {/* Informed-consent gate — must precede ANY camera / mic / screen capture */}
      {!startError && consentChecked && !consentGiven && !consentDeclined && (
        <div className="gate">
          <div className="gate-card consent-card">
            <div className="consent-badge"><ShieldCheck size={24} /></div>
            <p className="gate-eyebrow" style={{ marginTop: 16 }}>Before you begin</p>
            <h1 className="gate-title">Consent to a recorded, AI-evaluated interview</h1>
            <p className="gate-sub">
              This interview uses your <strong>camera</strong> (face &amp; gaze), your{' '}
              <strong>microphone</strong> (recorded &amp; transcribed), and records short clips if
              monitoring flags an issue. Your answers are <strong>evaluated by AI</strong> and may be
              processed by providers <strong>outside India</strong>. You can{' '}
              <a href="/data-rights" style={{ textDecoration: 'underline' }}>manage your data</a>{' '}
              (access, correct, or delete it) at any time.
            </p>
            <div className="consent-list">
              {consentItems.map((item) => (
                <label key={item.key} className={`consent-item${item.checked ? ' is-on' : ''}`}>
                  <input
                    type="checkbox"
                    className="consent-native"
                    checked={item.checked}
                    onChange={(e) => item.onChange(e.target.checked)}
                  />
                  <span className="consent-box"><Check size={14} strokeWidth={3} /></span>
                  <span className="consent-text">
                    <span className="consent-title">{item.title}</span>
                    <span className="consent-detail">{item.detail}</span>
                  </span>
                </label>
              ))}
              {/* Select all — tick every consent at once (unticking clears them). */}
              <label className={`consent-item consent-all${consentComplete ? ' is-on' : ''}`}>
                <input
                  type="checkbox"
                  className="consent-native"
                  checked={consentComplete}
                  onChange={(e) => setAllConsents(e.target.checked)}
                />
                <span className="consent-box"><Check size={14} strokeWidth={3} /></span>
                <span className="consent-text">
                  <span className="consent-title">Select all</span>
                  <span className="consent-detail">Agree to everything above at once.</span>
                </span>
              </label>
            </div>
            <div className="consent-actions">
              <button onClick={grantConsent} disabled={!consentComplete} className="consent-agree">
                <ShieldCheck size={18} /> I agree — continue
              </button>
              <button onClick={declineConsent} className="consent-decline">
                I do not consent
              </button>
            </div>
            <p className="consent-fineprint">
              Your choice is recorded securely (consent v{CONSENT_VERSION}). Nothing is captured until you agree.
            </p>
          </div>
        </div>
      )}

      {/* Consent declined — capture never starts */}
      {!startError && consentDeclined && (
        <div className="gate">
          <div className="gate-card consent-card" style={{ textAlign: 'center' }}>
            <p className="gate-eyebrow">Interview not started</p>
            <h1 className="gate-title">You declined consent</h1>
            <p className="gate-sub">
              We can&apos;t run a camera-based interview without your consent, so nothing has been
              recorded. If this was a mistake, review the consent options again, or contact the
              recruiter about an alternative.
            </p>
            <div className="consent-actions">
              <button onClick={() => setConsentDeclined(false)} className="consent-agree">
                Review consent again
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pre-interview permission gate — prompts fire only on the button click */}
      {consentGiven && !calibration && !permissionsAcknowledged && (
        <div className="gate">
          <div className="gate-card">
            <p className="gate-eyebrow">Pre-interview access</p>
            <h1 className="gate-title">
              {proctoringSettingEnabled ? 'Grant camera, microphone & screen access' : 'Grant microphone access'}
            </h1>
            <p className="gate-sub">
              {proctoringSettingEnabled
                ? <>Click <strong>Grant required access</strong> — your browser will then ask for each
                  permission one by one. All three must be granted before you can start the interview.</>
                : <>Click <strong>Grant required access</strong> — your browser will then ask for
                  microphone access, needed to transcribe your answers. It must be granted before you
                  can start the interview.</>}
            </p>
            <div className="gate-checks">
              {[
                ...(proctoringSettingEnabled
                  ? [{
                      label: 'Camera',
                      ok: cameraReady,
                      detail: cameraReady
                        ? 'Ready'
                        : state.permissionDenied
                        ? 'Permission denied — allow it in your browser, then retry'
                        : permissionsRequested
                        ? 'Waiting for browser permission…'
                        : 'Not requested yet',
                      Icon: Video,
                    }]
                  : []),
                {
                  label: 'Microphone',
                  ok: micReady,
                  detail: micReady
                    ? 'Ready'
                    : micDenied
                    ? 'Permission denied — allow it in your browser, then retry'
                    : permissionsRequested
                    ? 'Waiting for browser permission…'
                    : 'Not requested yet',
                  Icon: Mic,
                },
                ...(proctoringSettingEnabled
                  ? [{
                      label: 'Screen share',
                      ok: screenShareReady,
                      detail: !state.screenShareSupported
                        ? 'Unavailable in this browser'
                        : screenShareReady
                        ? 'Ready'
                        : permissionsRequested
                        ? 'Choose a screen or tab to share…'
                        : 'Not requested yet',
                      Icon: MonitorUp,
                    }]
                  : []),
              ].map(({ label, ok, detail, Icon }) => (
                <div key={label} className="gate-check">
                  <div className="gate-check-l">
                    <Icon size={18} className={ok ? 'ok-ico' : 'bad-ico'} />
                    <div>
                      <p className="gate-check-label">{label}</p>
                      <p className={`gate-check-detail${ok ? '' : ' is-bad'}`}>{detail}</p>
                    </div>
                  </div>
                  <span className={`gate-dot ${ok ? 'is-ok' : 'is-bad'}`} />
                </div>
              ))}
            </div>
            {screenShareError && !screenShareReady && (
              <p className="gate-error" role="alert" style={{ color: '#dc2626', fontSize: 13, margin: '10px 0 0' }}>
                {screenShareError}
              </p>
            )}
            {allPermissionsReady ? (
              <button onClick={() => setPermissionsAcknowledged(true)} className="gate-btn">
                <ShieldCheck size={18} /> All set — start the interview
              </button>
            ) : (
              <button onClick={grantAllPermissions} className="gate-btn">
                <ShieldCheck size={18} /> Grant required access
              </button>
            )}
            {(state.permissionDenied || micDenied) && (
              <p className="gate-error">
                {state.permissionDenied && micDenied
                  ? 'Camera and microphone access were denied.'
                  : state.permissionDenied
                  ? 'Camera access was denied.'
                  : 'Microphone access was denied.'}{' '}
                Click <strong>Grant required access</strong> to try again. If no prompt appears, click
                the 🔒 icon in your browser&apos;s address bar, set{' '}
                {state.permissionDenied && micDenied ? 'Camera/Microphone' : state.permissionDenied ? 'Camera' : 'Microphone'} to{' '}
                <em>Allow</em>, then click Grant required access again.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Gaze calibration — only after the candidate clicks to proceed, and only
          when proctoring (camera/gaze tracking) is actually on for this job. */}
      {consentGiven && !calibration && permissionsAcknowledged && proctoringSettingEnabled && (
        <GazeCalibration
          videoRef={videoRef}
          onComplete={setCalibration}
          onSkip={() => setCalibration(DEFAULT_CALIBRATION)}
        />
      )}

      {/* ===== Interview room ===== */}
      <div className="room">
        <header className="topbar">
          <div className="brand">
            <div className="logo">{wl && branding?.logoUrl ? <img src={branding.logoUrl} alt="" style={{ height: 24, borderRadius: 6 }} /> : '✦'}</div>
            <div className="brand-name">
              {wl ? branding?.name : <>Intervie<span>Hire</span></>}
            </div>
            <div className="room-label">AI Interview Room</div>
          </div>
          <div className="job-pill">
            <i className="live-dot" />
            <strong>{sessionStage === 'screening' ? 'Recruiter Screening' : 'Associate Consultant Screening'}</strong>
            <span>{sessionStage === 'screening' ? '5-min check-in' : 'Round 1'}</span>
          </div>
          <div className="connection">
            <span className={`integrity ${integrity.tone}`}>
              <ShieldCheck size={14} />
              {integrity.label}
            </span>
            {/* Live flagcheck: tier-1 AI-tone heuristics over the candidate's
                finalized speech. Only surfaces MEDIUM/HIGH; the server re-runs
                and blends an LLM pass on the saved transcript. */}
            {transcript.aiToneAssessment && transcript.aiToneAssessment.band !== 'LOW' && (
              <span
                title={transcript.aiToneAssessment.reasons.slice(0, 4).join(' · ')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  borderRadius: 9999,
                  padding: '2px 8px',
                  fontSize: 12,
                  fontWeight: 600,
                  background: transcript.aiToneAssessment.band === 'HIGH' ? '#ffe4e6' : '#fef3c7',
                  color: transcript.aiToneAssessment.band === 'HIGH' ? '#be123c' : '#b45309',
                }}
              >
                ⚠ AI-tone {transcript.aiToneAssessment.band} · {transcript.aiToneAssessment.score}
              </span>
            )}
            <span className="bars">
              <i />
              <i />
              <i />
              <i />
            </span>
            <span className="connection-text">
              {wsReconnecting ? 'Reconnecting…' : socket?.readyState === WebSocket.OPEN ? 'Excellent connection' : 'Connecting…'}
            </span>
            <span className="timer">{clock}</span>
          </div>
        </header>

        {calibration && !ended && (
          <div
            style={{
              position: 'fixed', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 8000,
              display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 999,
              background: 'rgba(15,23,42,0.65)', color: '#e2e8f0', fontSize: 11, fontWeight: 600,
              letterSpacing: 0.3, border: '1px solid rgba(255,255,255,0.12)', pointerEvents: 'none',
            }}
          >
            ● This interview is recorded (audio &amp; video) for evaluation purposes.
          </div>
        )}

        <main className={`content${voiceInterviewEnabled ? ' content--conversational' : ''}`}>
          <section className="avatar-panel">
            <AIVisualAssistant
              mode={assistantMode}
              voiceActive={voiceActive && micOn}
              useAura={voiceInterviewEnabled}
              audioTrack={voice.agentAudioTrack}
            />
            <div className="avatar-overlay" />
            <div className="identity">
              <div className="identity-icon">✦</div>
              <div>
                <strong>Lina</strong>
                <span>AI Interviewer</span>
              </div>
            </div>
            <div className={`status-pill assistant-status assistant-status--${assistantMode}`}>
              <i className="assistant-status-dot" /> {assistantModeLabel}
            </div>
            {/* Candidate camera as a Google-Meet-style PiP in the corner of Lina's
                panel, so the right column is free to show the full question. */}
            <section className={`candidate-panel${voiceActive && micOn ? ' speaking' : ''}`}>
              <video
                ref={videoRef}
                muted
                playsInline
                autoPlay
                className="candidate-video"
                style={{ opacity: calibration && camOn ? 1 : 0 }}
              />
              {!camOn && <div className="cam-off">Camera off</div>}
              <div className="you-pill">
                <i /> You
              </div>
              <div className="candidate-footer">
                <div className="mic">{micOn ? '🎙' : '🔇'}</div>
              </div>
            </section>

            {/* Demo/debug only: proves whether browser STT is actually hearing
                anything, live — instead of only finding out after the interview
                ends with an empty "Transcript unavailable" report. */}
            {isDemoOrDebug && (
              <div className="stt-debug-bar">
                <span className={`stt-dot stt-${transcript.sttStatus}`} />
                {transcript.sttStatus === 'unsupported'
                  ? 'STT unsupported in this browser — use Chrome or Edge'
                  : transcript.sttStatus === 'unavailable'
                  ? 'Live transcription unavailable here — server ASR or Chrome/Edge required'
                  : transcript.sttStatus === 'error'
                  ? `STT error: ${transcript.sttError}`
                  : transcript.liveCaption
                  ? `"${transcript.liveCaption}"`
                  : 'Listening for your voice…'}
              </div>
            )}
          </section>

          {!voiceInterviewEnabled && (
            <aside className="right-stack">
              <section className="question-card">
                <div className="question-top">
                  <div className="tag">{question.tag}</div>
                </div>
                <h2>{question.text}</h2>
                <div className="question-meta">
                  Question {String(qIdx + 1).padStart(2, '0')}/{String(questions.length).padStart(2, '0')}
                </div>
                <p>{question.hint}</p>
                <div className="question-actions">
                  <button
                    className="circle-btn"
                    type="button"
                    disabled={qIdx === 0}
                    onClick={() => setQuestionIndex((i) => Math.max(0, i - 1))}
                  >
                    ‹
                  </button>
                  <button
                    className="next-btn"
                    type="button"
                    onClick={() => setQuestionIndex((i) => Math.min(questions.length - 1, i + 1))}
                  >
                    NEXT ›
                  </button>
                </div>
              </section>
            </aside>
          )}
        </main>

        <footer className="controlbar">
          <div className="control-time">
            <i className="red-dot" />
            <span>{clock}</span>
            <span className="elapsed-label">{voiceProvider === 'livekit' || sessionStage === 'screening' ? 'Remaining' : 'Elapsed'} · {recordingStatus}</span>
            <button type="button" className="debug-toggle" onClick={() => setShowDebug((v) => !v)} title="Toggle proctoring debug (Ctrl+Shift+D or ` )">
              🐞 Debug
            </button>
          </div>
          <div className="control-actions">
            <button type="button" title="Microphone" onClick={toggleMic} className={micOn ? '' : 'muted'}>
              {micOn ? '🎙' : '🔇'}
            </button>
            <button type="button" title="Camera" onClick={toggleCam} className={camOn ? '' : 'muted'}>
              {camOn ? '▣' : '◻'}
            </button>
            <button className="end" type="button" title="End call" onClick={endCall}>
              ☎
            </button>
          </div>
        </footer>

        {ended && (
          <div
            style={{
              position: 'fixed', inset: 0, zIndex: 10000, display: 'grid', placeItems: 'center',
              padding: 24, background: 'rgba(2,6,14,0.82)', backdropFilter: 'blur(6px)',
            }}
          >
            <div
              style={{
                width: 'min(760px, 94vw)', maxHeight: '90vh', overflow: 'auto', color: '#e6edff',
                background: 'linear-gradient(180deg,#0c1426,#080d1a)', border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 18, padding: '26px 28px', boxShadow: '0 30px 80px rgba(0,0,0,0.55)',
              }}
            >
              <p style={{ margin: 0, fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#7dd3fc' }}>
                Interview complete
              </p>
              <h2 style={{ margin: '6px 0 4px', fontSize: 22, fontWeight: 800 }}>
                {!report
                  ? 'Generating the interview report'
                  : sessionStage === 'screening' && screeningOutcome
                  ? (screeningOutcome.fits ? "You're moving to the next round" : 'Thanks for your time')
                  : 'Interview report'}
              </h2>

              {report && sessionStage === 'screening' && screeningOutcome ? (
                <div style={{ marginTop: 6 }}>
                  {screeningOutcome.fits ? (
                    <>
                      <p style={{ margin: '0 0 18px', fontSize: 13.5, lineHeight: 1.65, color: '#c7d4ee' }}>
                        Nice work — based on your screening conversation, you're a good fit to continue.
                        Click below to start your functional interview.
                      </p>
                      {screeningOutcome.link ? (
                        <a
                          href={screeningOutcome.link}
                          style={{
                            display: 'inline-block', padding: '12px 22px', borderRadius: 10, fontWeight: 700,
                            fontSize: 14, color: '#04121f', background: '#7dd3fc', textDecoration: 'none',
                          }}
                        >
                          Continue to Functional Interview →
                        </a>
                      ) : (
                        <p style={{ fontSize: 13, color: '#9fb2d4' }}>
                          Your recruiter will follow up shortly with your next interview link.
                        </p>
                      )}
                    </>
                  ) : (
                    <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.65, color: '#c7d4ee' }}>
                      Thanks for taking the time to speak with us today. Your responses have been recorded and
                      our team will follow up with you shortly on next steps.
                    </p>
                  )}
                </div>
              ) : !report ? (
                <>
                  <p style={{ margin: '0 0 14px', fontSize: 13.5, lineHeight: 1.6, color: '#9fb2d4' }}>
                    The transcript was captured automatically — your speech via speech-to-text and the
                    interviewer's voice from the interview audio — then transcribed and scored. No paste needed.
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
                    <span
                      style={{
                        display: 'inline-block', width: 16, height: 16, borderRadius: '50%',
                        border: '2px solid rgba(125,211,252,0.35)', borderTopColor: '#7dd3fc',
                        animation: reportBusy ? 'spin 0.8s linear infinite' : 'none', opacity: reportBusy ? 1 : 0,
                      }}
                    />
                    <span style={{ fontSize: 13, color: '#9fb2d4' }}>{reportStatus || 'Working…'}</span>
                    <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
                  </div>
                  {transcriptReady && (
                    <a
                      href={transcript.downloadUrl()}
                      download
                      style={{ display: 'inline-block', marginTop: 14, fontSize: 12.5, color: '#7dd3fc', textDecoration: 'underline' }}
                    >
                      ⬇ Download full interview transcript (.txt)
                    </a>
                  )}
                </>
              ) : (
                <div style={{ marginTop: 6 }}>
                  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
                    <div style={{ flex: '1 1 160px', background: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: '14px 16px' }}>
                      <p style={{ margin: 0, fontSize: 11, textTransform: 'uppercase', color: '#9fb2d4' }}>Overall</p>
                      <p style={{ margin: '4px 0 0', fontSize: 30, fontWeight: 800 }}>
                        {report.overallScore ?? '–'}<span style={{ fontSize: 14, color: '#7e90b2' }}>/100</span>
                      </p>
                    </div>
                    <div style={{ flex: '1 1 160px', background: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: '14px 16px' }}>
                      <p style={{ margin: 0, fontSize: 11, textTransform: 'uppercase', color: '#9fb2d4' }}>Recommendation</p>
                      <p style={{ margin: '4px 0 0', fontSize: 16, fontWeight: 800, textTransform: 'capitalize' }}>
                        {String(report.recommendation ?? '–').replace(/_/g, ' ')}
                      </p>
                    </div>
                    {report.proctoringSummary && (
                      <div style={{ flex: '1 1 160px', background: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: '14px 16px' }}>
                        <p style={{ margin: 0, fontSize: 11, textTransform: 'uppercase', color: '#9fb2d4' }}>Proctoring</p>
                        <p style={{ margin: '4px 0 0', fontSize: 14, fontWeight: 700 }}>
                          {report.proctoringSummary.eventCount} events
                          <span style={{ color: '#f87171' }}> · {report.proctoringSummary.criticalOrHighCount} high</span>
                        </p>
                      </div>
                    )}
                  </div>
                  {report.summary && (
                    <p style={{ fontSize: 13.5, lineHeight: 1.65, color: '#c7d4ee' }}>{report.summary}</p>
                  )}
                  <details style={{ marginTop: 10 }}>
                    <summary style={{ cursor: 'pointer', fontSize: 12.5, color: '#7dd3fc' }}>View full report JSON</summary>
                    <pre style={{ marginTop: 8, maxHeight: 280, overflow: 'auto', fontSize: 11, lineHeight: 1.5, color: '#cbd5e1', background: 'rgba(0,0,0,0.35)', borderRadius: 10, padding: 12 }}>
                      {JSON.stringify(report, null, 2)}
                    </pre>
                  </details>
                  {transcriptReady && (
                    <a
                      href={transcript.downloadUrl()}
                      download
                      style={{ display: 'inline-block', marginTop: 12, fontSize: 12.5, color: '#7dd3fc', textDecoration: 'underline' }}
                    >
                      ⬇ Download full interview transcript (.txt)
                    </a>
                  )}
                  <p style={{ marginTop: 12, fontSize: 12, color: '#9fb2d4' }}>{reportStatus} It also persists to the dashboard's Deep Analysis.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {showDebug && (
          <div className="debug-panel">
            <div className="debug-head">
              <strong>Proctoring debug</strong>
              <button type="button" onClick={() => setShowDebug(false)} title="Close (Ctrl+Shift+D)">
                ✕
              </button>
            </div>

            <div className="debug-section-title">Pipeline</div>
            <div className="debug-grid">
              <DebugRow label="Session" value={sessionId} />
              <DebugRow label="WebSocket" value={wsLabel(socket)} ok={socket?.readyState === WebSocket.OPEN} />
              <DebugRow label="Calibrated" value={calibration ? `yes (q=${calibration.qualityScore})` : 'no'} ok={!!calibration} />
              <DebugRow label="Recording" value={recordingStatus} />
              <DebugRow
                label="Candidate STT"
                value={transcript.sttError ? `${transcript.sttStatus} (${transcript.sttError})` : transcript.sttStatus}
                ok={transcript.sttStatus === 'listening'}
              />
            </div>

            <div className="debug-section-title">Live proctoring state</div>
            <div className="debug-grid">
              {Object.entries(state).map(([k, v]) => (
                <DebugRow key={k} label={k} value={formatVal(v)} ok={toOk(k, v)} />
              ))}
            </div>

            <div className="debug-section-title">Integrity events ({events.length})</div>
            <div className="debug-events">
              {events.length ? (
                events
                  .slice(-30)
                  .reverse()
                  .map((e, i) => (
                    <div key={i} className={`debug-event sev-${(e.severity || 'LOW').toLowerCase()}`}>
                      <span className="debug-event-type">{e.eventType}</span>
                      <span className="debug-event-sev">{e.severity}</span>
                      {e.metadata ? (
                        <pre className="debug-event-meta">{JSON.stringify(e.metadata)}</pre>
                      ) : null}
                    </div>
                  ))
              ) : (
                <p className="debug-empty">No events flagged yet — proctoring is watching.</p>
              )}
            </div>

            <div className="debug-foot">Last AI msg: {messages[messages.length - 1]?.text?.slice(0, 80) ?? '—'}</div>
          </div>
        )}
      </div>
    </>
  );
}

function DebugRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="debug-row">
      <span className="debug-row-k">
        {ok === undefined ? null : <i className={`debug-dot ${ok ? 'is-ok' : 'is-bad'}`} />}
        {label}
      </span>
      <span className="debug-row-v">{value}</span>
    </div>
  );
}

function wsLabel(ws: WebSocket | null) {
  if (!ws) return 'none';
  return ['connecting', 'open', 'closing', 'closed'][ws.readyState] ?? String(ws.readyState);
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// Green dot = healthy/desired; red dot = something flagged or inactive.
function toOk(key: string, v: unknown): boolean | undefined {
  if (typeof v !== 'boolean') return undefined;
  const badWhenTrue = /denied|away|detected|off|exited|stopped|hidden|switch/i.test(key);
  return badWhenTrue ? !v : v;
}

function prettyEvent(eventType: string) {
  return eventType
    .replace(/_DETECTED$/, '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}
