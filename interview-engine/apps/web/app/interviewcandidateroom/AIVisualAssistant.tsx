'use client';

import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Room } from 'livekit-client';
import { createAudioAnalyser } from 'livekit-client';
import { Orb } from 'orb-ui';
import type { OrbState } from 'orb-ui';
// The app-managed LiveKit adapter ({ room, createAudioAnalyser }) is only
// exported from orb-ui's general adapters barrel — the 'orb-ui/adapters/livekit'
// subpath resolves to the package's fully-managed browser adapter instead
// (tokenEndpoint/sandboxId only), which would hand Room ownership to orb-ui and
// break this app's own timers/question-tracking/proctoring logic already living
// on this Room. See orb-ui's package.json "exports" map.
import { createLiveKitAdapter } from 'orb-ui/adapters';

export type AssistantMode = 'connecting' | 'idle' | 'listening' | 'thinking' | 'speaking' | 'complete';

type Props = {
  mode: AssistantMode;
  voiceActive?: boolean;
  /**
   * The already-connected LiveKit Room from useVoiceInterview, once connect()
   * has resolved. When set, the orb subscribes to real per-frame audio via
   * orb-ui's app-managed LiveKit adapter. Null before connect() resolves, and
   * for the (now rare/legacy) non-LiveKit path — the orb still renders in
   * controlled mode with a synthesized volume in that case.
   */
  room?: Room | null;
};

// orb-ui's OrbState has no "interview complete" concept — fall back to its
// calmest resting state.
const ORB_STATE_MAP: Record<AssistantMode, OrbState> = {
  connecting: 'connecting',
  idle: 'idle',
  listening: 'listening',
  thinking: 'thinking',
  speaking: 'speaking',
  complete: 'idle',
};

// Screen-reader-only turn-state announcer — replaces the removed visible
// "Lina is speaking" / "Understanding your answer" captions for sighted users
// (who now read turn-state from the orb's own motion) while keeping the same
// information available to screen-reader users via aria-live.
function turnStateAnnouncement(mode: AssistantMode): string {
  if (mode === 'listening') return 'Your turn to speak';
  if (mode === 'speaking') return 'Lina is responding';
  return '';
}

const srOnlyStyle: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap',
  border: 0,
};

// Memoized: this subtree shouldn't re-render just because unrelated state
// changes elsewhere in the (large) candidate-room page component — that would
// compete with orb-ui's own rendering/animation loop for main-thread time.
function AIVisualAssistantImpl({ mode, voiceActive = false, room = null }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  // orb-ui's <Orb> takes a fixed pixel `size` (default 200) rather than
  // filling its container — track the stage's own box so the orb scales with
  // the .avatar-panel layout instead of sitting at a constant 200px regardless
  // of viewport (roughly matching the legacy orb's clamp(150px,20vw,220px)).
  const [orbSize, setOrbSize] = useState(200);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      const next = Math.round(Math.min(box.width, box.height) * 0.6);
      setOrbSize(Math.max(150, Math.min(280, next)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // App-managed LiveKit adapter: subscribes to the Room this app already
  // connected (via useVoiceInterview) rather than orb-ui owning its own
  // connection. Real per-frame agent/mic volume flows through this; `state`
  // below is still passed explicitly and stays authoritative for turn-state.
  const adapter = useMemo(
    () => (room ? createLiveKitAdapter({ room, createAudioAnalyser }) : undefined),
    [room],
  );

  // Legacy/no-room path (rare going forward — only transiently true before
  // connect() resolves, or for a non-LiveKit session). No real waveform to
  // read here, so synthesize a smoothed, non-repeating random walk while
  // "speaking" — the same trick most "AI is talking" orb UIs use — written to
  // a volume React state instead of a CSS variable.
  const [syntheticVolume, setSyntheticVolume] = useState(0);
  useEffect(() => {
    if (adapter) return;
    if (mode !== 'speaking') {
      setSyntheticVolume(0);
      return;
    }
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setSyntheticVolume(0.4);
      return;
    }
    let raf = 0;
    let current = 0.35;
    let target = 0.35;
    let lastTargetChangeMs = 0;
    const loop = (t: number) => {
      if (t - lastTargetChangeMs > 140 + Math.random() * 180) {
        target = 0.3 + Math.random() * 0.7;
        lastTargetChangeMs = t;
      }
      current += (target - current) * 0.14;
      setSyntheticVolume(current);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [mode, adapter]);

  const announcement = turnStateAnnouncement(mode);

  return (
    <div ref={rootRef} className={`orb-stage${voiceActive ? ' is-voice-active' : ''}`}>
      <Orb
        adapter={adapter}
        theme="cloud"
        interactive={false}
        state={ORB_STATE_MAP[mode]}
        volume={adapter ? undefined : syntheticVolume}
        size={orbSize}
        className="orb-stage-orb"
        aria-label="Lina, your AI interviewer"
      />
      <div role="status" aria-live="polite" style={srOnlyStyle}>
        {announcement}
      </div>
    </div>
  );
}

export const AIVisualAssistant = memo(AIVisualAssistantImpl);
