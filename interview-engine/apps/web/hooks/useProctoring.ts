'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import {
  FaceLandmarker,
  FilesetResolver,
  ObjectDetector,
  type FaceLandmarkerResult,
  type ObjectDetectorResult,
} from '@mediapipe/tasks-vision';
import type { ProctoringPayload, Severity } from '@interviehire/shared';
import type { CalibrationResult } from './useGazeCalibration';
import { buildSafeEightDotCalibration, type SafeEightDotCalibration } from './eightDotCalibrationGuardV3';
import {
  FALLBACK_GAZE_THRESHOLD_X,
  FALLBACK_GAZE_THRESHOLD_Y,
  V_MARGIN_UP,
  V_MARGIN_DOWN,
} from './proctoringGazeThresholdsV3';
import {
  classifyVertical,
  combineGazeDirection,
  noseEyePitchDeg,
  DEFAULT_VERTICAL_BAND,
} from './gazeVerticalMath';

type ProctoringEvent = {
  eventType: string;
  severity: Severity;
  timestamp: number;
  metadata?: Record<string, unknown>;
};


type ProctoringViolationType =
  | 'TAB_SWITCH'
  | 'FULLSCREEN_EXIT'
  | 'COPY_SHORTCUT'
  | 'PASTE_SHORTCUT'
  | 'CAMERA_OFF'
  | 'MULTIPLE_FACES'
  | 'NO_FACE'
  | 'MOBILE_PHONE'
  | 'FOREIGN_OBJECT'
  | 'GAZE_AWAY'
  | 'HEAD_MOVEMENT'
  | 'SCREEN_SHARE_STOPPED'
  | 'UNKNOWN';

type ViolationRecordingEvent = {
  type: ProctoringViolationType;
  at: string;
  details?: Record<string, unknown>;
};

export type ViolationRecordingClip = {
  id: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  violationTypes: ProctoringViolationType[];
  events: ViolationRecordingEvent[];
  blob: Blob;
  url: string;
  mimeType: string;
};

type ActiveViolationRecordingMeta = {
  id: string;
  startedAtISO: string;
  startedAtMs: number;
  violationTypes: Set<ProctoringViolationType>;
  events: ViolationRecordingEvent[];
};

type UseViolationScreenRecorderOptions = {
  defaultClipMs?: number;
  minClipMs?: number;
  maxClipMs?: number;
  timesliceMs?: number;
  onClipReady?: (clip: ViolationRecordingClip) => void | Promise<void>;
  onError?: (error: Error) => void;
  onScreenShareStopped?: () => void;
};

type DetectionState = {
  initialized: boolean;
  status: string;
  permissionDenied: boolean;
  cameraActive: boolean;
  faceDetectorActive: boolean;
  objectDetectorActive: boolean;
  faceCount: number;
  phoneDetected: boolean;
  phoneProximity: PhoneProximity;
  phoneOrientation: PhoneOrientation;
  foreignObjectDetected: boolean;
  foreignObjectLabel: string;
  gazeAwayDetected: boolean;
  gazeDirection: string;
  // Compact live vertical-gaze readout for the debug panel (direction, compensated Y offset,
  // up/down blendshape scores). Optional so the many state resets don't need to set it.
  gazeDebug?: string;
  headMovementDetected: boolean;
  headPoseDeviationDegrees: number;
  tabSwitchDetected: boolean;
  tabSwitchReason: string | null;
  lastTabSwitchAt: number | null;
  lastTabSwitchDurationMs: number | null;
  activeTabSwitchDurationMs: number;
  totalTabSwitchDurationMs: number;
  tabSwitchCount: number;
  fullscreenActive: boolean;
  fullscreenExitDetected: boolean;
  fullscreenExitReason: string | null;
  lastFullscreenExitAt: number | null;
  fullscreenSupported: boolean;
  fullscreenReadyBeforeInterview: boolean;
  fullscreenPromptRequired: boolean;
  preInterviewFullscreenRequestedAt: number | null;
  preInterviewFullscreenEnteredAt: number | null;
  microphoneSupported: boolean;
  microphoneReadyBeforeInterview: boolean;
  microphonePromptRequired: boolean;
  preInterviewMicrophoneRequestedAt: number | null;
  preInterviewMicrophoneGrantedAt: number | null;
  screenShareSupported: boolean;
  screenShareReadyBeforeInterview: boolean;
  screenSharePromptRequired: boolean;
  preInterviewScreenShareRequestedAt: number | null;
  preInterviewScreenShareGrantedAt: number | null;
  lastObservationAt: number | null;
};

const FACE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const OBJECT_MODEL_URL = 'https://storage.googleapis.com/mediapipe-tasks/object_detector/efficientdet_lite0_uint8.tflite';
const ALERT_COOLDOWN_MS = 15000;
const NO_FACE_THRESHOLD_MS = 4000;
const LIVE_INTERVAL_MS = 500; // check twice as often for lower lag
const MULTI_FACE_CONFIRM_MS = 1500;
const GAZE_CONFIRM_MS = 1000; // faster gaze confirmation
const HEAD_POSE_CONFIRM_MS = 1200;
const CAMERA_OFF_CONFIRM_MS = 2000;
const TAB_SWITCH_ALERT_COOLDOWN_MS = 500;
const TAB_SWITCH_CONFIRM_MS = 800;
const FULLSCREEN_ALERT_COOLDOWN_MS = 1000;
const CLIPBOARD_SHORTCUT_ALERT_COOLDOWN_MS = 1000;
const HEAD_POSE_ROTATION_THRESHOLD_DEG = 23;
const HEAD_POSE_AXIS_THRESHOLD_DEG = 23;
// Small head tilts naturally move the eyes in the opposite direction relative to the face.
// These constants compensate that face-relative gaze shift before deciding whether gaze is away.
const HEAD_POSE_GAZE_COMPENSATION_START_DEG = 2.5;
const HEAD_POSE_GAZE_COMPENSATION_MAX_DEG = 16;
const HEAD_YAW_TO_GAZE_X_FACTOR = 0.01;
const GAZE_BLENDSHAPE_THRESHOLD = 0.8; // no-landmark liveness fallback (left/right from blendshapes)
// Vertical (up/down) gaze is handled entirely by the world-vertical BAND model in gazeVerticalMath.ts:
// one signal — head-pitch-compensated (eyeLookDown − eyeLookUp) — compared against the calibrated
// [vBandTop, vBandBottom] band. The old iris-offsetY geometry path and its blendshape-correction
// constants were removed: they could never flag "above the screen", false-fired "down" on chin-up,
// and had no single workable sensitivity (see the redesign notes).
// Fallback horizontal threshold used when no calibration has been run. thresholdY is legacy/debug only.
const DEFAULT_GAZE_THRESHOLD_X = FALLBACK_GAZE_THRESHOLD_X;
const DEFAULT_GAZE_THRESHOLD_Y = FALLBACK_GAZE_THRESHOLD_Y;
const DEFAULT_VIOLATION_SCREEN_CLIP_MS = 8000;
const MIN_VIOLATION_SCREEN_CLIP_MS = 3000;
const MAX_VIOLATION_SCREEN_CLIP_MS = 30000;
const VIOLATION_SCREEN_RECORDING_TIMESLICE_MS = 1000;


// ─────────────────────────────────────────────────────────────────────────────
// Violation screen recorder — captures a short clip of the candidate's ENTIRE
// screen around each integrity violation (tab switch, fullscreen exit, phone,
// clipboard shortcut, etc.). One long-lived getDisplayMedia share is reused for
// every clip so the candidate is prompted only once; audio siphoned off the same
// share feeds the transcript hook (no second prompt).
// ─────────────────────────────────────────────────────────────────────────────

/** Unique clip id, preferring crypto.randomUUID with a timestamp+random fallback. */
function makeViolationRecordingId(prefix = 'violation-recording') {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && 'randomUUID' in cryptoObj) {
    return `${prefix}-${cryptoObj.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Pick the best-supported MediaRecorder container/codec (VP9→VP8→webm→mp4), or '' if none. */
export function getBestViolationRecordingMimeType() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) {
    return '';
  }

  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ];

  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

/** True when the screen-share stream still has at least one live video track. */
function isScreenShareStreamActive(stream: MediaStream | null) {
  return Boolean(stream && stream.getVideoTracks().some((track) => track.readyState === 'live'));
}

/** Feature-detect getDisplayMedia + MediaRecorder. Defaults true during SSR (no navigator). */
function isScreenShareRecordingSupported() {
  if (typeof navigator === 'undefined') return true;
  return typeof navigator.mediaDevices?.getDisplayMedia === 'function' && typeof MediaRecorder !== 'undefined';
}

/** Feature-detect getUserMedia for the microphone. Defaults true during SSR. */
function isMicrophoneCaptureSupported() {
  if (typeof navigator === 'undefined') return true;
  return typeof navigator.mediaDevices?.getUserMedia === 'function';
}

/**
 * Hook owning the whole-screen violation recorder. Holds the persistent share
 * stream + a single MediaRecorder, and exposes start/stop/one-shot-clip helpers.
 * Clips have enforced min/max durations (short violations still yield a usable
 * clip; runaway recordings auto-stop) and are handed back via onClipReady.
 */
function useViolationScreenRecorder(options: UseViolationScreenRecorderOptions = {}) {
  const {
    defaultClipMs = DEFAULT_VIOLATION_SCREEN_CLIP_MS,
    minClipMs = MIN_VIOLATION_SCREEN_CLIP_MS,
    maxClipMs = MAX_VIOLATION_SCREEN_CLIP_MS,
    timesliceMs = VIOLATION_SCREEN_RECORDING_TIMESLICE_MS,
    onClipReady,
    onError,
    onScreenShareStopped,
  } = options;

  const [hasScreenSharePermission, setHasScreenSharePermission] = useState(false);
  const [isRecordingViolation, setIsRecordingViolation] = useState(false);
  const [screenShareError, setScreenShareError] = useState<string | null>(null);

  const screenStreamRef = useRef<MediaStream | null>(null);
  // Audio track siphoned off the SAME screen-share prompt (the avatar's voice
  // plays through the tab/system). Kept separate so the proctoring video
  // recorder stays video-only and unchanged; consumed by the transcript hook
  // so we never fire a second getDisplayMedia prompt to capture the interviewer.
  const screenAudioStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const activeMetaRef = useRef<ActiveViolationRecordingMeta | null>(null);
  const autoStopTimerRef = useRef<number | null>(null);
  const pendingStopTimerRef = useRef<number | null>(null);

  const clearTimer = useCallback((timerRef: MutableRefObject<number | null>) => {
    if (timerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const emitRecorderError = useCallback(
    (error: Error) => {
      setScreenShareError(error.message);
      onError?.(error);
    },
    [onError],
  );

  /** Tear down both the video and the siphoned-audio share tracks and drop the permission flag. */
  const stopScreenShare = useCallback(() => {
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    screenAudioStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenAudioStreamRef.current = null;
    setHasScreenSharePermission(false);
  }, []);

  /**
   * Prompt for (or reuse) a whole-screen share. ENFORCES Entire-Screen selection
   * (rejects tab/window — fail-closed) and splits the granted stream into a
   * video-only proctoring stream plus a separate audio stream for transcription.
   * Returns true on success; surfaces failures through emitRecorderError.
   */
  const requestScreenShare = useCallback(async () => {
    try {
      setScreenShareError(null);

      if (isScreenShareStreamActive(screenStreamRef.current)) {
        setHasScreenSharePermission(true);
        return true;
      }

      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === 'undefined') {
        throw new Error('Screen recording is not supported in this browser.');
      }

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: 15,
          width: { ideal: 1280 },
          height: { ideal: 720 },
          displaySurface: 'monitor',
        } as MediaTrackConstraints,
        // Prefer the whole-screen option in the picker and drop the "this tab"
        // choice so candidates are nudged toward Entire Screen. These are hints
        // only — the actual selection is enforced below.
        monitorTypeSurfaces: 'include',
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'exclude',
        // Also request audio on this SAME prompt so a single share can capture
        // the interviewer's voice (avatar audio routes through the tab/system)
        // for transcription — eliminating a second getDisplayMedia prompt. Clean
        // audio (no AEC/AGC) for STT. If the candidate doesn't tick "share
        // audio", no audio track arrives and we simply fall back to a dedicated
        // prompt later (nothing here breaks).
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } as any,
      } as DisplayMediaStreamOptions);

      // ENFORCE whole-screen sharing. `displaySurface: 'monitor'` above is only a
      // hint — Chromium still lets the candidate pick a single tab or window, and
      // there's no way to remove those from the picker. So we inspect what they
      // actually chose: getSettings().displaySurface is 'monitor' for "Entire
      // Screen", 'window' for an app window, 'browser' for a tab. Reject anything
      // but a monitor (fail-closed). The candidate room already requires a
      // Chromium browser (Chrome/Edge), which reports displaySurface reliably;
      // Firefox/Safari — which don't — are blocked before they reach this point.
      const [selectedVideoTrack] = stream.getVideoTracks();
      const selectedSurface = selectedVideoTrack?.getSettings?.().displaySurface;
      if (selectedSurface !== 'monitor') {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error(
          'Please share your ENTIRE SCREEN, not a browser tab or a single window. In the share dialog pick "Entire Screen", then try again.',
        );
      }

      stopScreenShare();

      // Keep the proctoring recorder VIDEO-ONLY (unchanged behavior); siphon any
      // shared audio into a separate stream for interviewer-voice transcription.
      const audioTracks = stream.getAudioTracks();
      screenAudioStreamRef.current = audioTracks.length ? new MediaStream(audioTracks) : null;
      screenStreamRef.current = new MediaStream(stream.getVideoTracks());
      setHasScreenSharePermission(true);

      const [videoTrack] = stream.getVideoTracks();
      if (videoTrack) {
        videoTrack.onended = () => {
          setHasScreenSharePermission(false);
          screenStreamRef.current = null;
          screenAudioStreamRef.current?.getTracks().forEach((t) => t.stop());
          screenAudioStreamRef.current = null;
          onScreenShareStopped?.();
        };
      }

      return true;
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Failed to start screen sharing.');
      emitRecorderError(err);
      return false;
    }
  }, [emitRecorderError, onScreenShareStopped, stopScreenShare]);

  /**
   * MediaRecorder.onstop handler: assemble the buffered chunks into a Blob + object
   * URL, stamp the clip metadata (duration, violation types, event list), reset the
   * recorder state, and hand the finished clip to onClipReady.
   */
  const finalizeRecording = useCallback(() => {
    const meta = activeMetaRef.current;
    const recorder = recorderRef.current;

    if (!meta || !recorder) return;

    const endedAtMs = Date.now();
    const endedAtISO = new Date(endedAtMs).toISOString();
    const mimeType = recorder.mimeType || getBestViolationRecordingMimeType() || 'video/webm';
    const blob = new Blob(chunksRef.current, { type: mimeType });
    const url = URL.createObjectURL(blob);

    const clip: ViolationRecordingClip = {
      id: meta.id,
      startedAt: meta.startedAtISO,
      endedAt: endedAtISO,
      durationMs: endedAtMs - meta.startedAtMs,
      violationTypes: Array.from(meta.violationTypes),
      events: meta.events,
      blob,
      url,
      mimeType,
    };

    chunksRef.current = [];
    recorderRef.current = null;
    activeMetaRef.current = null;
    setIsRecordingViolation(false);

    void onClipReady?.(clip);
  }, [onClipReady]);

  /**
   * Stop the active recording, but never before minClipMs has elapsed: if the
   * violation ends too soon the stop is deferred so every clip is long enough to
   * be reviewable. Also clears the auto-stop safety timer.
   */
  const stopViolationRecording = useCallback(() => {
    const recorder = recorderRef.current;
    const meta = activeMetaRef.current;

    if (!recorder || !meta || recorder.state === 'inactive') return;

    const elapsedMs = Date.now() - meta.startedAtMs;
    const stopNow = () => {
      clearTimer(autoStopTimerRef);
      clearTimer(pendingStopTimerRef);
      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
    };

    if (elapsedMs < minClipMs && typeof window !== 'undefined') {
      clearTimer(pendingStopTimerRef);
      pendingStopTimerRef.current = window.setTimeout(stopNow, minClipMs - elapsedMs);
      return;
    }

    stopNow();
  }, [clearTimer, minClipMs]);

  /**
   * Begin (or extend) a violation recording. If a recording is already running,
   * the new violation type/event is merged into the active clip instead of
   * starting a second recorder — overlapping violations share one clip. Arms a
   * maxClipMs auto-stop so a recording can never run away. Requires an active share.
   */
  const startViolationRecording = useCallback(
    (type: ProctoringViolationType, details?: Record<string, unknown>) => {
      try {
        setScreenShareError(null);

        if (typeof MediaRecorder === 'undefined') {
          throw new Error('Violation screen recording is not supported in this browser.');
        }

        if (!isScreenShareStreamActive(screenStreamRef.current)) {
          throw new Error('Screen share permission is missing. Ask the candidate to share their screen before starting the interview.');
        }

        const nowISO = new Date().toISOString();
        const activeMeta = activeMetaRef.current;

        if (activeMeta && recorderRef.current?.state === 'recording') {
          activeMeta.violationTypes.add(type);
          activeMeta.events.push({ type, at: nowISO, details });
          return true;
        }

        const mimeType = getBestViolationRecordingMimeType();
        chunksRef.current = [];

        const recorder = mimeType
          ? new MediaRecorder(screenStreamRef.current!, { mimeType })
          : new MediaRecorder(screenStreamRef.current!);

        const meta: ActiveViolationRecordingMeta = {
          id: makeViolationRecordingId(),
          startedAtISO: nowISO,
          startedAtMs: Date.now(),
          violationTypes: new Set([type]),
          events: [{ type, at: nowISO, details }],
        };

        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            chunksRef.current.push(event.data);
          }
        };

        recorder.onerror = () => {
          emitRecorderError(new Error('Screen violation recording failed.'));
        };

        recorder.onstop = finalizeRecording;

        recorderRef.current = recorder;
        activeMetaRef.current = meta;
        recorder.start(timesliceMs);
        setIsRecordingViolation(true);

        clearTimer(autoStopTimerRef);
        if (typeof window !== 'undefined') {
          autoStopTimerRef.current = window.setTimeout(() => {
            stopViolationRecording();
          }, maxClipMs);
        }

        return true;
      } catch (error) {
        const err = error instanceof Error ? error : new Error('Could not start violation recording.');
        emitRecorderError(err);
        return false;
      }
    },
    [clearTimer, emitRecorderError, finalizeRecording, maxClipMs, stopViolationRecording, timesliceMs],
  );

  /**
   * One-shot convenience: start a recording and schedule its stop after clipMs
   * (clamped to [minClipMs, maxClipMs]). Used for point-in-time violations that
   * have no natural "returned" event to close the clip (phone, no-face, clipboard).
   */
  const recordViolationClip = useCallback(
    (type: ProctoringViolationType, details?: Record<string, unknown>, clipMs = defaultClipMs) => {
      const started = startViolationRecording(type, details);
      if (!started) return false;
      if (typeof window === 'undefined') return true;

      window.setTimeout(() => {
        stopViolationRecording();
      }, Math.min(Math.max(clipMs, minClipMs), maxClipMs));

      return true;
    },
    [defaultClipMs, maxClipMs, minClipMs, startViolationRecording, stopViolationRecording],
  );

  useEffect(() => {
    return () => {
      clearTimer(autoStopTimerRef);
      clearTimer(pendingStopTimerRef);
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
    };
  }, [clearTimer]);

  // Returns the audio MediaStream siphoned off the screen share (or null if the
  // candidate didn't share audio). Consumed by the transcript hook so the
  // interviewer's voice is captured from the existing share — no second prompt.
  const getScreenAudioStream = useCallback(() => screenAudioStreamRef.current, []);

  // Returns the video-only MediaStream from the same screen share (shows Lina + whatever
  // the candidate shared). Consumed by the full-interview recorder so it doesn't need a
  // second getDisplayMedia prompt.
  const getScreenVideoStream = useCallback(() => screenStreamRef.current, []);

  return {
    hasScreenSharePermission,
    isRecordingViolation,
    screenShareError,
    requestScreenShare,
    stopScreenShare,
    getScreenAudioStream,
    getScreenVideoStream,
    startViolationRecording,
    stopViolationRecording,
    recordViolationClip,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Enhanced phone-detection — types & constants
// ─────────────────────────────────────────────────────────────────────────────

export type PhoneProximity = 'onscreen' | 'close' | 'mid' | 'far';

export type PhoneOrientation = 'portrait' | 'landscape' | 'diagonal' | 'unknown';

export type PhoneSource = 'ml_label' | 'aspect_heuristic' | 'edge_touch' | 'combined';

export type PhoneAnalysis = {
  detected:          boolean;
  confidence:        number;
  rollingConfidence: number;
  proximity:         PhoneProximity;
  orientation:       PhoneOrientation;
  source:            PhoneSource;
  confirmMs:         number;
  detections: Array<{
    label:       string;
    score:       number;
    areaRatio:   number;
    aspectRatio: number;
  }>;
};

type PhoneState = {
  scoreBuffer:    number[];
  confirmedSince: number | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// ← NEW: Foreign-object detection types & constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of the foreign-object edge-peek analysis for a single frame.
 *
 * A "foreign object" is any non-whitelisted item that:
 *   (a) partially enters the frame from any edge  (edge-peek), OR
 *   (b) occupies the lower-third of the frame between the candidate's face
 *       region and the camera (occlusion heuristic).
 *
 * Allowed objects that are explicitly NOT flagged:
 *   • body parts  (hand, arm, shoulder, finger, wrist, elbow, neck, face, head)
 *   • writing instruments (pen, pencil, marker, stylus)
 *
 * Everything else — phones, tablets, remotes, books, notepads, cups, bottles,
 * keys, wallets, earphones, glasses cases, etc. — should not appear between
 * the candidate and the camera during a proctored session.
 */
export type ForeignObjectAnalysis = {
  detected:       boolean;
  label:          string;
  confidence:     number;
  /** 'edge_peek'   — box clips frame boundary but covers < PEEK_MAX_AREA of frame */
  /** 'occluding'   — box sits in the lower third of the frame at significant size */
  /** 'partial_edge'— tiny sliver (< PEEK_MIN_AREA) sustained over multiple frames */
  trigger:        'edge_peek' | 'occluding' | 'partial_edge' | 'none';
  areaRatio:      number;
  edgeSides:      Array<'top' | 'bottom' | 'left' | 'right'>;
};

type ForeignObjectState = {
  /** Rolling frame buffer of per-frame foreign-object scores (0 or raw score). */
  scoreBuffer:    number[];
  confirmedSince: number | null;
  /** Label of the most recently sustained detection for metadata. */
  lastLabel:      string;
};

// ── Foreign-object tuning constants ──────────────────────────────────────────

/**
 * Objects that are explicitly ALLOWED between the candidate and the camera.
 * Body parts are listed exhaustively because EfficientDet may predict them
 * on clothing, reflected surfaces, or close-up camera views.
 */
const FOREIGN_OBJECT_ALLOWLIST: string[] = [
  // body parts
  'person', 'people', 'human', 'face', 'man', 'woman', 'boy', 'girl',
  'head', 'body', 'torso', 'hand', 'arm', 'finger', 'wrist', 'elbow',
  'shoulder', 'neck', 'chest', 'ear', 'eye', 'nose', 'mouth', 'lip',
  // writing instruments
  'pen', 'pencil', 'marker', 'stylus', 'crayon', 'chalk',
  // headphones / earphones are common during interviews — allow them
  'headphone', 'headset', 'earphone', 'earpiece',
  // glasses on the candidate's face are ok
  'glasses', 'sunglasses',
];

/**
 * Minimum fraction of the frame area a box must cover to trigger the
 * edge-peek strategy.  Below this the box is likely a detection artefact.
 * 0.003 ≈ a ~50×40 px box in a 640×480 frame — a sliver of a phone edge.
 */
const PEEK_MIN_AREA = 0.003;

/**
 * Maximum fraction for the edge-peek strategy.  Above this the object is
 * large enough to be caught by the phone-detection logic or the occlusion
 * heuristic — no need to double-count.
 */
const PEEK_MAX_AREA = 0.20;

/**
 * Fraction of frame width/height considered "touching" an edge.
 * Slightly wider than EDGE_MARGIN used in phone detection so that objects
 * peeking in from outside the frame are caught even when their centroid is
 * still inside by a small margin.
 */
const FOREIGN_EDGE_MARGIN = 0.06;

/**
 * Objects in the lower third of the frame (y > OCCLUDE_Y_THRESHOLD) that
 * cover more than OCCLUDE_MIN_AREA of the frame are treated as occluding
 * objects between the candidate and the camera.
 */
const OCCLUDE_Y_THRESHOLD = 0.60;   // normalised y of top edge of bounding box
const OCCLUDE_MIN_AREA    = 0.06;   // 6 % of frame area

/** Minimum ML score to consider a detection for foreign-object analysis. */
const FOREIGN_MIN_SCORE   = 0.25;

/** Rolling window length (frames) for foreign-object sustained detection. */
const FOREIGN_ROLLING_WINDOW = 12;   // ≈ 2.4 s at 200 ms/frame

/**
 * A very small edge-peeking object (PEEK_MIN_AREA … 0.02) requires more
 * frames of sustained presence before an alert fires.
 */
const FOREIGN_CONFIRM_MS_SMALL  = 2000;
const FOREIGN_CONFIRM_MS_NORMAL = 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Phone-detection tuning constants (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

const PHONE_SCORE_THRESHOLD = 0.2;
const CONFIRM_MS_HIGH       = 500;
const CONFIRM_MS_MED        = 1200;
const CONFIRM_MS_LOW        = 2500;

const AREA_ONSCREEN = 0.40;
const AREA_CLOSE    = 0.15;
const AREA_MID      = 0.04;

const PORTRAIT_AR  = { min: 0.38, max: 0.62 };
const LANDSCAPE_AR = { min: 1.70, max: 2.90 };
const DIAGONAL_AR  = { min: 0.63, max: 1.69 };

const MIN_HEURISTIC_AREA = 0.006;
const ROLLING_WINDOW     = 20;
const COMBINED_BONUS     = 0.15;

const EDGE_MARGIN          = 0.04;
const EDGE_TOUCH_BOOST     = 0.18;
const EDGE_STANDALONE_AREA = 0.25;

const PHONE_KEYWORDS = [
  'cell phone', 'mobile phone', 'smartphone', 'cellphone',
  'iphone', 'android', 'phone',
];

const ADJACENT_LABELS = [
  'remote', 'remote control', 'tablet', 'book', 'calculator', 'mouse',
];

const HEURISTIC_BLOCKLIST = [
  'person', 'people', 'human', 'face', 'man', 'woman', 'boy', 'girl',
  'head', 'body', 'torso', 'hand', 'arm',
  'door', 'window', 'picture frame', 'painting', 'poster',
  'screen', 'monitor', 'tv', 'television', 'laptop',
];

const PROXIMITY_RANK: Record<PhoneProximity, number> = {
  far: 0, mid: 1, close: 2, onscreen: 3,
};

// ─────────────────────────────────────────────────────────────────────────────
// Proctoring score types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Raw per-frame counters accumulated throughout the interview session.
 * Stored in a ref so updates never trigger re-renders.
 */
type ProctoringData = {
  gaze: {
    framesLookingAway: number;
    totalFrames: number;
  };
  face: {
    framesNormal: number;        // exactly 1 face visible
    framesNoFace: number;        // 0 faces visible
    framesMultipleFaces: number; // 2+ faces visible
    multipleFaceEvents: number;  // distinct transitions from <=1 -> >1 faces
    totalFrames: number;
  };
  tabSwitch: {
    count: number;               // number of distinct tab/window-switch events
  };
  phone: {
    detectedSeconds: number;       // cumulative seconds phone was visible
    maxConsecutiveSeconds: number; // longest single detection streak
    consecutiveSeconds: number;    // current streak, resets when not detected
    events: number;                // number of distinct detection streaks
    totalSeconds: number;          // total interview duration in seconds
    wasDetected: boolean;          // whether phone was detected last tick
  };
  headPose: {
    framesNormal: number;
    framesDeviated: number;
    totalFrames: number;
  };
  sessionControl: {
    fullscreenExitCount: number;
    screenShareStoppedCount: number;
    cameraOffSeconds: number;
    cameraOffMaxConsecutiveSeconds: number;
    cameraOffConsecutiveSeconds: number;
    cameraOffIncidentCount: number;
    screenShareStoppedAndNotRestored: boolean;
  };
};

/**
 * Final computed proctoring score returned by computeProctoringScore().
 * Pass this to your report-card component after the interview ends.
 */
export type ProctoringScore = {
  final: number; // 0-100 weighted composite
  gazeScore: number;
  faceScore: number;
  tabScore: number;
  phoneScore: number;
  headPoseScore: number;
  sessionControlScore: number;
  band: 'Clean' | 'Minor Concerns' | 'Suspicious' | 'High Risk';
  flags: string[];
};

function createInitialProctoringData(): ProctoringData {
  return {
    gaze: { framesLookingAway: 0, totalFrames: 0 },
    face: {
      framesNormal: 0,
      framesNoFace: 0,
      framesMultipleFaces: 0,
      multipleFaceEvents: 0,
      totalFrames: 0,
    },
    tabSwitch: { count: 0 },
    phone: {
      detectedSeconds: 0,
      maxConsecutiveSeconds: 0,
      consecutiveSeconds: 0,
      events: 0,
      totalSeconds: 0,
      wasDetected: false,
    },
    headPose: { framesNormal: 0, framesDeviated: 0, totalFrames: 0 },
    sessionControl: {
      fullscreenExitCount: 0,
      screenShareStoppedCount: 0,
      cameraOffSeconds: 0,
      cameraOffMaxConsecutiveSeconds: 0,
      cameraOffConsecutiveSeconds: 0,
      cameraOffIncidentCount: 0,
      screenShareStoppedAndNotRestored: false,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phone-detection helpers (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

/** Lowercased label for an EfficientDet category, tolerating the various field names it uses. */
function getPhoneCategoryName(category: any): string {
  return (
    (category.categoryName || category.displayName || category.label || '')
      .toString()
      .toLowerCase()
  );
}

/** Map a box's frame-area fraction to a coarse distance bucket (bigger box ⇒ closer). */
function getProximity(areaRatio: number): PhoneProximity {
  if (areaRatio >= AREA_ONSCREEN) return 'onscreen';
  if (areaRatio >= AREA_CLOSE)    return 'close';
  if (areaRatio >= AREA_MID)      return 'mid';
  return 'far';
}

/** Classify a box's width/height aspect ratio as a phone-shaped portrait/landscape/diagonal. */
function getPhoneOrientation(ar: number): PhoneOrientation {
  if (ar >= PORTRAIT_AR.min  && ar <= PORTRAIT_AR.max)  return 'portrait';
  if (ar >= LANDSCAPE_AR.min && ar <= LANDSCAPE_AR.max) return 'landscape';
  if (ar >= DIAGONAL_AR.min  && ar <= DIAGONAL_AR.max)  return 'diagonal';
  return 'unknown';
}

/** Linearly recency-weighted mean of a score buffer (newest sample weighted highest). */
function rollingScore(buffer: number[]): number {
  if (!buffer.length) return 0;
  let wSum = 0, wTotal = 0;
  for (let i = 0; i < buffer.length; i++) {
    const w = i + 1;
    wSum   += buffer[i] * w;
    wTotal += w;
  }
  return wSum / wTotal;
}

function createPhoneState(): PhoneState {
  return { scoreBuffer: [], confirmedSince: null };
}

/** Sustained-confirmation window before a phone alert fires: shorter when the signal is strong/close. */
function getPhoneConfirmMs(confidence: number, proximity: PhoneProximity): number {
  if (confidence >= 0.55 || proximity === 'close' || proximity === 'onscreen') return CONFIRM_MS_HIGH;
  if (confidence >= 0.35 || proximity === 'mid') return CONFIRM_MS_MED;
  return CONFIRM_MS_LOW;
}

/** True when the box hugs any frame edge (within `margin`), a strong cue for a hand-held phone. */
function isEdgeTouching(
  box: { originX: number; originY: number; width: number; height: number },
  videoWidth: number,
  videoHeight: number,
  margin = EDGE_MARGIN,
): boolean {
  const x1 = box.originX / videoWidth;
  const y1 = box.originY / videoHeight;
  const x2 = (box.originX + box.width)  / videoWidth;
  const y2 = (box.originY + box.height) / videoHeight;
  return x1 <= margin || y1 <= margin || x2 >= (1 - margin) || y2 >= (1 - margin);
}

/**
 * Per-frame phone analysis fusing four independent strategies, because EfficientDet
 * rarely labels a phone reliably on a webcam feed:
 *   1. ML label      — a categories match against PHONE_KEYWORDS, edge-boosted.
 *   2. aspect heuristic — a phone-shaped box (portrait/landscape/diagonal) not on the
 *                         blocklist, scored by size and phone-adjacency.
 *   3. combined bonus — two+ strategies agreeing adds COMBINED_BONUS confidence.
 *   4. edge-touch standalone — a large phone-shaped box clipping an edge, even unlabeled.
 * The frame's raw confidence is pushed into a recency-weighted rolling buffer so a
 * single noisy frame cannot trip (or clear) detection. Also reports the closest
 * proximity/orientation seen and the per-strategy confirm window.
 */
function analyzePhoneDetection(
  result: ObjectDetectorResult,
  videoWidth: number,
  videoHeight: number,
  state: PhoneState,
): PhoneAnalysis {
  const frameArea = (videoWidth * videoHeight) || 1;

  let mlScore        = 0;
  let heuristicScore = 0;
  let edgeScore      = 0;
  let bestProximity:   PhoneProximity   = 'far';
  let bestOrientation: PhoneOrientation = 'unknown';
  const detections: PhoneAnalysis['detections'] = [];

  for (const detection of result.detections ?? []) {
    const box = detection.boundingBox;
    if (!box?.width || !box?.height) continue;

    const areaRatio   = (box.width * box.height) / frameArea;
    const aspectRatio = box.width / box.height;
    const orientation = getPhoneOrientation(aspectRatio);
    const proximity   = getProximity(areaRatio);
    const edgeTouching = isEdgeTouching(box, videoWidth, videoHeight);

    // Strategy 1: ML label
    for (const category of detection.categories ?? []) {
      const name  = getPhoneCategoryName(category);
      let   score = typeof category.score === 'number' ? category.score : 0;
      if (PHONE_KEYWORDS.some((kw) => name.includes(kw)) && score >= PHONE_SCORE_THRESHOLD) {
        if (edgeTouching) score = Math.min(score + EDGE_TOUCH_BOOST, 1.0);
        if (score > mlScore) {
          mlScore = score;
          if (PROXIMITY_RANK[proximity] > PROXIMITY_RANK[bestProximity]) {
            bestProximity   = proximity;
            bestOrientation = orientation !== 'unknown' ? orientation : bestOrientation;
          }
        }
        detections.push({ label: name, score, areaRatio, aspectRatio });
      }
    }

    // Strategy 2: Aspect-ratio heuristic
    if (areaRatio >= MIN_HEURISTIC_AREA && orientation !== 'unknown') {
      const alreadyScoredByML = detections.some(
        (d) => d.areaRatio === areaRatio && d.aspectRatio === aspectRatio && !d.label.startsWith('~'),
      );
      if (!alreadyScoredByML) {
        let bestCategoryScore = 0;
        let bestLabel         = 'object';
        for (const category of detection.categories ?? []) {
          const name  = getPhoneCategoryName(category);
          const score = typeof category.score === 'number' ? category.score : 0;
          if (score > bestCategoryScore) { bestCategoryScore = score; bestLabel = name; }
        }
        const isBlocked  = HEURISTIC_BLOCKLIST.some((kw) => bestLabel.includes(kw));
        if (isBlocked) continue;
        const isAdjacent = ADJACENT_LABELS.some((kw) => bestLabel.includes(kw));
        let computed = 0;
        if (orientation === 'portrait') {
          const sizeFactor    = Math.min(areaRatio / AREA_MID, 2.5);
          const adjacentBoost = isAdjacent ? 0.12 : 0;
          computed = 0.46 * sizeFactor + adjacentBoost;
        } else if (orientation === 'landscape') {
          if (!isAdjacent) continue;
          const sizeFactor = Math.min(areaRatio / AREA_MID, 2.5);
          computed = 0.36 * sizeFactor + 0.12;
        } else if (orientation === 'diagonal') {
          if (!isAdjacent && !edgeTouching) continue;
          if (areaRatio < MIN_HEURISTIC_AREA * 2.0) continue;
          const sizeFactor    = Math.min(areaRatio / AREA_MID, 2.5);
          const adjacentBoost = isAdjacent ? 0.10 : 0;
          computed = 0.32 * sizeFactor + adjacentBoost;
        }
        if (edgeTouching) computed += EDGE_TOUCH_BOOST;
        const capped = Math.min(computed, 0.72);
        if (capped >= PHONE_SCORE_THRESHOLD) {
          if (capped > heuristicScore) {
            heuristicScore = capped;
            if (PROXIMITY_RANK[proximity] > PROXIMITY_RANK[bestProximity]) {
              bestProximity = proximity; bestOrientation = orientation;
            }
          }
          detections.push({ label: `~${bestLabel}`, score: capped, areaRatio, aspectRatio });
        }
      }
    }

    // Strategy 4: Edge-touch standalone
    const alreadyScored = detections.some(
      (d) => d.areaRatio === areaRatio && d.aspectRatio === aspectRatio,
    );
    if (
      edgeTouching && !alreadyScored &&
      areaRatio >= EDGE_STANDALONE_AREA &&
      (orientation === 'portrait' || orientation === 'diagonal')
    ) {
      let bestCategoryScore = 0;
      let bestLabel         = 'object';
      for (const category of detection.categories ?? []) {
        const name  = getPhoneCategoryName(category);
        const score = typeof category.score === 'number' ? category.score : 0;
        if (score > bestCategoryScore) { bestCategoryScore = score; bestLabel = name; }
      }
      const isBlocked = HEURISTIC_BLOCKLIST.some((kw) => bestLabel.includes(kw));
      if (!isBlocked) {
        const standalone = 0.48;
        if (standalone > edgeScore) {
          edgeScore = standalone;
          if (PROXIMITY_RANK['onscreen'] > PROXIMITY_RANK[bestProximity]) {
            bestProximity = 'onscreen'; bestOrientation = orientation;
          }
        }
        detections.push({ label: `~edge:${bestLabel}`, score: standalone, areaRatio, aspectRatio });
      }
    }
  }

  // Strategy 3: Combined bonus
  const strategyCount = [mlScore, heuristicScore, edgeScore].filter((s) => s > 0).length;
  const rawConfidence =
    strategyCount >= 2
      ? Math.min(Math.max(mlScore, heuristicScore, edgeScore) + COMBINED_BONUS, 1.0)
      : Math.max(mlScore, heuristicScore, edgeScore);

  state.scoreBuffer.push(rawConfidence);
  if (state.scoreBuffer.length > ROLLING_WINDOW) state.scoreBuffer.shift();
  const rolling = rollingScore(state.scoreBuffer);

  const source: PhoneSource =
    strategyCount >= 2                       ? 'combined'
    : mlScore > 0                            ? 'ml_label'
    : edgeScore > 0 && heuristicScore === 0  ? 'edge_touch'
    :                                          'aspect_heuristic';

  return {
    detected:          rolling >= PHONE_SCORE_THRESHOLD,
    confidence:        rawConfidence,
    rollingConfidence: rolling,
    proximity:         bestProximity,
    orientation:       bestOrientation,
    source,
    confirmMs:         getPhoneConfirmMs(rolling, bestProximity),
    detections,
  };
}

/**
 * Edge-triggered gate: returns true once the phone has stayed detected for its full
 * confirmMs window, then resets so the next alert requires a fresh sustained streak.
 */
function consumePhoneAlert(phone: PhoneAnalysis, state: PhoneState): boolean {
  if (!phone.detected) { state.confirmedSince = null; return false; }
  if (state.confirmedSince === null) state.confirmedSince = Date.now();
  const held = Date.now() - state.confirmedSince;
  if (held >= phone.confirmMs) { state.confirmedSince = null; return true; }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// ← NEW: Foreign-object detection helpers
// ─────────────────────────────────────────────────────────────────────────────

function createForeignObjectState(): ForeignObjectState {
  return { scoreBuffer: [], confirmedSince: null, lastLabel: '' };
}

/**
 * Returns true when the label is explicitly allowed between the candidate
 * and the camera (body parts and writing instruments).
 */
function isForeignObjectAllowed(label: string): boolean {
  return FOREIGN_OBJECT_ALLOWLIST.some((allowed) => label.includes(allowed));
}

/**
 * Returns which frame edges (top / bottom / left / right) the bounding box
 * clips, using a wider margin than the phone-detection edge check so that
 * objects peeking in from outside the frame are reliably caught.
 *
 * Coordinates are normalised to [0, 1].
 */
function getEdgeSides(
  box: { originX: number; originY: number; width: number; height: number },
  videoWidth: number,
  videoHeight: number,
): Array<'top' | 'bottom' | 'left' | 'right'> {
  const x1 = box.originX / videoWidth;
  const y1 = box.originY / videoHeight;
  const x2 = (box.originX + box.width)  / videoWidth;
  const y2 = (box.originY + box.height) / videoHeight;
  const m  = FOREIGN_EDGE_MARGIN;
  const sides: Array<'top' | 'bottom' | 'left' | 'right'> = [];
  if (x1 <= m)       sides.push('left');
  if (x2 >= 1 - m)   sides.push('right');
  if (y1 <= m)       sides.push('top');
  if (y2 >= 1 - m)   sides.push('bottom');
  return sides;
}

/**
 * Per-frame foreign-object analysis.
 *
 * Three triggers, evaluated in priority order:
 *
 *   1. partial_edge — a very small box (< PEEK_MIN_AREA × 3) that clips an edge.
 *                    Requires a longer sustained presence (handled by
 *                    FOREIGN_CONFIRM_MS_SMALL) to avoid noise from detection
 *                    artefacts at frame boundaries.
 *
 *   2. edge_peek   — a non-whitelisted object's box clips ≥ 1 frame edge AND
 *                    covers PEEK_MIN_AREA × 3 … PEEK_MAX_AREA of the frame.
 *                    This is the primary scenario the user described:
 *                    "phone edge barely visible at the side of the screen."
 *
 *   3. occluding   — a non-whitelisted object sits in the lower 40 % of the
 *                    frame (below OCCLUDE_Y_THRESHOLD) and covers ≥ OCCLUDE_MIN_AREA.
 *                    This catches objects placed on a desk between the candidate
 *                    and the camera that are not fully peeking from an edge.
 *
 * The rolling average over FOREIGN_ROLLING_WINDOW frames smooths out single
 * missed frames without delaying the confirmation clock significantly.
 */
function analyzeForeignObject(
  result: ObjectDetectorResult,
  videoWidth: number,
  videoHeight: number,
  state: ForeignObjectState,
): ForeignObjectAnalysis {
  const frameArea = (videoWidth * videoHeight) || 1;

  let bestScore:      number = 0;
  let bestLabel:      string = '';
  let bestTrigger:    ForeignObjectAnalysis['trigger'] = 'none';
  let bestAreaRatio:  number = 0;
  let bestEdgeSides:  Array<'top' | 'bottom' | 'left' | 'right'> = [];

  for (const detection of result.detections ?? []) {
    const box = detection.boundingBox;
    if (!box?.width || !box?.height) continue;

    const areaRatio = (box.width * box.height) / frameArea;

    // Resolve the best label and its score for this detection.
    let detLabel = 'object';
    let detScore = 0;
    for (const category of detection.categories ?? []) {
      const name  = getPhoneCategoryName(category);
      const score = typeof category.score === 'number' ? category.score : 0;
      if (score > detScore) { detScore = score; detLabel = name; }
    }

    // Skip detections with very low ML confidence — likely noise.
    if (detScore < FOREIGN_MIN_SCORE) continue;

    // Skip explicitly allowed objects.
    if (isForeignObjectAllowed(detLabel)) continue;

    const edgeSides = getEdgeSides(box, videoWidth, videoHeight);
    const clipsEdge = edgeSides.length > 0;

    // ── Trigger 1: partial_edge ───────────────────────────────────────────
    // Tiny edge-clipping boxes are treated conservatively and require a longer
    // sustained confirmation window through consumeForeignObjectAlert().
    if (clipsEdge && areaRatio >= PEEK_MIN_AREA && areaRatio < PEEK_MIN_AREA * 3) {
      const computed = Math.min(detScore * 0.75, 1.0);
      if (computed > bestScore) {
        bestScore     = computed;
        bestLabel     = detLabel;
        bestTrigger   = 'partial_edge';
        bestAreaRatio = areaRatio;
        bestEdgeSides = edgeSides;
      }
      continue;
    }

    // ── Trigger 2: edge_peek ──────────────────────────────────────────────
    if (clipsEdge && areaRatio >= PEEK_MIN_AREA * 3 && areaRatio < PEEK_MAX_AREA) {
      // The box partially enters from outside the frame — a "peeking" object.
      // Weight the score by how much of the object is outside the frame:
      // a box that is 90 % outside (very thin sliver) still gets a meaningful
      // score because the candidate is deliberately hiding the object.
      const edgeBoost = edgeSides.length >= 2 ? 0.10 : 0; // corner peek
      const computed  = Math.min(detScore + edgeBoost, 1.0);

      if (computed > bestScore) {
        bestScore     = computed;
        bestLabel     = detLabel;
        bestTrigger   = 'edge_peek';
        bestAreaRatio = areaRatio;
        bestEdgeSides = edgeSides;
      }
      continue; // do not fall through to lower-priority triggers
    }

    // ── Trigger 3: occluding ─────────────────────────────────────────────
    // Normalise the top-edge y coordinate of the box.
    const normY1 = box.originY / videoHeight;
    if (normY1 >= OCCLUDE_Y_THRESHOLD && areaRatio >= OCCLUDE_MIN_AREA) {
      // Object sits low in the frame (near the desk surface) at significant size.
      const computed = Math.min(detScore * 0.9, 1.0); // slight discount vs edge peek
      if (computed > bestScore) {
        bestScore     = computed;
        bestLabel     = detLabel;
        bestTrigger   = 'occluding';
        bestAreaRatio = areaRatio;
        bestEdgeSides = edgeSides;
      }
      continue;
    }
  }

  // ── Rolling average ───────────────────────────────────────────────────────
  state.scoreBuffer.push(bestScore);
  if (state.scoreBuffer.length > FOREIGN_ROLLING_WINDOW) state.scoreBuffer.shift();
  const rolling = rollingScore(state.scoreBuffer);

  if (bestScore > 0) state.lastLabel = bestLabel;

  return {
    detected:   rolling >= FOREIGN_MIN_SCORE,
    label:      bestScore > 0 ? bestLabel : state.lastLabel,
    confidence: rolling,
    trigger:    bestScore > 0 ? bestTrigger : 'none',
    areaRatio:  bestAreaRatio,
    edgeSides:  bestEdgeSides,
  };
}

/**
 * Returns true when the foreign-object rolling signal has been sustained
 * long enough to warrant an alert.  The confirmation window is longer for
 * very small partial-edge detections to suppress artefact noise.
 */
function consumeForeignObjectAlert(
  fo: ForeignObjectAnalysis,
  state: ForeignObjectState,
): boolean {
  if (!fo.detected) { state.confirmedSince = null; return false; }
  if (state.confirmedSince === null) state.confirmedSince = Date.now();
  const confirmMs =
    fo.trigger === 'partial_edge' || fo.areaRatio < PEEK_MIN_AREA * 3
      ? FOREIGN_CONFIRM_MS_SMALL
      : FOREIGN_CONFIRM_MS_NORMAL;
  const held = Date.now() - state.confirmedSince;
  if (held >= confirmMs) { state.confirmedSince = null; return true; }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Head-pose estimation
// Head yaw/pitch/roll are tracked as DELTAS from a per-session baseline (the first
// clean face frame or the calibration pose). A large sustained deviation fires
// HEAD_MOVEMENT; a small yaw/pitch also feeds the gaze-compensation math so a tilt
// isn't misread as looking away. Preferred source is MediaPipe's transformation
// matrix, falling back to a landmark-geometry proxy.
// ─────────────────────────────────────────────────────────────────────────────

/** Safe indexed access into a single face's landmark array (undefined-tolerant). */
function getFacePoint(landmarks: FaceLandmarkerResult['faceLandmarks'][number] | undefined, index: number) {
  return landmarks?.[index];
}


type HeadPose = {
  yaw: number;
  pitch: number;
  roll: number;
  source: 'matrix' | 'landmarks';
};

type HeadPoseDeviation = {
  yaw: number;
  pitch: number;
  roll: number;
  magnitude: number;
  maxAxis: number;
  tooMuch: boolean;
};

function radiansToDegrees(value: number) {
  return (value * 180) / Math.PI;
}

/** Signed current−baseline angle difference wrapped into (−180°, 180°]. */
function normalizeAngleDelta(current: number, baseline: number) {
  let delta = current - baseline;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
}

/**
 * Preferred head pose: decompose MediaPipe's 4×4 facial transformation matrix into
 * Euler yaw/pitch/roll (degrees). Returns null when the matrix is absent or singular.
 */
function getHeadPoseFromMatrix(result: FaceLandmarkerResult | null): HeadPose | null {
  const matrix = (result as any)?.facialTransformationMatrixes?.[0];
  const data = matrix?.data ?? matrix?.matrix ?? matrix;

  if (!data || typeof data.length !== 'number' || data.length < 16) return null;

  // MediaPipe exposes a 4x4 facial transformation matrix. We only need the 3x3 rotation portion.
  // These Euler values are used as relative deltas from calibration, so tiny convention differences are okay.
  const values = Array.from(data as ArrayLike<number>);
  const r00 = values[0];
  const r10 = values[4];
  const r20 = values[8];
  const r21 = values[9];
  const r22 = values[10];

  const sy = Math.sqrt(r00 * r00 + r10 * r10);
  const singular = sy < 1e-6;
  const pitch = singular ? 0 : radiansToDegrees(Math.atan2(r21, r22));
  const yaw = radiansToDegrees(Math.atan2(-r20, sy));
  const roll = radiansToDegrees(Math.atan2(r10, r00));

  if (![yaw, pitch, roll].every(Number.isFinite)) return null;
  return { yaw, pitch, roll, source: 'matrix' };
}

/**
 * Fallback head pose from raw landmark geometry: nose offset from the eye-midpoint
 * (normalised by face width/height) gives yaw/pitch, eye-line slope gives roll.
 * Used when the transformation matrix is unavailable.
 */
function getHeadPoseFromLandmarks(result: FaceLandmarkerResult | null): HeadPose | null {
  const landmarks = result?.faceLandmarks?.[0];
  const leftEyeOuter = getFacePoint(landmarks, 33);
  const rightEyeOuter = getFacePoint(landmarks, 263);
  const leftFace = getFacePoint(landmarks, 234);
  const rightFace = getFacePoint(landmarks, 454);
  const noseTip = getFacePoint(landmarks, 1);
  const forehead = getFacePoint(landmarks, 10);
  const chin = getFacePoint(landmarks, 152);

  if (!leftEyeOuter || !rightEyeOuter || !leftFace || !rightFace || !noseTip || !forehead || !chin) return null;

  const faceWidth = Math.max(Math.abs(rightFace.x - leftFace.x), 0.0001);
  const faceHeight = Math.max(Math.abs(chin.y - forehead.y), 0.0001);
  const eyeMidX = (leftEyeOuter.x + rightEyeOuter.x) / 2;
  const eyeMidY = (leftEyeOuter.y + rightEyeOuter.y) / 2;

  const yaw = ((noseTip.x - eyeMidX) / faceWidth) * 90;
  const pitch = ((noseTip.y - eyeMidY) / faceHeight) * 90;
  const roll = radiansToDegrees(Math.atan2(rightEyeOuter.y - leftEyeOuter.y, rightEyeOuter.x - leftEyeOuter.x));

  if (![yaw, pitch, roll].every(Number.isFinite)) return null;
  return { yaw, pitch, roll, source: 'landmarks' };
}

/** Head pose from the matrix when available, else the landmark-geometry fallback. */
function estimateHeadPose(result: FaceLandmarkerResult | null): HeadPose | null {
  return getHeadPoseFromMatrix(result) ?? getHeadPoseFromLandmarks(result);
}

/**
 * Per-axis deltas from the calibration baseline plus the combined magnitude and the
 * single worst axis. `tooMuch` trips when either the vector magnitude or any single
 * axis crosses the ~23° threshold — the HEAD_MOVEMENT alarm condition.
 */
function calculateHeadPoseDeviation(current: HeadPose, baseline: HeadPose): HeadPoseDeviation {
  const yaw = normalizeAngleDelta(current.yaw, baseline.yaw);
  const pitch = normalizeAngleDelta(current.pitch, baseline.pitch);
  const roll = normalizeAngleDelta(current.roll, baseline.roll);
  const magnitude = Math.sqrt(yaw * yaw + pitch * pitch + roll * roll);
  const maxAxis = Math.max(Math.abs(yaw), Math.abs(pitch), Math.abs(roll));

  return {
    yaw,
    pitch,
    roll,
    magnitude,
    maxAxis,
    tooMuch: magnitude >= HEAD_POSE_ROTATION_THRESHOLD_DEG || maxAxis >= HEAD_POSE_AXIS_THRESHOLD_DEG,
  };
}

/** Deadzoned, capped head-pitch/yaw delta used to compensate gaze: ignore jitter below
 *  START, saturate at MAX (beyond which the head-movement alarm owns it). */
function clampHeadPoseForGazeCompensation(deltaDegrees: number) {
  if (!Number.isFinite(deltaDegrees)) return 0;
  const absDelta = Math.abs(deltaDegrees);
  if (absDelta <= HEAD_POSE_GAZE_COMPENSATION_START_DEG) return 0;

  const clampedAbsDelta = Math.min(absDelta, HEAD_POSE_GAZE_COMPENSATION_MAX_DEG);
  return Math.sign(deltaDegrees) * (clampedAbsDelta - HEAD_POSE_GAZE_COMPENSATION_START_DEG);
}

/** Sign-preserving shrink of `value` toward 0 by the head-pose contribution — the
 *  conservative fallback when signed compensation would be device-convention-wrong. */
function reduceMagnitudeByHeadPose(value: number, deltaDegrees: number, factor: number) {
  const reduction = Math.abs(clampHeadPoseForGazeCompensation(deltaDegrees)) * factor;
  if (reduction <= 0) return value;
  const remainingMagnitude = Math.max(0, Math.abs(value) - reduction);
  return Math.sign(value) * remainingMagnitude;
}

/**
 * Remove the face-relative gaze shift a head tilt induces (horizontal axis). Tries
 * signed compensation; if the device's coordinate convention makes that worsen the
 * reading, falls back to a magnitude-only reduction so compensation can never
 * manufacture a false gaze-away.
 */
function compensateGazeWithHeadPose(value: number, deltaDegrees: number, factor: number) {
  const clampedDelta = clampHeadPoseForGazeCompensation(deltaDegrees);
  if (clampedDelta === 0) return value;

  // Try signed compensation first. If MediaPipe/browser coordinate convention is flipped on a device,
  // fall back to a conservative magnitude reduction so compensation never makes the false positive worse.
  const signedCompensated = value + clampedDelta * factor;
  if (Math.abs(signedCompensated) < Math.abs(value)) return signedCompensated;

  return reduceMagnitudeByHeadPose(value, deltaDegrees, factor);
}

// Deterministic head pitch (chin-down positive, degrees) from face landmarks — the SAME signal
// calibration records (noseEyePitchDeg), so the calibrated band and the live world-vertical gaze
// share one vertical frame. Returns null when the needed landmarks are missing.
function gazePitchDegLive(result: FaceLandmarkerResult | null): number | null {
  const lm = result?.faceLandmarks?.[0];
  return noseEyePitchDeg(
    getFacePoint(lm, 33),
    getFacePoint(lm, 263),
    getFacePoint(lm, 1),
    getFacePoint(lm, 10),
    getFacePoint(lm, 152),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Gaze detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-frame gaze verdict on two independent axes:
 *   • HORIZONTAL — iris-in-socket offsetX vs the calibrated thresholdX. Eye corners
 *     are rigid under head rotation, so this is the reliable axis; optionally
 *     exponentially smoothed and head-yaw-compensated.
 *   • VERTICAL   — the world-vertical BAND model (classifyVertical): one signal,
 *     head-pitch-folded (eyeLookDown − eyeLookUp), compared against the per-person
 *     [vBandTop, vBandBottom] band. See gazeVerticalMath.ts.
 * The two are merged by combineGazeDirection (OR to fire, stronger axis names it).
 * When iris landmarks are missing it degrades to a raw blendshape liveness fallback.
 * thresholdY/neutralY are legacy debug plumbing and do not affect the verdict.
 */
function detectGazeAway(
  result: FaceLandmarkerResult | null,
  thresholdX = DEFAULT_GAZE_THRESHOLD_X,
  // thresholdY/neutralY are legacy plumbing (debug only) — vertical detection uses the band below.
  thresholdY = DEFAULT_GAZE_THRESHOLD_Y,
  neutralX = 0,
  neutralY = 0,
  headPoseDeviation?: HeadPoseDeviation | null,
  // optional smoothing ref to reduce jitter / sensitivity (horizontal only)
  filterRef?: { current: { x: number; y: number; initialized: boolean } } | null,
  smoothingAlpha = 0.25,
  // Personalised on-screen vertical band (signed world-vertical units) from calibration, and the
  // head-pitch delta (degrees, chin-down positive) vs the session baseline. Defaults = zero-config.
  vBandTop = DEFAULT_VERTICAL_BAND.vBandTop,
  vBandBottom = DEFAULT_VERTICAL_BAND.vBandBottom,
  gazePitchDeltaDeg = 0,
) {
  const faceLandmarks = result?.faceLandmarks?.[0];
  const faceBlendshapes = result?.faceBlendshapes?.[0]?.categories ?? [];

  const getBlendshapeScore = (name: string) =>
    faceBlendshapes.find((category) => (category.categoryName || category.displayName || '').toLowerCase() === name.toLowerCase())?.score ?? 0;

  const upLeft = getBlendshapeScore('eyeLookUpLeft');
  const upRight = getBlendshapeScore('eyeLookUpRight');
  const downLeft = getBlendshapeScore('eyeLookDownLeft');
  const downRight = getBlendshapeScore('eyeLookDownRight');
  const outLeft = getBlendshapeScore('eyeLookOutLeft');
  const outRight = getBlendshapeScore('eyeLookOutRight');
  const inLeft = getBlendshapeScore('eyeLookInLeft');
  const inRight = getBlendshapeScore('eyeLookInRight');

  const directionScores = [
    { direction: 'up', score: Math.min(upLeft, upRight) },
    { direction: 'down', score: Math.min(downLeft, downRight) },
    { direction: 'left', score: Math.min(outLeft, inRight) },
    { direction: 'right', score: Math.min(inLeft, outRight) },
  ];

  const bestBlendshape = directionScores
    .slice()
    .sort((a, b) => b.score - a.score)[0];

  // Iris-based gaze: iris position within the eye socket cancels out head rotation.
  // Indices: left eye corners 33/133, left iris 468, right eye corners 362/263, right iris 473.
  const leftEyeOuter  = getFacePoint(faceLandmarks, 33);
  const leftEyeInner  = getFacePoint(faceLandmarks, 133);
  const leftIris      = getFacePoint(faceLandmarks, 468);
  const rightEyeInner = getFacePoint(faceLandmarks, 362);
  const rightEyeOuter = getFacePoint(faceLandmarks, 263);
  const rightIris     = getFacePoint(faceLandmarks, 473);

  if (!leftEyeOuter || !leftEyeInner || !leftIris || !rightEyeInner || !rightEyeOuter || !rightIris) {
    if (bestBlendshape && bestBlendshape.score >= GAZE_BLENDSHAPE_THRESHOLD) {
      return {
        away: true,
        direction: bestBlendshape.direction,
        confidence: bestBlendshape.score,
        source: 'blendshape' as const,
        headPoseCompensated: false,
        uncompensatedX: 0,
        uncompensatedY: 0,
        compensatedX: 0,
        compensatedY: 0,
        upBlendshape: Math.min(upLeft, upRight),
        downBlendshape: Math.min(downLeft, downRight),
        verticalWorld: Math.min(downLeft, downRight) - Math.min(upLeft, upRight),
        yawDelta: headPoseDeviation?.yaw ?? 0,
        pitchDelta: headPoseDeviation?.pitch ?? 0,
      };
    }
    return {
      away: false,
      direction: 'center',
      confidence: 0,
      source: 'geometry' as const,
      headPoseCompensated: false,
      uncompensatedX: 0,
      uncompensatedY: 0,
      compensatedX: 0,
      compensatedY: 0,
      upBlendshape: Math.min(upLeft, upRight),
      downBlendshape: Math.min(downLeft, downRight),
      verticalWorld: Math.min(downLeft, downRight) - Math.min(upLeft, upRight),
      yawDelta: headPoseDeviation?.yaw ?? 0,
      pitchDelta: headPoseDeviation?.pitch ?? 0,
    };
  }

  // ── Horizontal gaze (unchanged): iris-in-socket offsetX vs the calibrated threshold ───────────
  // The eye corners are rigid under head rotation, so offsetX is a clean horizontal-gaze signal.
  const leftW  = Math.max(Math.abs(leftEyeOuter.x  - leftEyeInner.x),  0.0001);
  const rightW = Math.max(Math.abs(rightEyeOuter.x - rightEyeInner.x), 0.0001);
  const leftMidX  = (leftEyeOuter.x  + leftEyeInner.x)  / 2;
  const rightMidX = (rightEyeOuter.x + rightEyeInner.x) / 2;
  const rawOffsetX = ((leftIris.x - leftMidX) / (leftW / 2) + (rightIris.x - rightMidX) / (rightW / 2)) / 2;

  // Subtract the calibrated neutral so eyes-forward is 0. Thresholds are sanitized by
  // eightDotCalibrationGuardV3; do not expand them here (fake calibration must not widen the zone).
  const adjOffsetX = rawOffsetX - neutralX;
  const effectiveThresholdX = thresholdX;

  // Optional exponential smoothing on the horizontal offset to reduce jitter (vertical uses the band).
  let useX = adjOffsetX;
  if (filterRef) {
    const f = filterRef.current;
    if (!f.initialized) {
      f.x = adjOffsetX;
      f.initialized = true;
      useX = adjOffsetX;
    } else {
      f.x = f.x * (1 - smoothingAlpha) + adjOffsetX * smoothingAlpha; // low-pass
      useX = f.x;
    }
  }

  const uncompensatedX = useX;
  const compensatedX = headPoseDeviation
    ? compensateGazeWithHeadPose(uncompensatedX, headPoseDeviation.yaw, HEAD_YAW_TO_GAZE_X_FACTOR)
    : uncompensatedX;
  const headPoseCompensated = Math.abs(compensatedX - uncompensatedX) > 0.0001;
  useX = compensatedX;

  const horizontalGazeAway = Math.abs(useX) >= effectiveThresholdX;
  const horizontalDir: 'left' | 'right' = useX > 0 ? 'left' : 'right';
  const horizontalStrength = Math.abs(useX) / Math.max(effectiveThresholdX, 0.0001);

  // ── Vertical gaze: ONE world-vertical signal vs the personalised band (see gazeVerticalMath) ───
  // v = (eyeLookDown − eyeLookUp) folded with the deterministic head pitch (chin-down positive), so
  // a chin-up hold subtracts (kills the old false "down"), a chin-down look-down adds (catches it),
  // and the on-screen range is bounded by the per-person band with no sign assumptions.
  const upBlendshapeScore = Math.min(upLeft, upRight);
  const downBlendshapeScore = Math.min(downLeft, downRight);
  const eyeInHeadVertical = downBlendshapeScore - upBlendshapeScore;
  const vertical = classifyVertical({
    eyeInHeadV: eyeInHeadVertical,
    gazePitchDeltaDeg,
    vBandTop,
    vBandBottom,
    downBlend: downBlendshapeScore,
    upBlend: upBlendshapeScore,
  });

  // Combine into one direction (stronger axis wins, slight horizontal bias). Firing is the OR.
  const combined = combineGazeDirection({
    horizontalAway: horizontalGazeAway,
    horizontalDir,
    horizontalStrength,
    vertical,
  });
  const verticalIsDir = combined.direction === 'up' || combined.direction === 'down';

  return {
    away: combined.away,
    direction: combined.direction,
    confidence: Math.max(Math.abs(useX), Math.abs(vertical.worldVertical)),
    source: (verticalIsDir ? 'blendshape' : 'geometry') as 'geometry' | 'blendshape',
    headPoseCompensated,
    uncompensatedX,
    uncompensatedY: 0,
    compensatedX: useX,
    compensatedY: 0,
    upBlendshape: upBlendshapeScore,
    downBlendshape: downBlendshapeScore,
    verticalWorld: vertical.worldVertical,
    yawDelta: headPoseDeviation?.yaw ?? 0,
    pitchDelta: gazePitchDeltaDeg,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Camera / fullscreen helpers (vendor-prefixed, SSR-safe)
// ─────────────────────────────────────────────────────────────────────────────

/** First video track of a stream, or null. */
function getVideoTrack(stream: MediaStream | null | undefined): MediaStreamTrack | null {
  return stream?.getVideoTracks?.()[0] ?? null;
}

/**
 * Return a human-readable reason the camera feed is unhealthy (track ended/muted/
 * disabled, element detached, no frames yet, zero dimensions), or null when the feed
 * is fully live. Drives CAMERA_OFF detection — a candidate covering/killing the camera.
 */
function getCameraHealthIssue(video: HTMLVideoElement | null, stream: MediaStream | null | undefined) {
  const track = getVideoTrack(stream);

  if (!stream) return 'Camera stream is not available';
  if (!stream.active) return 'Camera stream is inactive';
  if (!track) return 'No video track found in camera stream';
  if (track.readyState !== 'live') return `Video track is ${track.readyState}`;
  if (!track.enabled) return 'Video track is disabled';
  if (track.muted) return 'Video track is muted or unavailable';
  if (!video) return 'Video element is unavailable';
  if (video.srcObject !== stream) return 'Video element is not connected to the active camera stream';
  if (video.ended) return 'Video element has ended';
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return 'Camera is not sending video frames';
  if (video.videoWidth <= 0 || video.videoHeight <= 0) return 'Camera video dimensions are unavailable';

  return null;
}

/** Current fullscreen element across standard + webkit/ms prefixes, or null. */
function getFullscreenElement() {
  if (typeof document === 'undefined') return null;
  const doc = document as Document & {
    webkitFullscreenElement?: Element | null;
    msFullscreenElement?: Element | null;
  };

  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? doc.msFullscreenElement ?? null;
}

/** True when the browser both allows fullscreen and exposes a requestFullscreen method. */
function isFullscreenSupported() {
  if (typeof document === 'undefined') return false;
  const doc = document as Document & {
    webkitFullscreenEnabled?: boolean;
    msFullscreenEnabled?: boolean;
  };
  const element = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
    msRequestFullscreen?: () => Promise<void> | void;
  };

  const fullscreenEnabled = document.fullscreenEnabled ?? doc.webkitFullscreenEnabled ?? doc.msFullscreenEnabled ?? false;
  const requestFullscreen = element.requestFullscreen ?? element.webkitRequestFullscreen ?? element.msRequestFullscreen;

  return Boolean(fullscreenEnabled && requestFullscreen);
}

/** The documentElement's requestFullscreen method across vendor prefixes, or null. */
function getRequestFullscreen() {
  if (typeof document === 'undefined') return null;
  const element = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
    msRequestFullscreen?: () => Promise<void> | void;
  };

  return element.requestFullscreen ?? element.webkitRequestFullscreen ?? element.msRequestFullscreen ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main useProctoring hook
// Owns the camera + MediaPipe models, the per-frame detection loop, all the
// browser-integrity event listeners (tab switch, fullscreen, clipboard, screen
// share, camera health), the violation screen recorder, and the running
// proctoring-score counters. Streams events to the interview WebSocket via emit()
// and returns live state plus the pre-interview permission/fullscreen flow.
// ─────────────────────────────────────────────────────────────────────────────

export function useProctoring(sessionId: string, socket?: WebSocket | null, calibration?: CalibrationResult | null, proctoringEnabled: boolean = true) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [events, setEvents] = useState<ProctoringEvent[]>([]);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [state, setState] = useState<DetectionState>({
    initialized: false,
    status: 'Initializing camera...',
    permissionDenied: false,
    cameraActive: false,
    faceDetectorActive: false,
    objectDetectorActive: false,
    faceCount: 0,
    phoneDetected: false,
    phoneProximity: 'far',
    phoneOrientation: 'unknown',
    foreignObjectDetected: false,
    foreignObjectLabel: '',
    gazeAwayDetected: false,
    gazeDirection: 'center',
    headMovementDetected: false,
    headPoseDeviationDegrees: 0,
    tabSwitchDetected: false,
    tabSwitchReason: null,
    lastTabSwitchAt: null,
    lastTabSwitchDurationMs: null,
    activeTabSwitchDurationMs: 0,
    totalTabSwitchDurationMs: 0,
    tabSwitchCount: 0,
    fullscreenActive: false,
    fullscreenExitDetected: false,
    fullscreenExitReason: null,
    lastFullscreenExitAt: null,
    fullscreenSupported: typeof document === 'undefined' ? true : isFullscreenSupported(),
    fullscreenReadyBeforeInterview: false,
    fullscreenPromptRequired: typeof document === 'undefined' ? false : isFullscreenSupported(),
    preInterviewFullscreenRequestedAt: null,
    preInterviewFullscreenEnteredAt: null,
    microphoneSupported: typeof navigator === 'undefined' ? true : isMicrophoneCaptureSupported(),
    microphoneReadyBeforeInterview: false,
    microphonePromptRequired: true,
    preInterviewMicrophoneRequestedAt: null,
    preInterviewMicrophoneGrantedAt: null,
    screenShareSupported: typeof navigator === 'undefined' ? true : isScreenShareRecordingSupported(),
    screenShareReadyBeforeInterview: false,
    screenSharePromptRequired: true,
    preInterviewScreenShareRequestedAt: null,
    preInterviewScreenShareGrantedAt: null,
    lastObservationAt: null,
  });
  const [violationRecordings, setViolationRecordings] = useState<ViolationRecordingClip[]>([]);
  const [finalProctoringScore, setFinalProctoringScore] = useState<ProctoringScore | null>(null);
  const [proctoringSessionEnded, setProctoringSessionEnded] = useState(false);
  const violationRecordingErrorAlertAt = useRef<number>(0);
  const missingSince = useRef<number | null>(null);
  const faceAlertAt = useRef<number>(0);
  const phoneAlertAt = useRef<number>(0);
  const foreignObjectAlertAt = useRef<number>(0);
  const gazeAlertAt = useRef<number>(0);
  const headPoseAlertAt = useRef<number>(0);
  const cameraOffAlertAt = useRef<number>(0);
  const tabSwitchAlertAt = useRef<number>(0);
  const copyShortcutAlertAt = useRef<number>(0);
  const pasteShortcutAlertAt = useRef<number>(0);
  const multiFaceAlertAt = useRef<number>(0);
  const multiFaceSince = useRef<number | null>(null);
  const gazeSince = useRef<number | null>(null);
  const headPoseSince = useRef<number | null>(null);
  const cameraOffSince = useRef<number | null>(null);
  const cameraOffIncidentActive = useRef(false);
  const cameraOffConfirmTimerRef = useRef<number | null>(null);
  const tabSwitchSince = useRef<number | null>(null);
  const tabSwitchIncidentActive = useRef(false);
  const tabSwitchReasonRef = useRef<string | null>(null);
  const tabSwitchDurationTimerRef = useRef<number | null>(null);
  const tabSwitchConfirmTimerRef = useRef<number | null>(null);
  const fullscreenAlertAt = useRef<number>(0);
  const fullscreenExitSince = useRef<number | null>(null);
  const fullscreenIncidentActive = useRef(false);
  const fullscreenEverEnteredRef = useRef(false);
  const fullscreenRequestInFlightRef = useRef(false);
  const screenShareGrantedRef = useRef(false);
  const screenShareRequestInFlightRef = useRef(false);
  const fullscreenExitReasonRef = useRef<string | null>(null);
  // Synchronous lifecycle guard for global gesture handlers. React state updates
  // after endProctoringSession are asynchronous, so the ref prevents even a click
  // in that short window from being mistaken for pre-interview setup.
  const proctoringSessionEndedRef = useRef(false);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const objectDetectorRef = useRef<ObjectDetector | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameTimerRef = useRef<number | null>(null);
  const aliveRef = useRef(true);
  const safeCalibrationRef = useRef<SafeEightDotCalibration>(buildSafeEightDotCalibration(calibration));
  const gazeFilterRef = useRef<{ x: number; y: number; initialized: boolean }>({ x: 0, y: 0, initialized: false });
  const phoneStateRef = useRef<PhoneState>(createPhoneState());
  const foreignObjectStateRef = useRef<ForeignObjectState>(createForeignObjectState());
  const headPoseBaselineRef = useRef<HeadPose | null>(null);
  // Baseline for the vertical gaze pitch (deterministic nose-vs-eye, chin-down positive). Seeded from
  // calibration.headPitchDeg when available so live world-vertical shares the band's frame; otherwise
  // from the first live face frame. Distinct from headPoseBaselineRef (matrix pose for head-movement).
  const gazePitchBaselineRef = useRef<number | null>(null);
  const proctoringDataRef = useRef<ProctoringData>(createInitialProctoringData());
  const prevFaceCountRef = useRef<number>(1);
  const sessionStartedRef = useRef(false);

  useEffect(() => {
    sessionStartedRef.current = sessionStarted;
  }, [sessionStarted]);

  useEffect(() => {
    safeCalibrationRef.current = buildSafeEightDotCalibration(calibration);
    gazeFilterRef.current = { x: 0, y: 0, initialized: false };
    headPoseBaselineRef.current = null;
    gazePitchBaselineRef.current = null;
    headPoseSince.current = null;
  }, [calibration]);

  /** Send one proctoring event to the interview WebSocket and prepend it to the local
   *  ring buffer (last 10). No-ops until the session has actually started. */
  const emit = useCallback((eventType: string, severity: Severity, metadata: Record<string, unknown> = {}) => {
    if (!sessionStartedRef.current) return;

    const now = Date.now();
    const payload: ProctoringPayload = { type: 'proctoring_event', sessionId, eventType, severity, metadata, timestamp: now };
    socket?.readyState === 1 && socket.send(JSON.stringify(payload));
    setEvents((current) => [{ eventType, severity, timestamp: now, metadata }, ...current].slice(0, 10));
  }, [sessionId, socket]);

  /** emit() guarded by a per-event-type cooldown ref (ALERT_COOLDOWN_MS) so a sustained
   *  violation doesn't spam identical alerts. Returns whether it actually fired. */
  function emitWithCooldown(ref: { current: number }, eventType: string, severity: Severity, metadata: Record<string, unknown> = {}) {
    const now = Date.now();
    if (now - ref.current < ALERT_COOLDOWN_MS) return false;
    ref.current = now;
    emit(eventType, severity, metadata);
    return true;
  }

  /** Tab-switch alert with its own short cooldown (transitions are already debounced upstream). */
  function emitTabSwitchWithCooldown(metadata: Record<string, unknown> = {}) {
    const now = Date.now();
    if (now - tabSwitchAlertAt.current < TAB_SWITCH_ALERT_COOLDOWN_MS) return false;
    tabSwitchAlertAt.current = now;
    emit('TAB_SWITCH_DETECTED', 'HIGH', metadata);
    return true;
  }

  /** Fullscreen-family alerts sharing one cooldown ref so exit/restore churn stays quiet. */
  function emitFullscreenWithCooldown(eventType: string, severity: Severity, metadata: Record<string, unknown> = {}) {
    const now = Date.now();
    if (now - fullscreenAlertAt.current < FULLSCREEN_ALERT_COOLDOWN_MS) return false;
    fullscreenAlertAt.current = now;
    emit(eventType, severity, metadata);
    return true;
  }


  /** Recorder onClipReady: store the finished clip (last 20) and emit a metadata event.
   *  If the session already ended, revoke the object URL and drop it. */
  const handleViolationRecordingReady = useCallback(
    (clip: ViolationRecordingClip) => {
      if (!sessionStartedRef.current) {
        URL.revokeObjectURL(clip.url);
        return;
      }

      setViolationRecordings((current) => [clip, ...current].slice(0, 20));
      emit('VIOLATION_SCREEN_RECORDING_READY', 'MEDIUM', {
        recordingId: clip.id,
        startedAt: clip.startedAt,
        endedAt: clip.endedAt,
        durationMs: clip.durationMs,
        violationTypes: clip.violationTypes,
        eventCount: clip.events.length,
        mimeType: clip.mimeType,
        sizeBytes: clip.blob.size,
      });
    },
    [emit],
  );

  /** Recorder onError: emit a throttled error event (screen share likely missing). */
  const handleViolationRecordingError = useCallback(
    (error: Error) => {
      const now = Date.now();
      if (now - violationRecordingErrorAlertAt.current < ALERT_COOLDOWN_MS) return;

      violationRecordingErrorAlertAt.current = now;
      emit('VIOLATION_SCREEN_RECORDING_ERROR', 'MEDIUM', {
        message: error.message,
        screenShareRequired: true,
      });
    },
    [emit],
  );

  /** Fired when the candidate ends the screen share mid-interview: count it as a
   *  session-control violation, mark it not-restored, and emit SCREEN_SHARE_STOPPED. */
  const handleScreenShareStopped = useCallback(() => {
    const now = Date.now();
    if (sessionStartedRef.current) {
      proctoringDataRef.current.sessionControl.screenShareStoppedCount += 1;
      proctoringDataRef.current.sessionControl.screenShareStoppedAndNotRestored = true;
    }

    setState((current) => ({
      ...current,
      screenShareReadyBeforeInterview: false,
      screenSharePromptRequired: true,
      lastObservationAt: now,
      status: 'Screen sharing stopped',
    }));

    if (sessionStartedRef.current) {
      emit('SCREEN_SHARE_STOPPED', 'HIGH', {
        reason: 'candidate_stopped_screen_share',
        screenShareRequired: true,
        stoppedAt: now,
      });
    }
  }, [emit]);

  const violationScreenRecorder = useViolationScreenRecorder({
    defaultClipMs: DEFAULT_VIOLATION_SCREEN_CLIP_MS,
    minClipMs: MIN_VIOLATION_SCREEN_CLIP_MS,
    maxClipMs: MAX_VIOLATION_SCREEN_CLIP_MS,
    timesliceMs: VIOLATION_SCREEN_RECORDING_TIMESLICE_MS,
    onClipReady: handleViolationRecordingReady,
    onError: handleViolationRecordingError,
    onScreenShareStopped: handleScreenShareStopped,
  });

  // Mirror the recorder's screen-share permission into the hook's state flags and the
  // synchronous ref the gesture handlers read.
  useEffect(() => {
    const now = Date.now();
    screenShareGrantedRef.current = violationScreenRecorder.hasScreenSharePermission;
    setState((current) => ({
      ...current,
      screenShareSupported: isScreenShareRecordingSupported(),
      screenShareReadyBeforeInterview: violationScreenRecorder.hasScreenSharePermission,
      screenSharePromptRequired: !violationScreenRecorder.hasScreenSharePermission,
      preInterviewScreenShareGrantedAt: violationScreenRecorder.hasScreenSharePermission
        ? current.preInterviewScreenShareGrantedAt ?? now
        : current.preInterviewScreenShareGrantedAt,
    }));
  }, [violationScreenRecorder.hasScreenSharePermission]);

  /**
   * Collapse the raw session counters into the final 0–100 ProctoringScore. Each axis
   * is scored independently (higher = cleaner), hard-capped for severe patterns (long
   * phone streak, ≥10s camera-off, screen share never restored), then blended with fixed
   * weights (tab/phone/session-control weigh most). Also builds the human-readable flags
   * and the risk band. Pure over the counters — safe to call for a live preview.
   */
  function computeProctoringScore(): ProctoringScore {
    const pd = proctoringDataRef.current;

    const gazeScore = pd.gaze.totalFrames > 0
      ? Math.max(0, 100 - (pd.gaze.framesLookingAway / pd.gaze.totalFrames) * 100)
      : 100;

    const faceScore = pd.face.totalFrames > 0
      ? Math.max(0, (pd.face.framesNormal / pd.face.totalFrames) * 100)
      : 100;

    const tabScore = Math.max(0, 100 - pd.tabSwitch.count * 15);

    let phoneScore = pd.phone.totalSeconds > 0
      ? Math.max(0, 100 - (pd.phone.detectedSeconds / pd.phone.totalSeconds) * 100)
      : 100;

    if (pd.phone.maxConsecutiveSeconds >= 5) {
      phoneScore = Math.min(phoneScore, 30);
    }

    const headPoseScore = pd.headPose.totalFrames > 0
      ? Math.max(0, (pd.headPose.framesNormal / pd.headPose.totalFrames) * 100)
      : 100;

    let sessionControlScore = Math.max(
      0,
      100 -
        pd.sessionControl.fullscreenExitCount * 20 -
        pd.sessionControl.screenShareStoppedCount * 35 -
        pd.sessionControl.cameraOffSeconds * 2,
    );

    if (pd.sessionControl.cameraOffMaxConsecutiveSeconds >= 10) {
      sessionControlScore = Math.min(sessionControlScore, 30);
    }

    if (pd.sessionControl.screenShareStoppedAndNotRestored) {
      sessionControlScore = Math.min(sessionControlScore, 20);
    }

    const final = Math.round(
      gazeScore * 0.15 +
      faceScore * 0.15 +
      tabScore * 0.20 +
      phoneScore * 0.20 +
      headPoseScore * 0.10 +
      sessionControlScore * 0.20,
    );

    const flags: string[] = [];
    if (pd.tabSwitch.count > 0) {
      flags.push(`Tab switching detected (${pd.tabSwitch.count}x)`);
    }
    if (pd.face.multipleFaceEvents > 0) {
      flags.push(`Multiple faces detected (${pd.face.multipleFaceEvents} occurrence${pd.face.multipleFaceEvents > 1 ? 's' : ''})`);
    }
    if (pd.phone.events > 0) {
      flags.push(`Phone detected (${pd.phone.events} occurrence${pd.phone.events > 1 ? 's' : ''})`);
    }
    if (pd.face.totalFrames > 0 && pd.face.framesNoFace / pd.face.totalFrames > 0.2) {
      flags.push('Prolonged absence from frame');
    }
    if (pd.headPose.totalFrames > 0 && pd.headPose.framesDeviated / pd.headPose.totalFrames > 0.2) {
      flags.push('Significant head movement detected');
    }
    if (pd.gaze.totalFrames > 0 && pd.gaze.framesLookingAway / pd.gaze.totalFrames > 0.2) {
      flags.push('Frequent gaze-away detected');
    }
    if (pd.sessionControl.fullscreenExitCount > 0) {
      flags.push(`Fullscreen exited (${pd.sessionControl.fullscreenExitCount}x)`);
    }
    if (pd.sessionControl.screenShareStoppedCount > 0) {
      flags.push(`Screen sharing stopped (${pd.sessionControl.screenShareStoppedCount}x)`);
    }
    if (pd.sessionControl.cameraOffIncidentCount > 0) {
      flags.push(`Camera off (${pd.sessionControl.cameraOffIncidentCount} occurrence${pd.sessionControl.cameraOffIncidentCount > 1 ? 's' : ''}, ${Math.round(pd.sessionControl.cameraOffSeconds)}s total)`);
    }

    const band: ProctoringScore['band'] =
      final >= 85 ? 'Clean'
      : final >= 65 ? 'Minor Concerns'
      : final >= 40 ? 'Suspicious'
      : 'High Risk';

    return {
      final,
      gazeScore: Math.round(gazeScore),
      faceScore: Math.round(faceScore),
      tabScore: Math.round(tabScore),
      phoneScore: Math.round(phoneScore),
      headPoseScore: Math.round(headPoseScore),
      sessionControlScore: Math.round(sessionControlScore),
      band,
      flags,
    };
  }

  /** Zero every counter, incident flag, confirmation timer, and detection state field so a
   *  fresh session starts clean. Called at session start. */
  function resetSessionTracking() {
    proctoringDataRef.current = createInitialProctoringData();
    prevFaceCountRef.current = 1;
    setEvents([]);
    setFinalProctoringScore(null);
    proctoringSessionEndedRef.current = false;
    setProctoringSessionEnded(false);
    missingSince.current = null;
    multiFaceSince.current = null;
    gazeSince.current = null;
    headPoseSince.current = null;
    cameraOffSince.current = null;
    cameraOffIncidentActive.current = false;
    tabSwitchSince.current = null;
    tabSwitchIncidentActive.current = false;
    tabSwitchReasonRef.current = null;
    fullscreenExitSince.current = null;
    fullscreenIncidentActive.current = false;
    fullscreenExitReasonRef.current = null;
    phoneStateRef.current = createPhoneState();
    foreignObjectStateRef.current = createForeignObjectState();
    clearTabSwitchDurationTimer();

    setState((current) => ({
      ...current,
      status: current.cameraActive ? 'Proctoring session active' : current.status,
      phoneDetected: false,
      foreignObjectDetected: false,
      foreignObjectLabel: '',
      gazeAwayDetected: false,
      gazeDirection: 'center',
      headMovementDetected: false,
      headPoseDeviationDegrees: 0,
      tabSwitchDetected: false,
      tabSwitchReason: null,
      lastTabSwitchAt: null,
      lastTabSwitchDurationMs: null,
      activeTabSwitchDurationMs: 0,
      totalTabSwitchDurationMs: 0,
      tabSwitchCount: 0,
      fullscreenExitDetected: false,
      fullscreenExitReason: null,
      lastFullscreenExitAt: null,
      lastObservationAt: Date.now(),
    }));
  }

  /** Begin scoring: reset counters, flip the started flag (which un-gates emit()), and
   *  announce PROCTORING_SESSION_STARTED. No-op if already running or already ended. */
  function startProctoringSession() {
    if (sessionStartedRef.current || proctoringSessionEnded) return false;

    resetSessionTracking();
    sessionStartedRef.current = true;
    setSessionStarted(true);
    emit('PROCTORING_SESSION_STARTED', 'MEDIUM', { startedAt: Date.now() });
    return true;
  }

  /** Tear down all live resources: stop the frame loop, recorder, screen share, camera
   *  tracks, and MediaPipe models, and clear every incident timer/flag. Best-effort. */
  function stopLiveProctoringResources() {
    aliveRef.current = false;

    if (frameTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(frameTimerRef.current);
      frameTimerRef.current = null;
    }

    clearTabSwitchDurationTimer();

    try {
      violationScreenRecorder.stopViolationRecording();
    } catch {
      // Best-effort cleanup only. Do not block score display if the recorder is already stopped.
    }

    try {
      violationScreenRecorder.stopScreenShare();
    } catch {
      // Best-effort cleanup only. Screen sharing may already be stopped by the browser/user.
    }

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    faceLandmarkerRef.current?.close();
    objectDetectorRef.current?.close();
    faceLandmarkerRef.current = null;
    objectDetectorRef.current = null;

    cameraOffSince.current = null;
    cameraOffIncidentActive.current = false;
    if (cameraOffConfirmTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(cameraOffConfirmTimerRef.current);
      cameraOffConfirmTimerRef.current = null;
    }
    tabSwitchSince.current = null;
    tabSwitchIncidentActive.current = false;
    tabSwitchReasonRef.current = null;
    fullscreenExitSince.current = null;
    fullscreenIncidentActive.current = false;
    fullscreenExitReasonRef.current = null;
    fullscreenRequestInFlightRef.current = false;
    screenShareRequestInFlightRef.current = false;
    screenShareGrantedRef.current = false;
  }

  /** Freeze the score, stop all live resources, emit PROCTORING_SCORE_FINALIZED, and
   *  return the final score. This is the End-Interview entry point. */
  function endProctoringSession(): ProctoringScore {
    const score = computeProctoringScore();
    const endedAt = Date.now();

    setFinalProctoringScore(score);
    proctoringSessionEndedRef.current = true;
    setProctoringSessionEnded(true);
    stopLiveProctoringResources();

    emit('PROCTORING_SCORE_FINALIZED', 'MEDIUM', {
      endedAt,
      final: score.final,
      band: score.band,
      gazeScore: score.gazeScore,
      faceScore: score.faceScore,
      tabScore: score.tabScore,
      phoneScore: score.phoneScore,
      headPoseScore: score.headPoseScore,
      sessionControlScore: score.sessionControlScore,
      flags: score.flags,
    });

    sessionStartedRef.current = false;
    setSessionStarted(false);
    setState((current) => ({
      ...current,
      status: 'Session ended. Final proctoring score ready.',
      cameraActive: false,
      faceDetectorActive: false,
      objectDetectorActive: false,
      phoneDetected: false,
      phoneProximity: 'far',
      phoneOrientation: 'unknown',
      foreignObjectDetected: false,
      foreignObjectLabel: '',
      gazeAwayDetected: false,
      gazeDirection: 'center',
      headMovementDetected: false,
      headPoseDeviationDegrees: 0,
      screenShareReadyBeforeInterview: false,
      screenSharePromptRequired: current.screenShareSupported,
      lastObservationAt: endedAt,
    }));

    return score;
  }

  /** Put the exam into fullscreen (must be called from a user gesture). Handles the
   *  unsupported/already-fullscreen/needs-request cases and keeps the state flags in sync;
   *  emits FULLSCREEN_UNAVAILABLE / _REQUEST_FAILED on failure. */
  async function requestExamFullscreen(trigger = 'manual') {
    if (typeof window === 'undefined' || typeof document === 'undefined') return false;

    const supported = isFullscreenSupported();
    const now = Date.now();
    setState((current) => ({
      ...current,
      fullscreenSupported: supported,
      fullscreenPromptRequired: supported && !Boolean(getFullscreenElement()),
      lastObservationAt: now,
    }));

    if (!supported) {
      emitFullscreenWithCooldown('FULLSCREEN_UNAVAILABLE', 'HIGH', {
        trigger,
        reason: 'fullscreen_api_unavailable_or_disabled',
      });
      setState((current) => ({
        ...current,
        fullscreenActive: false,
        fullscreenExitDetected: true,
        fullscreenExitReason: 'fullscreen_api_unavailable_or_disabled',
        lastFullscreenExitAt: now,
        fullscreenSupported: false,
        fullscreenReadyBeforeInterview: false,
        fullscreenPromptRequired: false,
        lastObservationAt: now,
        status: 'Fullscreen unavailable',
      }));
      return false;
    }

    if (getFullscreenElement()) {
      fullscreenEverEnteredRef.current = true;
      setState((current) => ({
        ...current,
        fullscreenActive: true,
        fullscreenExitDetected: false,
        fullscreenExitReason: null,
        fullscreenSupported: true,
        fullscreenReadyBeforeInterview: true,
        fullscreenPromptRequired: false,
        preInterviewFullscreenEnteredAt: current.preInterviewFullscreenEnteredAt ?? now,
        lastObservationAt: now,
        status: current.tabSwitchDetected ? 'Tab/window switch detected' : 'Fullscreen ready',
      }));
      return true;
    }

    if (fullscreenRequestInFlightRef.current) return false;

    const requestFullscreen = getRequestFullscreen();
    if (!requestFullscreen) return false;

    fullscreenRequestInFlightRef.current = true;
    try {
      const result = requestFullscreen.call(document.documentElement);
      if (result && typeof (result as Promise<void>).then === 'function') {
        await result;
      }
      fullscreenEverEnteredRef.current = true;
      setState((current) => ({
        ...current,
        fullscreenActive: true,
        fullscreenExitDetected: false,
        fullscreenExitReason: null,
        fullscreenSupported: true,
        fullscreenReadyBeforeInterview: true,
        fullscreenPromptRequired: false,
        preInterviewFullscreenEnteredAt: current.preInterviewFullscreenEnteredAt ?? Date.now(),
        lastObservationAt: Date.now(),
        status: current.tabSwitchDetected ? 'Tab/window switch detected' : 'Fullscreen ready',
      }));
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Fullscreen request failed';
      emitFullscreenWithCooldown('FULLSCREEN_REQUEST_FAILED', 'MEDIUM', {
        trigger,
        message,
        // Most browsers reject fullscreen requests that are not started by a user gesture.
        userGestureRequired: true,
      });
      setState((current) => ({
        ...current,
        fullscreenActive: Boolean(getFullscreenElement()),
        fullscreenSupported: true,
        fullscreenReadyBeforeInterview: Boolean(getFullscreenElement()),
        fullscreenPromptRequired: !Boolean(getFullscreenElement()),
        lastObservationAt: Date.now(),
        status: current.fullscreenExitDetected
          ? 'Fullscreen exited'
          : current.tabSwitchDetected
            ? 'Tab/window switch detected'
            : 'Click to enable fullscreen',
      }));
      return false;
    } finally {
      fullscreenRequestInFlightRef.current = false;
    }
  }

  /** Pre-interview gate: ensure a whole-screen share is granted (reusing an existing one),
   *  syncing the readiness flags and emitting CONFIRMED/FAILED. Returns whether share is ready. */
  async function requestScreenShareBeforeInterview(trigger = 'pre_interview_start_button') {
    const supported = isScreenShareRecordingSupported();
    const now = Date.now();
    const alreadyGranted = screenShareGrantedRef.current || violationScreenRecorder.hasScreenSharePermission;

    setState((current) => ({
      ...current,
      screenShareSupported: supported,
      screenSharePromptRequired: supported && !alreadyGranted,
      preInterviewScreenShareRequestedAt: current.preInterviewScreenShareRequestedAt ?? now,
      status: alreadyGranted
        ? current.status
        : supported
          ? 'Please share your screen to start the interview'
          : 'Screen recording unavailable',
      lastObservationAt: now,
    }));

    if (!supported) {
      emit('PRE_INTERVIEW_SCREEN_SHARE_UNAVAILABLE', 'HIGH', {
        trigger,
        reason: 'screen_recording_api_unavailable_or_disabled',
      });
      return false;
    }

    if (alreadyGranted) {
      setState((current) => ({
        ...current,
        screenShareSupported: true,
        screenShareReadyBeforeInterview: true,
        screenSharePromptRequired: false,
        preInterviewScreenShareGrantedAt: current.preInterviewScreenShareGrantedAt ?? now,
        lastObservationAt: now,
      }));
      return true;
    }

    if (screenShareRequestInFlightRef.current) {
      return false;
    }

    screenShareRequestInFlightRef.current = true;
    try {
      const granted = await violationScreenRecorder.requestScreenShare();
      const completedAt = Date.now();
      screenShareGrantedRef.current = granted;
      if (granted) {
        proctoringDataRef.current.sessionControl.screenShareStoppedAndNotRestored = false;
      }

      setState((current) => ({
        ...current,
        screenShareSupported: true,
        screenShareReadyBeforeInterview: granted,
        screenSharePromptRequired: !granted,
        preInterviewScreenShareGrantedAt: granted ? completedAt : current.preInterviewScreenShareGrantedAt,
        lastObservationAt: completedAt,
        status: granted
          ? current.fullscreenActive
            ? 'Screen sharing and fullscreen ready. You can start the interview.'
            : 'Screen sharing ready. Please enter fullscreen.'
          : 'Please share your screen before starting the interview',
      }));

      emit(granted ? 'PRE_INTERVIEW_SCREEN_SHARE_CONFIRMED' : 'PRE_INTERVIEW_SCREEN_SHARE_FAILED', granted ? 'MEDIUM' : 'HIGH', {
        trigger,
        requestedAt: now,
        completedAt,
        screenShareRequired: true,
        error: granted ? undefined : violationScreenRecorder.screenShareError,
      });

      return granted;
    } finally {
      screenShareRequestInFlightRef.current = false;
    }
  }

  /** Full pre-interview readiness step: require screen share FIRST, then enter fullscreen.
   *  Returns true only when both are satisfied — the gate the Start button waits on. */
  async function enterFullscreenBeforeInterview(trigger = 'pre_interview_fullscreen_button') {
    const screenShareReady = await requestScreenShareBeforeInterview(trigger);
    if (!screenShareReady) return false;

    const now = Date.now();
    setState((current) => ({
      ...current,
      preInterviewFullscreenRequestedAt: now,
      fullscreenPromptRequired: !Boolean(getFullscreenElement()) && isFullscreenSupported(),
      status: Boolean(getFullscreenElement()) ? 'Fullscreen ready' : 'Entering fullscreen...',
      lastObservationAt: now,
    }));

    const entered = await requestExamFullscreen(trigger);
    const active = Boolean(getFullscreenElement());
    const enteredAt = Date.now();

    setState((current) => ({
      ...current,
      fullscreenActive: active,
      fullscreenReadyBeforeInterview: entered && active,
      fullscreenPromptRequired: !active && isFullscreenSupported(),
      preInterviewFullscreenEnteredAt: entered && active ? enteredAt : current.preInterviewFullscreenEnteredAt,
      lastObservationAt: enteredAt,
      status: entered && active
        ? 'Fullscreen ready. You can start the interview.'
        : current.fullscreenExitDetected
          ? 'Fullscreen exited'
          : 'Please enter fullscreen before starting the interview',
    }));

    if (entered && active) {
      emit('PRE_INTERVIEW_FULLSCREEN_CONFIRMED', 'MEDIUM', {
        trigger,
        requestedAt: now,
        enteredAt,
      });
    }

    return entered && active;
  }

  /** Alias used by the Start-Interview button; runs the share+fullscreen readiness flow. */
  async function prepareInterviewStart() {
    return enterFullscreenBeforeInterview('start_interview_button');
  }

  /** Clear the tab-away duration interval plus the pending tab-switch and camera-off confirm timers. */
  function clearTabSwitchDurationTimer() {
    if (tabSwitchDurationTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearInterval(tabSwitchDurationTimerRef.current);
      tabSwitchDurationTimerRef.current = null;
    }
    if (tabSwitchConfirmTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(tabSwitchConfirmTimerRef.current);
      tabSwitchConfirmTimerRef.current = null;
    }

    if (cameraOffConfirmTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(cameraOffConfirmTimerRef.current);
      cameraOffConfirmTimerRef.current = null;
    }
  }

  /** While the candidate is away from the tab, tick the live away-duration into state once
   *  per second for the UI. Single-instance guarded. */
  function startTabSwitchDurationTimer() {
    if (!sessionStartedRef.current || typeof window === 'undefined' || tabSwitchDurationTimerRef.current !== null) return;

    tabSwitchDurationTimerRef.current = window.setInterval(() => {
      if (!sessionStartedRef.current) return;
      const startedAt = tabSwitchSince.current;
      if (!startedAt) return;

      const activeDurationMs = Date.now() - startedAt;
      setState((current) => ({
        ...current,
        activeTabSwitchDurationMs: activeDurationMs,
        lastObservationAt: Date.now(),
      }));
    }, 1000);
  }

  // Clipboard-shortcut watcher: capture-phase keydown catches Ctrl/Cmd+C / +V anywhere,
  // emits COPY/PASTE alerts (paste is HIGH — pasted answers) and records a violation clip.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const handleClipboardShortcut = (event: KeyboardEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || event.altKey || event.repeat) return;

      const key = event.key.toLowerCase();
      if (key !== 'c' && key !== 'v') return;

      const now = Date.now();
      const alertAt = key === 'c' ? copyShortcutAlertAt : pasteShortcutAlertAt;
      if (now - alertAt.current < CLIPBOARD_SHORTCUT_ALERT_COOLDOWN_MS) return;
      alertAt.current = now;

      const target = event.target instanceof HTMLElement ? event.target : null;
      const metadata = {
        shortcut: `${event.metaKey ? 'Meta' : 'Ctrl'}+${key.toUpperCase()}`,
        key: key.toUpperCase(),
        targetTag: target?.tagName?.toLowerCase() ?? 'unknown',
        targetType: target instanceof HTMLInputElement ? target.type : undefined,
        targetEditable: Boolean(
          target?.isContentEditable
          || target instanceof HTMLInputElement
          || target instanceof HTMLTextAreaElement,
        ),
      };

      if (key === 'c') {
        emit('COPY_SHORTCUT_DETECTED', 'MEDIUM', metadata);
        violationScreenRecorder.recordViolationClip('COPY_SHORTCUT', metadata);
      } else {
        emit('PASTE_SHORTCUT_DETECTED', 'HIGH', metadata);
        violationScreenRecorder.recordViolationClip('PASTE_SHORTCUT', metadata);
      }
    };

    window.addEventListener('keydown', handleClipboardShortcut, true);

    return () => {
      window.removeEventListener('keydown', handleClipboardShortcut, true);
    };
  }, [emit, violationScreenRecorder.recordViolationClip]);

  // Tab/window-switch watcher. visibilitychange/blur/focus/pagehide/pageshow are folded
  // into markTabAway/markTabReturned. An away requires a TAB_SWITCH_CONFIRM_MS confirmation
  // window before it counts (transient blurs are ignored), the away duration is ticked live,
  // and return closes the incident with a TAB_RETURNED event and stops the clip.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const getTabAwayReason = (trigger: string) => {
      if (document.visibilityState === 'hidden') return 'document_hidden';
      if (!document.hasFocus()) return trigger === 'blur' ? 'window_blur' : 'window_not_focused';
      return null;
    };

    const markTabAway = (trigger: string) => {
      if (!sessionStartedRef.current) return;

      const reason = getTabAwayReason(trigger);
      if (!reason) return;

      const now = Date.now();
      if (!tabSwitchSince.current) tabSwitchSince.current = now;
      tabSwitchReasonRef.current = reason;
      startTabSwitchDurationTimer();

      setState((current) => ({
        ...current,
        tabSwitchDetected: true,
        tabSwitchReason: reason,
        lastTabSwitchAt: now,
        activeTabSwitchDurationMs: tabSwitchSince.current ? now - tabSwitchSince.current : 0,
        lastObservationAt: now,
        status: current.fullscreenExitDetected ? 'Fullscreen exited' : 'Tab/window switch detected',
      }));

      // Do not treat the initial mount as a real tab switch event.
      if (trigger === 'mount') return;

      // Require a short confirmation window before treating transient focus/blur as a tab switch.
      if (tabSwitchConfirmTimerRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(tabSwitchConfirmTimerRef.current);
        tabSwitchConfirmTimerRef.current = null;
      }

      tabSwitchConfirmTimerRef.current = typeof window !== 'undefined'
        ? window.setTimeout(() => {
          if (!sessionStartedRef.current) {
            tabSwitchConfirmTimerRef.current = null;
            return;
          }

          if (!tabSwitchIncidentActive.current) {
            tabSwitchIncidentActive.current = true;
            proctoringDataRef.current.tabSwitch.count += 1;
            const metadata = {
              reason,
              trigger,
              startedAt: tabSwitchSince.current,
              activeDurationMs: tabSwitchSince.current ? Date.now() - (tabSwitchSince.current as number) : 0,
              visibilityState: document.visibilityState,
              documentHidden: document.hidden,
              hasFocus: document.hasFocus(),
            };

            if (emitTabSwitchWithCooldown(metadata)) {
              violationScreenRecorder.startViolationRecording('TAB_SWITCH', metadata);
            }
          }
          tabSwitchConfirmTimerRef.current = null;
        }, TAB_SWITCH_CONFIRM_MS)
        : null;
    };

    const markTabReturned = (trigger: string) => {
      if (!sessionStartedRef.current) {
        tabSwitchSince.current = null;
        tabSwitchIncidentActive.current = false;
        tabSwitchReasonRef.current = null;
        clearTabSwitchDurationTimer();
        return;
      }

      if (getTabAwayReason(trigger)) return;

      // If a confirmation timer was pending (transient blur), cancel it and do not record an incident.
      if (tabSwitchConfirmTimerRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(tabSwitchConfirmTimerRef.current);
        tabSwitchConfirmTimerRef.current = null;
      }

      if (!tabSwitchIncidentActive.current) return;

      const now = Date.now();
      const startedAt = tabSwitchSince.current;
      const durationMs = startedAt ? now - startedAt : 0;
      const durationSeconds = Math.round((durationMs / 1000) * 10) / 10;
      const reason = tabSwitchReasonRef.current;

      clearTabSwitchDurationTimer();

      emit('TAB_RETURNED', 'MEDIUM', {
        reason,
        trigger,
        startedAt,
        returnedAt: now,
        durationMs,
        durationSeconds,
        visibilityState: document.visibilityState,
        documentHidden: document.hidden,
        hasFocus: document.hasFocus(),
      });
      violationScreenRecorder.stopViolationRecording();

      tabSwitchSince.current = null;
      tabSwitchIncidentActive.current = false;
      tabSwitchReasonRef.current = null;

      setState((current) => ({
        ...current,
        tabSwitchDetected: false,
        tabSwitchReason: null,
        lastTabSwitchDurationMs: durationMs,
        activeTabSwitchDurationMs: 0,
        totalTabSwitchDurationMs: current.totalTabSwitchDurationMs + durationMs,
        tabSwitchCount: current.tabSwitchCount + 1,
        lastObservationAt: now,
        status: current.fullscreenExitDetected
          ? 'Fullscreen exited'
          : current.cameraActive
            ? 'Detection active'
            : current.status,
      }));
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        markTabAway('visibilitychange');
      } else {
        markTabReturned('visibilitychange');
      }
    };

    const handleBlur = () => markTabAway('blur');
    const handleFocus = () => markTabReturned('focus');
    const handlePageHide = () => markTabAway('pagehide');
    const handlePageShow = () => markTabReturned('pageshow');

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
      tabSwitchSince.current = null;
      tabSwitchIncidentActive.current = false;
      tabSwitchReasonRef.current = null;
      clearTabSwitchDurationTimer();
    };
  }, [emit, violationScreenRecorder.startViolationRecording, violationScreenRecorder.stopViolationRecording]);

  // Fullscreen watcher + first-gesture permission bootstrap. Tracks enter/exit across
  // vendor-prefixed events and counts each exit as a session-control violation. Before
  // the interview, a user gesture may run the combined share+fullscreen setup. Once the
  // session has started, gestures restore fullscreen only and never reopen the screen
  // picker; screen sharing is an independent, long-lived permission.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    // Consent gate: do not attach fullscreen / screen-share gesture listeners
    // until the candidate has given informed consent. Re-runs when consent flips.
    if (!proctoringEnabled || proctoringSessionEnded) return;

    // Fullscreen (re)entered: close any open exit incident with FULLSCREEN_RESTORED (and stop
    // its clip), else just note FULLSCREEN_ENTERED, and mark readiness.
    const markFullscreenEntered = (trigger: string) => {
      const now = Date.now();
      const durationMs = fullscreenExitSince.current ? now - fullscreenExitSince.current : 0;
      const previousReason = fullscreenExitReasonRef.current;

      fullscreenEverEnteredRef.current = true;
      fullscreenExitSince.current = null;
      fullscreenExitReasonRef.current = null;

      if (fullscreenIncidentActive.current) {
        fullscreenIncidentActive.current = false;
        emit('FULLSCREEN_RESTORED', 'MEDIUM', {
          trigger,
          previousReason,
          durationMs,
        });
        violationScreenRecorder.stopViolationRecording();
      } else {
        emit('FULLSCREEN_ENTERED', 'MEDIUM', { trigger });
      }

      setState((current) => ({
        ...current,
        fullscreenActive: true,
        fullscreenExitDetected: false,
        fullscreenExitReason: null,
        fullscreenSupported: true,
        fullscreenReadyBeforeInterview: true,
        fullscreenPromptRequired: false,
        preInterviewFullscreenEnteredAt: current.preInterviewFullscreenEnteredAt ?? now,
        lastObservationAt: now,
        status: current.tabSwitchDetected ? 'Tab/window switch detected' : 'Fullscreen ready',
      }));
    };

    // Fullscreen exited: ignored before the session or if fullscreen was never entered
    // (initial state); otherwise opens an exit incident (counted once), emits a HIGH alert,
    // and starts a violation clip.
    const markFullscreenExited = (trigger: string, reason = 'fullscreen_exited') => {
      const now = Date.now();
      if (!sessionStartedRef.current) {
        fullscreenExitSince.current = null;
        fullscreenIncidentActive.current = false;
        fullscreenExitReasonRef.current = null;
        setState((current) => ({
          ...current,
          fullscreenActive: false,
          fullscreenExitDetected: false,
          fullscreenExitReason: null,
          fullscreenSupported: isFullscreenSupported(),
          fullscreenReadyBeforeInterview: false,
          fullscreenPromptRequired: isFullscreenSupported(),
          lastObservationAt: now,
        }));
        return;
      }

      const shouldFlag = fullscreenEverEnteredRef.current || fullscreenIncidentActive.current;

      if (!shouldFlag) {
        setState((current) => ({
          ...current,
          fullscreenActive: false,
          fullscreenSupported: isFullscreenSupported(),
          fullscreenReadyBeforeInterview: false,
          fullscreenPromptRequired: isFullscreenSupported(),
          lastObservationAt: now,
        }));
        return;
      }

      if (!fullscreenExitSince.current) fullscreenExitSince.current = now;
      fullscreenExitReasonRef.current = reason;
      const isNewFullscreenIncident = !fullscreenIncidentActive.current;
      fullscreenIncidentActive.current = true;
      if (isNewFullscreenIncident) {
        proctoringDataRef.current.sessionControl.fullscreenExitCount += 1;
      }

      const metadata = {
        trigger,
        reason,
        fullscreenElementPresent: Boolean(getFullscreenElement()),
        visibilityState: document.visibilityState,
        documentHidden: document.hidden,
        hasFocus: document.hasFocus(),
      };

      if (emitFullscreenWithCooldown('FULLSCREEN_EXITED_DETECTED', 'HIGH', metadata)) {
        violationScreenRecorder.startViolationRecording('FULLSCREEN_EXIT', metadata);
      }

      setState((current) => ({
        ...current,
        fullscreenActive: false,
        fullscreenExitDetected: true,
        fullscreenExitReason: reason,
        lastFullscreenExitAt: now,
        fullscreenSupported: isFullscreenSupported(),
        fullscreenReadyBeforeInterview: false,
        fullscreenPromptRequired: isFullscreenSupported(),
        lastObservationAt: now,
        status: 'Fullscreen exited',
      }));
    };

    const handleFullscreenChange = () => {
      if (getFullscreenElement()) {
        markFullscreenEntered('fullscreenchange');
      } else {
        markFullscreenExited('fullscreenchange');
      }
    };

    const handleFullscreenError = () => {
      if (!sessionStartedRef.current) return;
      emitFullscreenWithCooldown('FULLSCREEN_REQUEST_FAILED', 'MEDIUM', {
        trigger: 'fullscreenerror',
        reason: 'browser_fullscreen_error',
      });
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('fullscreenerror', handleFullscreenError);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange as EventListener);
    document.addEventListener('webkitfullscreenerror', handleFullscreenError as EventListener);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange as EventListener);
    document.addEventListener('MSFullscreenError', handleFullscreenError as EventListener);

    setState((current) => ({
      ...current,
      fullscreenActive: Boolean(getFullscreenElement()),
      fullscreenSupported: isFullscreenSupported(),
      fullscreenReadyBeforeInterview: Boolean(getFullscreenElement()),
      fullscreenPromptRequired: !Boolean(getFullscreenElement()) && isFullscreenSupported(),
    }));

    // Fullscreen requests need a user gesture. During an active interview, keep
    // fullscreen recovery completely separate from screen sharing: invoking the
    // combined setup here used to reopen getDisplayMedia() after every exit when
    // the share state was stale for even one render.
    const requestOnUserGesture = () => {
      if (proctoringSessionEndedRef.current) return;

      const fullscreenMissing = !getFullscreenElement();

      if (fullscreenRequestInFlightRef.current || screenShareRequestInFlightRef.current) return;

      if (sessionStartedRef.current) {
        if (fullscreenMissing) {
          void requestExamFullscreen('user_interaction_restore');
        }
        return;
      }

      const screenShareMissing = !screenShareGrantedRef.current && !violationScreenRecorder.hasScreenSharePermission;
      if (screenShareMissing || fullscreenMissing) {
        void enterFullscreenBeforeInterview('user_interaction');
      }
    };

    window.addEventListener('pointerdown', requestOnUserGesture, true);
    window.addEventListener('keydown', requestOnUserGesture, true);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('fullscreenerror', handleFullscreenError);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange as EventListener);
      document.removeEventListener('webkitfullscreenerror', handleFullscreenError as EventListener);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange as EventListener);
      document.removeEventListener('MSFullscreenError', handleFullscreenError as EventListener);
      window.removeEventListener('pointerdown', requestOnUserGesture, true);
      window.removeEventListener('keydown', requestOnUserGesture, true);
      fullscreenExitSince.current = null;
      fullscreenIncidentActive.current = false;
      fullscreenExitReasonRef.current = null;
      fullscreenRequestInFlightRef.current = false;
      screenShareRequestInFlightRef.current = false;
      screenShareGrantedRef.current = false;
    };
  }, [emit, proctoringEnabled, proctoringSessionEnded, violationScreenRecorder.startViolationRecording, violationScreenRecorder.stopViolationRecording]);

  // Main detection loop. Acquires the camera, loads the MediaPipe FaceLandmarker +
  // ObjectDetector, then polls a tick() every LIVE_INTERVAL_MS that runs both models on the
  // current frame and drives face-count / phone / foreign-object / gaze / head-pose detection
  // plus camera-health tracking. Emits alerts (each behind a sustained-confirmation window +
  // cooldown) and updates both the running score counters and the live UI state.
  useEffect(() => {
    // Consent gate: do not acquire the camera or load the face/object models
    // until the candidate has given informed consent. Re-runs when it flips true.
    if (!proctoringEnabled) return;
    aliveRef.current = true;

    async function start() {
      setState((current) => ({
        initialized: false,
        status: current.fullscreenExitDetected
          ? 'Fullscreen exited'
          : current.tabSwitchDetected
            ? 'Tab/window switch detected'
            : 'Requesting camera access...',
        permissionDenied: false,
        cameraActive: false,
        faceDetectorActive: false,
        objectDetectorActive: false,
        faceCount: 0,
        phoneDetected: false,
        phoneProximity: 'far',
        phoneOrientation: 'unknown',
        foreignObjectDetected: false,
        foreignObjectLabel: '',
        gazeAwayDetected: false,
        gazeDirection: 'center',
        headMovementDetected: false,
        headPoseDeviationDegrees: 0,
        tabSwitchDetected: current.tabSwitchDetected,
        tabSwitchReason: current.tabSwitchReason,
        lastTabSwitchAt: current.lastTabSwitchAt,
        lastTabSwitchDurationMs: current.lastTabSwitchDurationMs,
        activeTabSwitchDurationMs: current.activeTabSwitchDurationMs,
        totalTabSwitchDurationMs: current.totalTabSwitchDurationMs,
        tabSwitchCount: current.tabSwitchCount,
        fullscreenActive: current.fullscreenActive,
        fullscreenExitDetected: current.fullscreenExitDetected,
        fullscreenExitReason: current.fullscreenExitReason,
        lastFullscreenExitAt: current.lastFullscreenExitAt,
        fullscreenSupported: current.fullscreenSupported,
        fullscreenReadyBeforeInterview: current.fullscreenReadyBeforeInterview,
        fullscreenPromptRequired: current.fullscreenPromptRequired,
        preInterviewFullscreenRequestedAt: current.preInterviewFullscreenRequestedAt,
        preInterviewFullscreenEnteredAt: current.preInterviewFullscreenEnteredAt,
        microphoneSupported: current.microphoneSupported,
        microphoneReadyBeforeInterview: current.microphoneReadyBeforeInterview,
        microphonePromptRequired: current.microphonePromptRequired,
        preInterviewMicrophoneRequestedAt: current.preInterviewMicrophoneRequestedAt,
        preInterviewMicrophoneGrantedAt: current.preInterviewMicrophoneGrantedAt,
        screenShareSupported: current.screenShareSupported,
        screenShareReadyBeforeInterview: current.screenShareReadyBeforeInterview,
        screenSharePromptRequired: current.screenSharePromptRequired,
        preInterviewScreenShareRequestedAt: current.preInterviewScreenShareRequestedAt,
        preInterviewScreenShareGrantedAt: current.preInterviewScreenShareGrantedAt,
        lastObservationAt: current.lastObservationAt,
      }));

      const requestedAt = Date.now();
      setState((current) => ({
        ...current,
        microphonePromptRequired: false,
        status: 'Requesting camera...',
        lastObservationAt: requestedAt,
      }));


      setFinalProctoringScore(null);
      setProctoringSessionEnded(false);
      proctoringDataRef.current = createInitialProctoringData();
      prevFaceCountRef.current = 1;

      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;

      if (!aliveRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play();
      }

      void requestExamFullscreen('camera_started');

      setState((current) => ({
        ...current,
        initialized: true,
        status: current.fullscreenExitDetected
          ? 'Fullscreen exited'
          : current.tabSwitchDetected
            ? 'Tab/window switch detected'
            : 'Detection active',
        permissionDenied: false,
        cameraActive: true,
        microphoneReadyBeforeInterview: false,
        microphonePromptRequired: false,
      }));

      const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm');
      const [faceLandmarker, objectDetector] = await Promise.all([
        FaceLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: FACE_MODEL_URL },
          runningMode: 'VIDEO',
          numFaces: 4,
          minFaceDetectionConfidence: 0.55,
          minFacePresenceConfidence: 0.55,
          minTrackingConfidence: 0.55,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        }),
        ObjectDetector.createFromOptions(vision, {
          baseOptions: { modelAssetPath: OBJECT_MODEL_URL },
          runningMode: 'VIDEO',
          scoreThreshold: 0.25,
          maxResults: 8,
        }),
      ]);

      faceLandmarkerRef.current = faceLandmarker;
      objectDetectorRef.current = objectDetector;

      setState((current) => ({
        ...current,
        faceDetectorActive: true,
        objectDetectorActive: true,
      }));

      // One detection frame. Self-reschedules via setTimeout(tick, LIVE_INTERVAL_MS). Early
      // branches handle camera-off and not-yet-ready feeds; the main body runs the models,
      // updates counters, refreshes state, then applies each detector's confirm/cooldown gate.
      const tick = () => {
        if (!aliveRef.current) return;
        const currentVideo = videoRef.current;
        const faceTask = faceLandmarkerRef.current;
        const objectTask = objectDetectorRef.current;
        const cameraIssue = getCameraHealthIssue(currentVideo, streamRef.current);
        if (cameraIssue) {
          const now = Date.now();
          if (!sessionStartedRef.current) {
            cameraOffSince.current = null;
            cameraOffIncidentActive.current = false;
            if (cameraOffConfirmTimerRef.current !== null && typeof window !== 'undefined') {
              window.clearTimeout(cameraOffConfirmTimerRef.current);
              cameraOffConfirmTimerRef.current = null;
            }
            setState((current) => ({
              ...current,
              cameraActive: false,
              faceDetectorActive: !!faceTask,
              objectDetectorActive: !!objectTask,
              lastObservationAt: now,
              status: 'Camera is off or not sending video',
            }));
            frameTimerRef.current = window.setTimeout(tick, LIVE_INTERVAL_MS);
            return;
          }

          if (!cameraOffSince.current) cameraOffSince.current = now;

          // If we don't yet have a confirmed incident, start a confirm timer.
          if (!cameraOffIncidentActive.current && cameraOffConfirmTimerRef.current === null && typeof window !== 'undefined') {
            cameraOffConfirmTimerRef.current = window.setTimeout(() => {
              cameraOffConfirmTimerRef.current = null;
              if (!sessionStartedRef.current) return;

              // Mark incident active and capture initial metadata/recording
              const proctoringData = proctoringDataRef.current;
              if (!cameraOffIncidentActive.current) {
                proctoringData.sessionControl.cameraOffIncidentCount += 1;
              }
              cameraOffIncidentActive.current = true;

              const durationMs = Date.now() - (cameraOffSince.current || Date.now());
              const metadata = {
                reason: cameraIssue,
                durationMs,
                trackReadyState: getVideoTrack(streamRef.current)?.readyState,
                trackMuted: getVideoTrack(streamRef.current)?.muted ?? false,
                trackEnabled: getVideoTrack(streamRef.current)?.enabled ?? false,
              };

              if (emitWithCooldown(cameraOffAlertAt, 'CAMERA_OFF_DETECTED', 'HIGH', metadata)) {
                violationScreenRecorder.recordViolationClip('CAMERA_OFF', metadata);
              }
            }, CAMERA_OFF_CONFIRM_MS);
          }

          // If an incident is active, accumulate seconds.
          if (cameraOffIncidentActive.current) {
            const proctoringData = proctoringDataRef.current;
            proctoringData.sessionControl.cameraOffSeconds += LIVE_INTERVAL_MS / 1000;
            proctoringData.sessionControl.cameraOffConsecutiveSeconds += LIVE_INTERVAL_MS / 1000;
            proctoringData.sessionControl.cameraOffMaxConsecutiveSeconds = Math.max(
              proctoringData.sessionControl.cameraOffMaxConsecutiveSeconds,
              proctoringData.sessionControl.cameraOffConsecutiveSeconds,
            );
          }

          missingSince.current = null;
          setState((current) => ({
            ...current,
            cameraActive: false,
            faceDetectorActive: !!faceTask,
            objectDetectorActive: !!objectTask,
            faceCount: 0,
            phoneDetected: false,
            phoneProximity: 'far',
            phoneOrientation: 'unknown',
            foreignObjectDetected: false,
            foreignObjectLabel: '',
            gazeAwayDetected: false,
            gazeDirection: 'center',
            headMovementDetected: false,
            headPoseDeviationDegrees: 0,
            lastObservationAt: now,
            status: 'Camera is off or not sending video',
          }));
          frameTimerRef.current = window.setTimeout(tick, LIVE_INTERVAL_MS);
          return;
        }

        if (cameraOffSince.current !== null) {
          const now = Date.now();
          const durationMs = now - cameraOffSince.current;
          if (cameraOffIncidentActive.current) {
            emit('CAMERA_RESTORED', 'MEDIUM', { durationMs });
          }
          // Clear any pending confirm timer when camera is restored.
          if (cameraOffConfirmTimerRef.current !== null && typeof window !== 'undefined') {
            window.clearTimeout(cameraOffConfirmTimerRef.current);
            cameraOffConfirmTimerRef.current = null;
          }
          cameraOffSince.current = null;
          cameraOffIncidentActive.current = false;
          proctoringDataRef.current.sessionControl.cameraOffConsecutiveSeconds = 0;
        }

        if (!currentVideo || !faceTask || !objectTask || currentVideo.readyState < 2) {
          if (!missingSince.current) missingSince.current = Date.now();
          if (Date.now() - (missingSince.current || 0) > NO_FACE_THRESHOLD_MS) {
            const metadata = { durationMs: Date.now() - (missingSince.current || 0) };
            if (emitWithCooldown(faceAlertAt, 'FACE_NOT_DETECTED', 'HIGH', metadata)) {
              violationScreenRecorder.recordViolationClip('NO_FACE', metadata);
            }
          }
          setState((current) => ({
            ...current,
            cameraActive: !!currentVideo?.srcObject,
            faceDetectorActive: !!faceTask,
            objectDetectorActive: !!objectTask,
            faceCount: 0,
            phoneDetected: false,
            phoneProximity: 'far',
            phoneOrientation: 'unknown',
            foreignObjectDetected: false,
            foreignObjectLabel: '',
            headMovementDetected: false,
            headPoseDeviationDegrees: 0,
            lastObservationAt: Date.now(),
          }));
          frameTimerRef.current = window.setTimeout(tick, LIVE_INTERVAL_MS);
          return;
        }

        missingSince.current = null;
        const timestamp = performance.now();

        let faceResult: FaceLandmarkerResult | null = null;
        let objectResult: ObjectDetectorResult | null = null;

        try {
          if (faceTask && typeof (faceTask as any).detectForVideo === 'function') {
            faceResult = (faceTask as any).detectForVideo(currentVideo, timestamp);
          } else {
            console.warn('Face task not ready or detectForVideo missing');
            setState((current) => ({ ...current, status: 'Face detector unavailable' }));
          }
        } catch (error) {
          console.error('Face detect error', error);
          setState((current) => ({ ...current, status: 'Face detector unavailable' }));
        }

        try {
          if (objectTask && typeof (objectTask as any).detectForVideo === 'function') {
            objectResult = (objectTask as any).detectForVideo(currentVideo, timestamp);
          } else {
            console.warn('Object task not ready or detectForVideo missing');
            setState((current) => ({ ...current, status: 'Object detector unavailable' }));
          }
        } catch (error) {
          console.error('Object detect error', error);
          setState((current) => ({ ...current, status: 'Object detector unavailable' }));
        }

        const faceCount = faceResult?.faceLandmarks?.length || 0;
        const videoWidth = currentVideo.videoWidth || 640;
        const videoHeight = currentVideo.videoHeight || 480;

        const phone = objectResult
          ? analyzePhoneDetection(objectResult, videoWidth, videoHeight, phoneStateRef.current)
          : null;
        const detectedPhone = phone?.detected ?? false;

        const foreignObject = objectResult
          ? analyzeForeignObject(objectResult, videoWidth, videoHeight, foreignObjectStateRef.current)
          : null;
        const detectedForeignObject = foreignObject?.detected ?? false;

        const headPose = faceCount === 1 ? estimateHeadPose(faceResult) : null;
        if (headPose && !headPoseBaselineRef.current) {
          headPoseBaselineRef.current = headPose;
        }
        const headPoseDeviation = headPose && headPoseBaselineRef.current ? calculateHeadPoseDeviation(headPose, headPoseBaselineRef.current) : null;
        const headMovementDetected = Boolean(headPoseDeviation?.tooMuch);

        const safeCalibration = safeCalibrationRef.current;

        // Vertical head-pitch delta vs the baseline (seeded from the calibration pose so the band and
        // the live reading share one frame; else from the first live face frame). Chin-down positive.
        const gazePitchNow = faceCount === 1 ? gazePitchDegLive(faceResult) : null;
        if (gazePitchNow != null && gazePitchBaselineRef.current == null) {
          // Trusted calibration → anchor to the calibration pose (band was measured there). Skipped /
          // default / untrusted calibration → anchor to the first live frame (no real calibration pose).
          gazePitchBaselineRef.current =
            safeCalibration.trusted && safeCalibration.headPitchDeg != null
              ? safeCalibration.headPitchDeg
              : gazePitchNow;
        }
        const gazePitchDelta =
          gazePitchNow != null && gazePitchBaselineRef.current != null
            ? gazePitchNow - gazePitchBaselineRef.current
            : 0;

        const gaze = detectGazeAway(
          faceResult,
          safeCalibration.thresholdX ?? DEFAULT_GAZE_THRESHOLD_X,
          safeCalibration.thresholdY ?? DEFAULT_GAZE_THRESHOLD_Y,
          safeCalibration.neutralX ?? 0,
          safeCalibration.neutralY ?? 0,
          headPoseDeviation,
          gazeFilterRef,
          0.18, // reduced from 0.28 for better filtering of false positives
          safeCalibration.vBandTop ?? DEFAULT_VERTICAL_BAND.vBandTop,
          safeCalibration.vBandBottom ?? DEFAULT_VERTICAL_BAND.vBandBottom,
          gazePitchDelta,
        );

        // Before the session starts we still run the models (to show a live camera preview
        // and keep the loop warm) but must not accumulate counters or fire alerts, so reset
        // all confirmation timers/state and report a neutral "ready" frame.
        if (!sessionStartedRef.current) {
          missingSince.current = null;
          multiFaceSince.current = null;
          gazeSince.current = null;
          headPoseSince.current = null;
          phoneStateRef.current = createPhoneState();
          foreignObjectStateRef.current = createForeignObjectState();
          prevFaceCountRef.current = faceCount;
          setState((current) => ({
            ...current,
            cameraActive: true,
            faceDetectorActive: true,
            objectDetectorActive: true,
            faceCount,
            phoneDetected: false,
            foreignObjectDetected: false,
            foreignObjectLabel: '',
            gazeAwayDetected: false,
            gazeDirection: 'center',
            headMovementDetected: false,
            headPoseDeviationDegrees: 0,
            lastObservationAt: Date.now(),
            status: 'Ready to start session',
          }));
          frameTimerRef.current = window.setTimeout(tick, LIVE_INTERVAL_MS);
          return;
        }

        // Proctoring score counters: update once per detection tick without causing re-renders.
        const proctoringData = proctoringDataRef.current;
        const intervalSeconds = LIVE_INTERVAL_MS / 1000;

        proctoringData.gaze.totalFrames += 1;
        if (gaze.away) {
          proctoringData.gaze.framesLookingAway += 1;
        }

        proctoringData.face.totalFrames += 1;
        if (faceCount === 0) {
          proctoringData.face.framesNoFace += 1;
        } else if (faceCount === 1) {
          proctoringData.face.framesNormal += 1;
        } else {
          proctoringData.face.framesMultipleFaces += 1;
        }

        if (faceCount > 1 && prevFaceCountRef.current <= 1) {
          proctoringData.face.multipleFaceEvents += 1;
        }
        prevFaceCountRef.current = faceCount;

        if (faceCount === 1 && headPose) {
          proctoringData.headPose.totalFrames += 1;
          if (headMovementDetected) {
            proctoringData.headPose.framesDeviated += 1;
          } else {
            proctoringData.headPose.framesNormal += 1;
          }
        }

        proctoringData.phone.totalSeconds += intervalSeconds;
        if (detectedPhone) {
          proctoringData.phone.detectedSeconds += intervalSeconds;
          proctoringData.phone.consecutiveSeconds += intervalSeconds;
          proctoringData.phone.maxConsecutiveSeconds = Math.max(
            proctoringData.phone.maxConsecutiveSeconds,
            proctoringData.phone.consecutiveSeconds,
          );
          if (!proctoringData.phone.wasDetected) {
            proctoringData.phone.events += 1;
          }
          proctoringData.phone.wasDetected = true;
        } else {
          proctoringData.phone.consecutiveSeconds = 0;
          proctoringData.phone.wasDetected = false;
        }

        setState((current) => ({
          ...current,
          cameraActive: true,
          faceDetectorActive: true,
          objectDetectorActive: true,
          faceCount,
          phoneDetected: detectedPhone,
          phoneProximity: phone?.proximity ?? 'far',
          phoneOrientation: phone?.orientation ?? 'unknown',
          foreignObjectDetected: detectedForeignObject,
          foreignObjectLabel: foreignObject?.label ?? '',
          gazeAwayDetected: gaze.away,
          gazeDirection: gaze.direction,
          gazeDebug: `${gaze.direction} · v ${gaze.verticalWorld.toFixed(2)} · band [${safeCalibration.vBandTop.toFixed(2)},${safeCalibration.vBandBottom.toFixed(2)}] · up<${(safeCalibration.vBandTop - V_MARGIN_UP).toFixed(2)} dn>${(safeCalibration.vBandBottom + V_MARGIN_DOWN).toFixed(2)} · Δpitch ${gazePitchDelta.toFixed(1)}° · ${safeCalibration.trusted ? 'cal' : 'default'}`,
          headMovementDetected,
          headPoseDeviationDegrees: Math.round(headPoseDeviation?.magnitude ?? 0),
          lastObservationAt: Date.now(),
          status: current.fullscreenExitDetected
            ? 'Fullscreen exited'
            : current.tabSwitchDetected
              ? 'Tab/window switch detected'
              : faceCount > 1
              ? 'Multiple faces detected'
              : detectedPhone
                ? `Phone detected (${phone?.proximity ?? 'unknown'}, ${phone?.orientation ?? 'unknown'})`
                : detectedForeignObject
                  ? `Foreign object detected (${foreignObject?.trigger ?? 'unknown'}: ${foreignObject?.label ?? 'object'})`
                  : headMovementDetected
                  ? `Head moved too much (${Math.round(headPoseDeviation?.magnitude ?? 0)}°)`
                  : gaze.away
                    ? `Looking away (${gaze.direction})`
                    : 'Detection active',
        }));

        if (faceCount === 0) {
          if (!missingSince.current) missingSince.current = Date.now();
          if (Date.now() - (missingSince.current || 0) > NO_FACE_THRESHOLD_MS) {
            const metadata = { durationMs: Date.now() - (missingSince.current || 0) };
            if (emitWithCooldown(faceAlertAt, 'FACE_NOT_DETECTED', 'HIGH', metadata)) {
              violationScreenRecorder.recordViolationClip('NO_FACE', metadata);
            }
          }
        } else {
          missingSince.current = null;
        }

        // require a short confirmation window to avoid spurious multi-face / phone alerts
        if (faceCount > 1) {
          if (!multiFaceSince.current) multiFaceSince.current = Date.now();
          if (Date.now() - (multiFaceSince.current || 0) > MULTI_FACE_CONFIRM_MS) {
            const metadata = { faceCount, faces: faceCount };
            if (emitWithCooldown(multiFaceAlertAt, 'MULTIPLE_FACES_DETECTED', 'HIGH', metadata)) {
              violationScreenRecorder.recordViolationClip('MULTIPLE_FACES', metadata);
            }
            multiFaceSince.current = null;
          }
        } else {
          multiFaceSince.current = null;
        }

        if (phone && consumePhoneAlert(phone, phoneStateRef.current)) {
          const metadata = {
            proximity: phone.proximity,
            orientation: phone.orientation,
            source: phone.source,
            confidence: phone.rollingConfidence,
            detections: phone.detections,
          };

          if (emitWithCooldown(phoneAlertAt, 'MOBILE_PHONE_DETECTED', 'HIGH', metadata)) {
            violationScreenRecorder.recordViolationClip('MOBILE_PHONE', metadata);
          }
        }

        if (foreignObject && consumeForeignObjectAlert(foreignObject, foreignObjectStateRef.current)) {
          const metadata = {
            label: foreignObject.label,
            trigger: foreignObject.trigger,
            confidence: foreignObject.confidence,
            areaRatio: foreignObject.areaRatio,
            edgeSides: foreignObject.edgeSides,
          };

          if (emitWithCooldown(foreignObjectAlertAt, 'FOREIGN_OBJECT_DETECTED', 'HIGH', metadata)) {
            violationScreenRecorder.recordViolationClip('FOREIGN_OBJECT', metadata);
          }
        }

        if (gaze.away) {
          if (!gazeSince.current) gazeSince.current = Date.now();
          if (Date.now() - (gazeSince.current || 0) > GAZE_CONFIRM_MS) {
            const metadata = {
              direction: gaze.direction,
              confidence: gaze.confidence,
              source: gaze.source,
              calibrationTrusted: safeCalibration.trusted,
              calibrationReason: safeCalibration.reason,
              thresholdX: safeCalibration.thresholdX,
              thresholdY: safeCalibration.thresholdY,
              headPoseCompensated: gaze.headPoseCompensated,
              uncompensatedX: gaze.uncompensatedX,
              uncompensatedY: gaze.uncompensatedY,
              compensatedX: gaze.compensatedX,
              compensatedY: gaze.compensatedY,
              yawDelta: gaze.yawDelta,
              pitchDelta: gaze.pitchDelta,
            };

            if (emitWithCooldown(gazeAlertAt, 'GAZE_AWAY_DETECTED', 'MEDIUM', metadata)) {
              violationScreenRecorder.recordViolationClip('GAZE_AWAY', metadata);
            }
            gazeSince.current = null;
          }
        } else {
          gazeSince.current = null;
        }

        if (headMovementDetected && headPoseDeviation && headPose) {
          if (!headPoseSince.current) headPoseSince.current = Date.now();
          if (Date.now() - (headPoseSince.current || 0) > HEAD_POSE_CONFIRM_MS) {
            const metadata = {
              deviationDegrees: Math.round(headPoseDeviation.magnitude),
              maxAxisDegrees: Math.round(headPoseDeviation.maxAxis),
              yawDelta: Math.round(headPoseDeviation.yaw),
              pitchDelta: Math.round(headPoseDeviation.pitch),
              rollDelta: Math.round(headPoseDeviation.roll),
              source: headPose.source,
            };

            if (emitWithCooldown(headPoseAlertAt, 'HEAD_MOVEMENT_DETECTED', 'MEDIUM', metadata)) {
              violationScreenRecorder.recordViolationClip('HEAD_MOVEMENT', metadata);
            }
            headPoseSince.current = null;
          }
        } else {
          headPoseSince.current = null;
        }

        frameTimerRef.current = window.setTimeout(tick, LIVE_INTERVAL_MS);
      };

      frameTimerRef.current = window.setTimeout(tick, LIVE_INTERVAL_MS);
    }

    start().catch((error) => {
      setState({
        initialized: false,
        status: 'Camera permission denied',
        permissionDenied: true,
        cameraActive: false,
        faceDetectorActive: false,
        objectDetectorActive: false,
        faceCount: 0,
        phoneDetected: false,
        phoneProximity: 'far',
        phoneOrientation: 'unknown',
        foreignObjectDetected: false,
        foreignObjectLabel: '',
        gazeAwayDetected: false,
        gazeDirection: 'center',
        headMovementDetected: false,
        headPoseDeviationDegrees: 0,
        tabSwitchDetected: false,
        tabSwitchReason: null,
        lastTabSwitchAt: null,
        lastTabSwitchDurationMs: null,
        activeTabSwitchDurationMs: 0,
        totalTabSwitchDurationMs: 0,
        tabSwitchCount: 0,
        fullscreenActive: Boolean(getFullscreenElement()),
        fullscreenExitDetected: false,
        fullscreenExitReason: null,
        lastFullscreenExitAt: null,
        fullscreenSupported: typeof document === 'undefined' ? true : isFullscreenSupported(),
        fullscreenReadyBeforeInterview: Boolean(getFullscreenElement()),
        fullscreenPromptRequired: typeof document === 'undefined' ? false : !Boolean(getFullscreenElement()) && isFullscreenSupported(),
        preInterviewFullscreenRequestedAt: null,
        preInterviewFullscreenEnteredAt: Boolean(getFullscreenElement()) ? Date.now() : null,
        microphoneSupported: typeof navigator === 'undefined' ? true : isMicrophoneCaptureSupported(),
        microphoneReadyBeforeInterview: false,
        microphonePromptRequired: true,
        preInterviewMicrophoneRequestedAt: null,
        preInterviewMicrophoneGrantedAt: null,
        screenShareSupported: typeof navigator === 'undefined' ? true : isScreenShareRecordingSupported(),
        screenShareReadyBeforeInterview: violationScreenRecorder.hasScreenSharePermission,
        screenSharePromptRequired: !violationScreenRecorder.hasScreenSharePermission,
        preInterviewScreenShareRequestedAt: null,
        preInterviewScreenShareGrantedAt: violationScreenRecorder.hasScreenSharePermission ? Date.now() : null,
        lastObservationAt: null,
      });
      const message = error instanceof Error ? error.message : 'getUserMedia failed';
      const metadata = { reason: message, permissionDenied: true };
      if (sessionStartedRef.current) {
        proctoringDataRef.current.sessionControl.cameraOffIncidentCount += 1;
        proctoringDataRef.current.sessionControl.cameraOffMaxConsecutiveSeconds = Math.max(
          proctoringDataRef.current.sessionControl.cameraOffMaxConsecutiveSeconds,
          10,
        );
        emit('CAMERA_PERMISSION_DENIED', 'HIGH', { message });
        emit('CAMERA_OFF_DETECTED', 'HIGH', metadata);
        violationScreenRecorder.recordViolationClip('CAMERA_OFF', metadata);
      }
    });

    return () => {
      aliveRef.current = false;
      if (frameTimerRef.current) {
        window.clearTimeout(frameTimerRef.current);
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      cameraOffSince.current = null;
      cameraOffIncidentActive.current = false;
      if (cameraOffConfirmTimerRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(cameraOffConfirmTimerRef.current);
        cameraOffConfirmTimerRef.current = null;
      }
      tabSwitchSince.current = null;
      tabSwitchIncidentActive.current = false;
      tabSwitchReasonRef.current = null;
      clearTabSwitchDurationTimer();
      fullscreenExitSince.current = null;
      fullscreenIncidentActive.current = false;
      fullscreenExitReasonRef.current = null;
      fullscreenRequestInFlightRef.current = false;
      screenShareRequestInFlightRef.current = false;
      screenShareGrantedRef.current = false;
      faceLandmarkerRef.current?.close();
      objectDetectorRef.current?.close();
      faceLandmarkerRef.current = null;
      objectDetectorRef.current = null;
      streamRef.current = null;
    };
  }, [emit, proctoringEnabled, violationScreenRecorder.recordViolationClip]);

  return {
    videoRef,
    events,
    emit,
    state,
    sessionStarted,
    startProctoringSession,
    // Backward-compatible: existing UI buttons that call requestFullscreen() now also request screen sharing first.
    requestFullscreen: enterFullscreenBeforeInterview,
    requestExamFullscreen,
    enterFullscreenBeforeInterview,
    prepareInterviewStart,
    startInterviewSetup: prepareInterviewStart,
    requestProctoringPermissions: prepareInterviewStart,
    requestRequiredPermissions: prepareInterviewStart,
    requestScreenShareBeforeInterview,
    requestScreenShare: violationScreenRecorder.requestScreenShare,
    stopScreenShare: violationScreenRecorder.stopScreenShare,
    getScreenAudioStream: violationScreenRecorder.getScreenAudioStream,
    getScreenVideoStream: violationScreenRecorder.getScreenVideoStream,
    hasScreenSharePermission: violationScreenRecorder.hasScreenSharePermission,
    isRecordingViolation: violationScreenRecorder.isRecordingViolation,
    screenShareError: violationScreenRecorder.screenShareError,
    violationRecordings,
    /** Raw per-frame counters. Read via .current — do not mutate directly. */
    proctoringRef: proctoringDataRef,
    /** Final score is null while the interview is running and becomes available after endProctoringSession(). */
    finalProctoringScore,
    proctoringScore: finalProctoringScore,
    proctoringSessionEnded,
    sessionEnded: proctoringSessionEnded,
    showProctoringScore: proctoringSessionEnded && finalProctoringScore !== null,
    /** Call this from the End Interview button. It freezes counters, stops monitoring, stores, emits, and returns the final score. */
    endProctoringSession,
    completeSession: endProctoringSession,
    handleCompleteSession: endProctoringSession,
    onCompleteSession: endProctoringSession,
    endSession: endProctoringSession,
    finishProctoringSession: endProctoringSession,
    /** Still available if you only want to compute a preview without ending/stopping the session. */
    computeProctoringScore,
    canStartInterview:
      state.fullscreenActive &&
      state.fullscreenReadyBeforeInterview &&
      !state.fullscreenExitDetected &&
      state.screenShareReadyBeforeInterview &&
      violationScreenRecorder.hasScreenSharePermission,
    preInterviewFullscreenRequired: state.fullscreenSupported && !state.fullscreenActive,
    preInterviewScreenShareRequired: state.screenShareSupported && !violationScreenRecorder.hasScreenSharePermission,
  };
}
