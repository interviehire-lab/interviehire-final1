'use client';

import { memo, useEffect, useRef, useState } from 'react';
import type { RemoteAudioTrack } from 'livekit-client';
import type { AgentState } from '@livekit/components-react';

import { AgentAudioVisualizerAura } from '@/components/agents-ui/agent-audio-visualizer-aura';

export type AssistantMode = 'connecting' | 'idle' | 'listening' | 'thinking' | 'speaking' | 'complete';

type Props = {
  mode: AssistantMode;
  voiceActive?: boolean;
  /**
   * Render LiveKit's shader-based AgentAudioVisualizerAura instead of the
   * built-in orb. Only meaningful for a live LiveKit call — the legacy
   * static-question flow has no live AI audio to react to, so it keeps the
   * orb below unconditionally.
   */
  useAura?: boolean;
  /** LiveKit's real remote agent-audio track, once subscribed — the aura's audio input. */
  audioTrack?: RemoteAudioTrack | null;
};

// Same per-state palette as the orb's --orb-a custom property below, so the
// aura and the orb read as the same design language when a job's settings
// toggle between voiceProvider values.
const AURA_COLOR: Record<AssistantMode, `#${string}`> = {
  connecting: '#94a3b8',
  idle: '#67e8f9',
  listening: '#d4ff00',
  thinking: '#a78bfa',
  speaking: '#f95738',
  complete: '#d4ff00',
};

// AgentAudioVisualizerAura's own AgentState has no "interview complete"
// concept (it's a generic LiveKit agent vocabulary) — fall back to its calmest
// resting state and let the copy overlay below carry the "complete" meaning.
const AURA_STATE: Record<AssistantMode, AgentState> = {
  connecting: 'connecting',
  idle: 'idle',
  listening: 'listening',
  thinking: 'thinking',
  speaking: 'speaking',
  complete: 'idle',
};

const COPY: Record<AssistantMode, Array<{ title: string; detail: string }>> = {
  connecting: [
    { title: 'Preparing your interview', detail: 'Bringing everything into focus' },
    { title: 'Almost ready', detail: 'Checking the conversation channel' },
  ],
  idle: [
    { title: 'Ready when you are', detail: 'Take a breath and answer naturally' },
    { title: 'Lina is here', detail: 'There is no need to rush' },
  ],
  listening: [
    { title: 'Listening', detail: 'Take your time—I’m following along' },
    { title: 'I’m with you', detail: 'Keep going whenever you’re ready' },
  ],
  thinking: [
    { title: 'Understanding your answer', detail: 'Connecting the important details' },
    { title: 'Thinking it through', detail: 'Preparing a useful next question' },
    { title: 'Following the thread', detail: 'Turning your answer into context' },
  ],
  speaking: [
    { title: 'Lina is speaking', detail: 'Your next prompt is on screen' },
    { title: 'Sharing the next thought', detail: 'You can respond when the orb settles' },
  ],
  complete: [
    { title: 'Interview complete', detail: 'Preparing your final report' },
  ],
};

// Memoized: with useAura on, this subtree shouldn't re-render just because
// unrelated state changes elsewhere in the (large) candidate-room page
// component — that would compete with the WebGL canvas for main-thread time
// and show up as visible jitter in the aura.
function AIVisualAssistantImpl({ mode, voiceActive = false, useAura = false, audioTrack = null }: Props) {
  const [copyIndex, setCopyIndex] = useState(0);
  const copy = COPY[mode];
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setCopyIndex(0);
    if (copy.length < 2) return;
    const timer = window.setInterval(() => setCopyIndex((index) => (index + 1) % copy.length), 2800);
    return () => window.clearInterval(timer);
  }, [mode, copy.length]);

  // Drive the orb's "speaking" energy in real time. Browser speechSynthesis
  // doesn't expose the synthesized waveform (no MediaStream/AnalyserNode access
  // like a real <audio> element would give us — see useTranscript.ts's mic-level
  // meter for that pattern), so there's no raw amplitude to read here. Instead
  // this generates a smoothed, non-repeating random walk — the same trick most
  // "AI is talking" orb UIs use even when they DO have real audio, because raw
  // waveform amplitude looks too jittery on its own. The result: a single CSS
  // custom property (--speak-energy, 0..1) on the root element, which every
  // reactive visual below reads via calc()/var() — one signal, many effects,
  // no per-frame inline styles scattered across the tree.
  useEffect(() => {
    const el = rootRef.current;
    // The aura drives its own reactivity from the real LiveKit audioTrack —
    // this synthetic random walk exists only for the orb below, which has no
    // real waveform to read (see the comment on the orb branch in the JSX).
    if (!el || useAura) return;
    if (mode !== 'speaking') {
      el.style.setProperty('--speak-energy', '0');
      return;
    }
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      el.style.setProperty('--speak-energy', '0.4');
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
      el.style.setProperty('--speak-energy', current.toFixed(3));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      el.style.setProperty('--speak-energy', '0');
    };
  }, [mode, useAura]);

  const message = copy[copyIndex] ?? copy[0];

  return (
    <div ref={rootRef} className={`ai-visual ai-visual--${mode}${voiceActive ? ' is-voice-active' : ''}${useAura ? ' ai-visual--aura' : ''}`}>
      <div className="ai-ambient" />

      {useAura ? (
        <div className="ai-aura-stage" aria-hidden="true">
          <AgentAudioVisualizerAura
            size="xl"
            className="h-full w-full"
            state={AURA_STATE[mode]}
            themeMode="dark"
            color={AURA_COLOR[mode]}
            audioTrack={audioTrack ?? undefined}
          />
        </div>
      ) : (
        <>
          <div className="ai-stage" aria-hidden="true">
            <div className="ai-blob ai-blob-1" />
            <div className="ai-blob ai-blob-2" />
            <div className="ai-sphere">
              <div className="ai-sphere-highlight" />
              <div className="ai-core" />
            </div>
          </div>

          <div className="ai-response-wave" aria-hidden="true">
            {Array.from({ length: 5 }, (_, index) => <i key={index} />)}
          </div>
        </>
      )}

      <div className="ai-state-copy" role="status" aria-live="polite">
        <div className="ai-state-title"><i />{message.title}</div>
        <div className="ai-state-detail" key={`${mode}-${copyIndex}`}>{message.detail}</div>
      </div>
    </div>
  );
}

export const AIVisualAssistant = memo(AIVisualAssistantImpl);
