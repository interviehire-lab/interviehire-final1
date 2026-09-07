'use client';

import { memo, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { RemoteAudioTrack } from 'livekit-client';
import type { AgentState } from '@livekit/components-react';

import { AgentAudioVisualizerAura } from '@/components/agents-ui/agent-audio-visualizer-aura';

export type AssistantMode = 'connecting' | 'idle' | 'listening' | 'thinking' | 'speaking' | 'complete';

type Props = {
  mode: AssistantMode;
  voiceActive?: boolean;
  /**
   * The agent's live remote audio track from useVoiceInterview
   * (RoomEvent.TrackSubscribed), once the LiveKit worker has joined and
   * started publishing. The aura reads this track's real-time volume via
   * LiveKit's own useTrackVolume (Web Audio AnalyserNode) to morph its
   * shape/brightness per animation frame — no synthetic/random-walk
   * fallback. Null before the agent joins, or between turns while no
   * remote audio track is subscribed; the aura still renders (state-driven
   * motion) with zero volume in that case.
   */
  agentAudioTrack?: RemoteAudioTrack | null;
};

// The aura's own AgentState has no "interview complete" concept — fall back
// to its calmest resting state.
const AGENT_STATE_MAP: Record<AssistantMode, AgentState> = {
  connecting: 'connecting',
  idle: 'idle',
  listening: 'listening',
  thinking: 'thinking',
  speaking: 'speaking',
  complete: 'idle',
};

// A distinct color per turn-state, so the aura itself communicates what's
// happening (not just its motion) — slate while connecting, cyan at rest,
// lime while listening, violet while thinking, warm orange while speaking.
const AURA_COLOR: Record<AssistantMode, `#${string}`> = {
  connecting: '#94a3b8',
  idle: '#67e8f9',
  listening: '#d4ff00',
  thinking: '#a78bfa',
  speaking: '#f95738',
  complete: '#d4ff00',
};

// The aura's `color` prop is a raw WebGL uniform with no CSS transition to
// smooth it — swapping AURA_COLOR[mode] straight through makes every mode
// change (idle→listening→thinking→...) a hard, jarring color snap. Chase the
// target color a few percent closer each frame instead, so a mode change
// reads as a fade rather than a jump cut.
function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
function rgbToHex(r: number, g: number, b: number): `#${string}` {
  const c = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
function stepColor(from: string, to: string, rate: number): `#${string}` {
  const [fr, fg, fb] = hexToRgb(from);
  const [tr, tg, tb] = hexToRgb(to);
  return rgbToHex(fr + (tr - fr) * rate, fg + (tg - fg) * rate, fb + (tb - fb) * rate);
}
function colorDistance(a: string, b: string): number {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return Math.abs(ar - br) + Math.abs(ag - bg) + Math.abs(ab - bb);
}

// Screen-reader-only turn-state announcer — sighted users read turn-state
// from the aura's own motion; screen-reader users get the same information
// via aria-live.
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
// changes elsewhere in the (large) candidate-room page component — that
// would compete with the shader's own per-frame animation loop for
// main-thread time.
function AIVisualAssistantImpl({ mode, voiceActive = false, agentAudioTrack = null }: Props) {
  const announcement = turnStateAnnouncement(mode);
  const [auraColor, setAuraColor] = useState<`#${string}`>(AURA_COLOR[mode]);
  const auraColorRef = useRef(auraColor);

  useEffect(() => {
    const target = AURA_COLOR[mode];
    if (auraColorRef.current === target) return;
    let raf = 0;
    const step = () => {
      const next = colorDistance(auraColorRef.current, target) <= 3
        ? target
        : stepColor(auraColorRef.current, target, 0.09);
      auraColorRef.current = next;
      setAuraColor(next);
      if (next !== target) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [mode]);

  return (
    <div className={`orb-stage${voiceActive ? ' is-voice-active' : ''}`}>
      {/* AgentAudioVisualizerAuraVariants' `size` prop is a fixed Tailwind
          h-[Npx] step (icon/sm/md/lg/xl), not container-relative. `h-auto`
          here overrides that (cn()'s tailwind-merge drops the variant's
          conflicting h-[Npx] in favor of this later class), leaving only
          `w-full` explicit — so aspect-square derives height from the
          .orb-stage's actual width instead of a constant pixel size.
          themeMode is explicit (not left to its own document.documentElement
          'dark'-class default) — this room never adds that class, so the
          default silently resolved to the shader's 'light' branch, a
          different bloom/tonemap curve than the dark one this room is built
          for. */}
      <AgentAudioVisualizerAura
        state={AGENT_STATE_MAP[mode]}
        audioTrack={agentAudioTrack ?? undefined}
        themeMode="dark"
        color={auraColor}
        className="orb-stage-orb aspect-square w-full h-auto max-w-[420px]"
        aria-label="Lina, your AI interviewer"
      />
      <div role="status" aria-live="polite" style={srOnlyStyle}>
        {announcement}
      </div>
    </div>
  );
}

export const AIVisualAssistant = memo(AIVisualAssistantImpl);
