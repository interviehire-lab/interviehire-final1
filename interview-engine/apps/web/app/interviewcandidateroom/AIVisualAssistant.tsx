'use client';

import { useEffect, useState } from 'react';

export type AssistantMode = 'connecting' | 'idle' | 'listening' | 'thinking' | 'speaking' | 'complete';

type Props = {
  mode: AssistantMode;
  voiceActive?: boolean;
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

export function AIVisualAssistant({ mode, voiceActive = false }: Props) {
  const [copyIndex, setCopyIndex] = useState(0);
  const copy = COPY[mode];

  useEffect(() => {
    setCopyIndex(0);
    if (copy.length < 2) return;
    const timer = window.setInterval(() => setCopyIndex((index) => (index + 1) % copy.length), 2800);
    return () => window.clearInterval(timer);
  }, [mode, copy.length]);

  const message = copy[copyIndex] ?? copy[0];

  return (
    <div className={`ai-visual ai-visual--${mode}${voiceActive ? ' is-voice-active' : ''}`}>
      <div className="ai-ambient" />
      <div className="ai-stage" aria-hidden="true">
        <div className="ai-sphere">
          <div className="ai-sphere-highlight" />
          <div className="ai-core" />
        </div>
      </div>

      <div className="ai-response-wave" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => <i key={index} />)}
      </div>

      <div className="ai-state-copy" role="status" aria-live="polite">
        <div className="ai-state-title"><i />{message.title}</div>
        <div className="ai-state-detail" key={`${mode}-${copyIndex}`}>{message.detail}</div>
      </div>
    </div>
  );
}
