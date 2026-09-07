'use client';

import { memo, type CSSProperties } from 'react';
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

  return (
    <div className={`orb-stage${voiceActive ? ' is-voice-active' : ''}`}>
      {/* AgentAudioVisualizerAuraVariants' `size` prop is a fixed Tailwind
          h-[Npx] step (icon/sm/md/lg/xl), not container-relative. `h-auto`
          here overrides that (cn()'s tailwind-merge drops the variant's
          conflicting h-[Npx] in favor of this later class), leaving only
          `w-full` explicit — so aspect-square derives height from the
          .orb-stage's actual width instead of a constant pixel size. */}
      <AgentAudioVisualizerAura
        state={AGENT_STATE_MAP[mode]}
        audioTrack={agentAudioTrack ?? undefined}
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
