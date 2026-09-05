// Styles for the AI Interview Room. Ported verbatim from mockups/interview-page.html
// and extended with the permission gate, live-integrity pill, and live candidate webcam.
export const roomStyles = `
  .room, .room * { box-sizing: border-box; }

  .room {
    --bg: #08090d;
    --panel: #11131a;
    --line: rgba(255, 255, 255, .1);
    --muted: #94a3b8;
    --lime: #d4ff00;
    --orange: #f95738;
    position: fixed;
    inset: 0;
    z-index: 40;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: #fff;
    font-family: "IBM Plex Sans", system-ui, sans-serif;
    background:
      radial-gradient(circle at 0 0, rgba(249, 87, 56, .20), transparent 28%),
      radial-gradient(circle at 100% 45%, rgba(212, 255, 0, .08), transparent 26%),
      #08090d;
  }

  .room button { font: inherit; }

  .topbar {
    position: relative;
    z-index: 10;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 24px;
    height: 104px;
    padding: 0 38px;
  }

  .brand, .connection, .job-pill, .identity, .status-pill, .you-pill {
    display: flex;
    align-items: center;
  }

  .brand { gap: 14px; }

  .logo {
    display: grid;
    width: 42px;
    height: 42px;
    place-items: center;
    border-radius: 999px;
    background: linear-gradient(135deg, #f95738, #8b1d13);
    box-shadow: 0 0 40px rgba(249, 87, 56, .28);
    font: 900 18px Manrope, sans-serif;
  }

  .brand-name { font: 800 22px Manrope, sans-serif; letter-spacing: -.03em; }
  .brand-name span { color: var(--orange); }

  .room-label {
    margin-left: 24px;
    color: #8ba0c7;
    font: 600 12px Manrope, sans-serif;
    letter-spacing: .35em;
    text-transform: uppercase;
  }

  .job-pill {
    gap: 14px;
    min-width: 418px;
    justify-content: center;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: rgba(255, 255, 255, .045);
    padding: 10px 20px;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .03);
  }

  .live-dot {
    width: 8px; height: 8px; border-radius: 999px;
    background: var(--lime);
    box-shadow: 0 0 18px rgba(212, 255, 0, .85);
  }

  .job-pill strong { font: 700 17px Manrope, sans-serif; }
  .job-pill span { color: #74829b; font-size: 12px; letter-spacing: .28em; text-transform: uppercase; }

  .connection { justify-content: flex-end; gap: 18px; }

  .integrity {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    border-radius: 999px;
    padding: 7px 13px;
    font: 700 12px Manrope, sans-serif;
    letter-spacing: .04em;
    text-transform: capitalize;
    border: 1px solid transparent;
  }
  .integrity.ok { color: var(--lime); border-color: rgba(212,255,0,.3); background: rgba(212,255,0,.08); }
  .integrity.warn { color: #fbbf24; border-color: rgba(251,191,36,.35); background: rgba(251,191,36,.1); }
  .integrity.alert { color: var(--orange); border-color: rgba(249,87,56,.45); background: rgba(249,87,56,.14); }

  .bars {
    display: inline-grid;
    grid-template-columns: repeat(4, 3px);
    align-items: end;
    gap: 3px;
    height: 17px;
  }
  .bars i { display: block; width: 3px; border-radius: 999px; background: var(--lime); }
  .bars i:nth-child(1) { height: 5px; }
  .bars i:nth-child(2) { height: 8px; }
  .bars i:nth-child(3) { height: 12px; }
  .bars i:nth-child(4) { height: 16px; }

  .connection-text { color: #cbd5e1; font-size: 14px; }

  .timer {
    border: 1px solid var(--line);
    border-radius: 999px;
    background: rgba(255, 255, 255, .04);
    padding: 10px 14px;
    font: 700 14px Manrope, sans-serif;
  }

  .content {
    display: grid;
    min-height: 0;
    flex: 1;
    grid-template-columns: minmax(0, 1.9fr) minmax(420px, 1fr);
    gap: 30px;
    padding: 12px 30px 30px;
  }
  .content--conversational { grid-template-columns: minmax(0, 1fr); }

  .avatar-panel, .candidate-panel, .question-card {
    border: 1px solid var(--line);
    background: var(--panel);
    box-shadow: 0 24px 90px rgba(0, 0, 0, .28);
  }

  .avatar-panel { position: relative; min-height: 0; overflow: hidden; border-radius: 30px; }

  /* Minimal native conversational orb. Subtle colour and motion changes carry
     state without making the candidate watch a loading animation. */
  .ai-visual {
    --orb-a: #67e8f9;
    --orb-b: #8b5cf6;
    position: absolute; inset: 0;
    display: grid; place-items: center;
    overflow: hidden;
    background:
      radial-gradient(circle at 50% 47%, rgba(103, 232, 249, .055), transparent 32%),
      #060810;
  }
  .ai-visual--connecting { --orb-a: #94a3b8; --orb-b: #38bdf8; }
  .ai-visual--idle { --orb-a: #67e8f9; --orb-b: #8b5cf6; }
  .ai-visual--listening { --orb-a: #d4ff00; --orb-b: #22d3ee; }
  .ai-visual--thinking { --orb-a: #a78bfa; --orb-b: #6366f1; }
  .ai-visual--speaking { --orb-a: #f95738; --orb-b: #fb7185; }
  .ai-visual--complete { --orb-a: #d4ff00; --orb-b: #34d399; }

  .ai-visual { --speak-energy: 0; }

  .ai-ambient {
    position: absolute; width: min(46vw, 430px); aspect-ratio: 1; border-radius: 50%;
    background: var(--orb-b); filter: blur(110px);
    opacity: calc(.08 + var(--speak-energy) * .2);
    transition: background 700ms ease, opacity 120ms linear;
  }
  .ai-stage {
    position: relative; z-index: 1;
    width: clamp(150px, 20vw, 220px); aspect-ratio: 1;
    display: grid; place-items: center;
    transform: scale(calc(1 + var(--speak-energy) * .06));
    transition: transform 120ms linear;
  }

  /* Soft, organically-morphing blobs drifting behind the sphere — the "plasma
     cloud" softness that reads as an AI voice orb rather than a static icon.
     Independent timings/directions so the two never sync into something
     mechanical-looking. Colored via the same --orb-a/--orb-b the sphere and
     every other mode-color already key off, so this stays in sync for free. */
  .ai-blob {
    position: absolute; inset: 6%; border-radius: 46% 54% 63% 37% / 45% 40% 60% 55%;
    filter: blur(22px); opacity: .5; mix-blend-mode: screen;
  }
  .ai-blob-1 { background: color-mix(in srgb, var(--orb-a) 70%, transparent); animation: ai-blob-morph-1 9s ease-in-out infinite; }
  .ai-blob-2 { background: color-mix(in srgb, var(--orb-b) 65%, transparent); animation: ai-blob-morph-2 11s ease-in-out infinite reverse; opacity: .38; }
  .ai-visual--speaking .ai-blob-1 { animation-duration: 3.2s; }
  .ai-visual--speaking .ai-blob-2 { animation-duration: 3.8s; }

  .ai-sphere {
    position: relative; width: 72%; aspect-ratio: 1; overflow: hidden; border-radius: 50%;
    background:
      radial-gradient(circle at 36% 28%, rgba(255,255,255,.62), transparent 8%),
      radial-gradient(circle at 38% 35%, color-mix(in srgb, var(--orb-a) 80%, white), transparent 30%),
      radial-gradient(circle at 68% 72%, var(--orb-b), #090b18 70%);
    box-shadow:
      inset -24px -25px 42px rgba(0,0,0,.42),
      inset 11px 10px 24px rgba(255,255,255,.09),
      0 0 calc(48px + var(--speak-energy) * 46px) color-mix(in srgb, var(--orb-a) calc(20% + var(--speak-energy) * 30%), transparent);
    transition: background 700ms ease, box-shadow 120ms linear;
    animation: ai-sphere-breathe 4.8s ease-in-out infinite;
  }
  .ai-sphere-highlight { position: absolute; top: 16%; left: 23%; width: 27%; height: 13%; border-radius: 50%; background: rgba(255,255,255,.24); filter: blur(6px); transform: rotate(-20deg); }
  .ai-core {
    position: absolute; inset: 45%; border-radius: 50%; background: rgba(255,255,255,.88);
    box-shadow: 0 0 16px var(--orb-a); opacity: .7;
    filter: brightness(calc(1 + var(--speak-energy) * .6));
    animation: ai-core-pulse 2.4s ease-in-out infinite;
  }

  .ai-response-wave { position: absolute; z-index: 3; bottom: 110px; display: flex; align-items: center; gap: 5px; height: 18px; }
  .ai-response-wave i { width: 2px; height: 3px; border-radius: 999px; background: var(--orb-a); opacity: .28; animation: ai-wave 1.8s ease-in-out infinite; }
  .ai-response-wave i:nth-child(2n) { animation-delay: -.25s; }
  .ai-response-wave i:nth-child(3n) { animation-delay: -.55s; }
  .ai-visual--speaking .ai-response-wave i { animation-duration: .72s; opacity: .72; }
  .ai-visual--listening.is-voice-active .ai-response-wave i { animation-duration: .58s; opacity: .62; }
  .ai-visual--thinking .ai-response-wave i { animation-duration: 1.1s; }

  .ai-state-copy { position: absolute; z-index: 3; bottom: 56px; left: 50%; width: min(420px, 72%); transform: translateX(-50%); text-align: center; }
  .ai-state-title { display: inline-flex; align-items: center; gap: 9px; color: #f8fafc; font: 750 15px Manrope, sans-serif; letter-spacing: .01em; }
  .ai-state-title i, .assistant-status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--orb-a, #67e8f9); box-shadow: 0 0 14px var(--orb-a, #67e8f9); animation: ai-dot 1.8s ease-in-out infinite; }
  .ai-state-detail { margin-top: 7px; color: #8fa0bc; font-size: 12px; animation: ai-copy-in .45s ease both; }

  .ai-visual--speaking .ai-sphere, .ai-visual--listening.is-voice-active .ai-sphere { animation-duration: 2.3s; }

  @keyframes ai-sphere-breathe { 0%,100% { transform: scale(.98); filter: saturate(.9) brightness(.94); } 50% { transform: scale(1.025); filter: saturate(1.08) brightness(1.05); } }
  @keyframes ai-core-pulse { 0%,100% { scale: .78; opacity: .5; } 50% { scale: 1.08; opacity: .85; } }
  @keyframes ai-wave { 0%,100% { height: 3px; } 50% { height: 12px; } }
  @keyframes ai-dot { 50% { opacity: .35; scale: .72; } }
  @keyframes ai-copy-in { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }

  @keyframes ai-blob-morph-1 {
    0%, 100% { border-radius: 42% 58% 70% 30% / 45% 45% 55% 55%; transform: rotate(0deg) scale(1); }
    33%      { border-radius: 60% 40% 35% 65% / 55% 65% 35% 45%; transform: rotate(9deg) scale(1.06); }
    66%      { border-radius: 35% 65% 55% 45% / 40% 30% 70% 60%; transform: rotate(-7deg) scale(.96); }
  }
  @keyframes ai-blob-morph-2 {
    0%, 100% { border-radius: 55% 45% 40% 60% / 60% 35% 65% 40%; transform: rotate(0deg) scale(1); }
    50%      { border-radius: 38% 62% 65% 35% / 42% 58% 42% 58%; transform: rotate(-11deg) scale(1.08); }
  }

  @media (prefers-reduced-motion: reduce) {
    .ai-visual * { animation: none !important; }
    .ai-state-detail { animation: none !important; }
    .ai-stage, .ai-ambient, .ai-sphere { transition: none !important; }
  }

  .avatar-overlay {
    pointer-events: none;
    position: absolute; inset: 0; z-index: 2;
    background: linear-gradient(to top, rgba(0, 0, 0, .72), transparent 38%, rgba(0, 0, 0, .20));
  }

  .identity { position: absolute; z-index: 3; top: 30px; left: 30px; gap: 14px; }

  .identity-icon {
    display: grid; width: 50px; height: 50px; place-items: center;
    border: 1px solid rgba(255, 255, 255, .13);
    border-radius: 999px;
    background: rgba(255, 255, 255, .08);
    color: var(--orange);
    font: 900 20px Manrope, sans-serif;
    backdrop-filter: blur(18px);
  }

  .identity strong { display: block; font: 700 18px Manrope, sans-serif; }
  .identity span { display: block; color: #cbd5e1; font-size: 12px; letter-spacing: .28em; text-transform: uppercase; }

  .status-pill {
    position: absolute; z-index: 3; top: 30px; right: 30px; gap: 10px;
    border: 1px solid rgba(255, 255, 255, .1);
    border-radius: 999px;
    background: rgba(0, 0, 0, .46);
    padding: 10px 14px;
    color: rgba(255, 255, 255, .82);
    font-size: 12px; letter-spacing: .25em; text-transform: uppercase;
    backdrop-filter: blur(18px);
  }

  .red-dot { width: 10px; height: 10px; border-radius: 999px; background: var(--orange); }
  .assistant-status { --assistant-status-color: #67e8f9; }
  .assistant-status--listening { --assistant-status-color: #d4ff00; }
  .assistant-status--thinking { --assistant-status-color: #a78bfa; }
  .assistant-status--speaking { --assistant-status-color: #f95738; }
  .assistant-status--complete { --assistant-status-color: #34d399; }
  .assistant-status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--assistant-status-color); box-shadow: 0 0 14px var(--assistant-status-color); animation: ai-dot 1.8s ease-in-out infinite; }

  .listen-card {
    position: absolute; z-index: 3; right: 30px; bottom: 30px; left: 30px;
    display: flex; align-items: center; justify-content: space-between; gap: 18px;
    border: 1px solid rgba(255, 255, 255, .1);
    border-radius: 18px;
    background: rgba(0, 0, 0, .58);
    padding: 18px 28px;
    backdrop-filter: blur(24px);
  }

  .wave { display: flex; align-items: center; gap: 4px; }
  .wave i { width: 4px; height: 4px; border-radius: 999px; background: var(--orange); animation: pulse 1s infinite ease-in-out; }
  .wave i:nth-child(2) { animation-delay: .08s; }
  .wave i:nth-child(3) { animation-delay: .16s; }
  .wave i:nth-child(4) { animation-delay: .24s; }
  .wave i:nth-child(5) { animation-delay: .32s; }
  .wave i:nth-child(6) { animation-delay: .40s; }

  @keyframes pulse { 50% { height: 14px; } }

  .listen-copy strong { display: block; font: 700 15px Manrope, sans-serif; }
  .listen-copy span, .hd-audio { color: #94a3b8; font-size: 12px; }
  .listen-copy span { display: block; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .hd-audio { display: flex; flex: 0 0 auto; align-items: center; gap: 10px; letter-spacing: .28em; text-transform: uppercase; }
  .hd-audio i { width: 7px; height: 7px; border-radius: 999px; background: var(--lime); }

  .right-stack { display: grid; min-height: 0; grid-template-rows: minmax(0, 1fr); gap: 30px; }

  /* Candidate camera = small picture-in-picture in the bottom-right corner of
     Lina's avatar panel (Google-Meet style), so the right column is entirely
     free for the question text. */
  .candidate-panel {
    position: absolute; z-index: 4; right: 22px; bottom: 22px;
    width: clamp(168px, 19vw, 248px); aspect-ratio: 16 / 10;
    overflow: hidden; border-radius: 16px; background: #020617;
    border: 1px solid rgba(255, 255, 255, .2);
    box-shadow: 0 12px 34px rgba(0, 0, 0, .55);
    transition: box-shadow .12s ease, border-color .12s ease;
  }
  .candidate-panel .you-pill { top: 8px; left: 8px; padding: 4px 9px; font-size: 10px; letter-spacing: .16em; }
  .candidate-panel .candidate-footer { padding: 8px 10px; }

  /* Lights up while the candidate's own voice is actually detected — see the
     AnalyserNode-based check in page.tsx. Answers "is my mic picking me up?". */
  .candidate-panel.speaking {
    border-color: var(--lime);
    box-shadow: 0 12px 34px rgba(0, 0, 0, .55), 0 0 0 3px rgba(212, 255, 0, .45), 0 0 22px rgba(212, 255, 0, .35);
  }

  /* Demo/debug-only live-caption strip — proves browser STT is actually hearing
     the candidate, in real time, instead of only finding out after the report
     comes back with an empty transcript. */
  .stt-debug-bar {
    position: absolute; z-index: 5; left: 22px; right: 22px; bottom: 22px;
    max-width: 60%;
    display: flex; align-items: center; gap: 9px;
    background: rgba(0, 0, 0, .6); border: 1px solid var(--line);
    border-radius: 10px; padding: 8px 14px;
    color: #e5e7eb; font-size: 12.5px; line-height: 1.3;
    backdrop-filter: blur(6px);
  }
  .stt-dot { flex-shrink: 0; width: 8px; height: 8px; border-radius: 999px; background: #64748b; }
  .stt-dot.stt-listening { background: var(--lime); box-shadow: 0 0 8px rgba(212, 255, 0, .7); }
  .stt-dot.stt-unavailable { background: #fbbf24; }
  .stt-dot.stt-error, .stt-dot.stt-unsupported { background: var(--orange); }

  .candidate-video {
    position: absolute; inset: 0; width: 100%; height: 100%;
    object-fit: cover; transform: scaleX(-1);
    transition: opacity .25s ease;
  }

  .cam-off {
    position: absolute; inset: 0; z-index: 2; display: grid; place-items: center;
    color: #64748b; font: 600 13px Manrope, sans-serif; letter-spacing: .2em; text-transform: uppercase;
  }

  .you-pill {
    position: absolute; z-index: 3; top: 16px; left: 16px; gap: 9px;
    border-radius: 999px; background: rgba(0, 0, 0, .48); padding: 7px 14px;
    color: #e5e7eb; font-size: 12px; letter-spacing: .22em; text-transform: uppercase;
  }
  .you-pill i { width: 8px; height: 8px; border-radius: 999px; background: var(--lime); }

  .candidate-footer {
    position: absolute; right: 0; bottom: 0; left: 0; z-index: 3;
    display: flex; align-items: end; justify-content: space-between; padding: 18px;
    background: linear-gradient(to top, rgba(0, 0, 0, .58), transparent);
  }

  .mini-bars { display: grid; grid-template-columns: repeat(5, 3px); align-items: end; gap: 4px; height: 30px; }
  .mini-bars i { width: 3px; background: #cbd5e1; }
  .mini-bars i:nth-child(1) { height: 13px; }
  .mini-bars i:nth-child(2) { height: 22px; }
  .mini-bars i:nth-child(3) { height: 28px; }
  .mini-bars i:nth-child(4) { height: 18px; }
  .mini-bars i:nth-child(5) { height: 24px; }

  .mic { display: grid; width: 38px; height: 38px; place-items: center; border-radius: 999px; background: rgba(0, 0, 0, .55); }

  .question-card { border-radius: 20px; padding: 24px 34px; display: flex; flex-direction: column; min-height: 0; }
  .question-top { display: flex; align-items: center; justify-content: flex-end; gap: 18px; margin-bottom: 16px; flex: 0 0 auto; }
  /* h2 grows to fill the now full-height right column and scrolls if the question
     is very long, so the COMPLETE question is shown rather than a clipped end. */
  .question-card h2 { margin: 0; flex: 1 1 auto; min-height: 0; font: 700 clamp(16px, 1.1vw, 20px) Manrope, sans-serif; line-height: 1.5; letter-spacing: -.01em; overflow-wrap: break-word; overflow-y: auto; }
  .question-meta { color: #778195; font-size: 12px; letter-spacing: .28em; text-transform: uppercase; margin-top: 10px; }

  .tag {
    border: 1px solid rgba(249, 87, 56, .4); border-radius: 999px; color: var(--orange);
    padding: 6px 12px; font-size: 11px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase;
    white-space: normal; text-align: right; max-width: 60%;
  }

  .question-card p { margin: 20px 0 0; border-top: 1px solid rgba(255, 255, 255, .07); padding-top: 18px; color: #94a3b8; font-size: 15px; }
  .question-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px; }

  .circle-btn, .next-btn { border: 1px solid rgba(255, 255, 255, .08); color: #fff; cursor: pointer; }
  .circle-btn { width: 46px; height: 46px; border-radius: 999px; background: rgba(255, 255, 255, .03); }
  .circle-btn:disabled { opacity: .35; cursor: not-allowed; }
  .next-btn { border-color: rgba(249, 87, 56, .42); border-radius: 999px; background: rgba(249, 87, 56, .18); padding: 0 24px; color: var(--orange); font-weight: 800; letter-spacing: .08em; }

  .controlbar {
    display: flex; height: 78px; align-items: center; justify-content: space-between;
    border-top: 1px solid rgba(255, 255, 255, .05);
    background: rgba(0, 0, 0, .38);
    padding: 0 180px 0 32px;
    backdrop-filter: blur(18px);
  }

  .control-time { display: flex; align-items: center; gap: 12px; color: #fff; font: 700 14px Manrope, sans-serif; }
  .elapsed-label { color: #64748b; font-size: 11px; letter-spacing: .24em; text-transform: uppercase; }

  .control-actions { display: flex; align-items: center; gap: 12px; }
  .control-actions button {
    width: 50px; height: 50px; border: 1px solid rgba(255, 255, 255, .14); border-radius: 999px;
    background: rgba(255, 255, 255, .06); color: #fff; cursor: pointer; font-size: 18px;
  }
  .control-actions button.muted { background: rgba(249, 87, 56, .14); border-color: rgba(249,87,56,.4); color: var(--orange); }
  .control-actions .end { width: 58px; background: rgba(249, 87, 56, .2); color: var(--orange); }

  /* ===== Pre-interview permission gate ===== */
  .gate {
    position: fixed; inset: 0; z-index: 9999;
    display: flex; overflow-y: auto;
    background: #0a0f1a; padding: 24px;
    color: #e2e8f0; font-family: "IBM Plex Sans", system-ui, sans-serif;
  }
  /* margin:auto centers the card when it fits, but still allows scrolling (the
     top isn't clipped) when the card is taller than the viewport — e.g. the
     five-checkbox consent gate, whose "I do not consent" button was cut off. */
  .gate-card { width: 100%; max-width: 560px; margin: auto; }
  .gate-eyebrow { margin: 0; color: #67e8f9; font-size: 12px; letter-spacing: .35em; text-transform: uppercase; text-align: center; }
  .gate-title { margin: 18px 0 0; font: 900 30px Manrope, sans-serif; text-align: center; }
  .gate-sub { margin: 12px 0 0; color: #94a3b8; font-size: 14px; line-height: 1.6; text-align: center; }
  .gate-checks { margin-top: 28px; display: grid; gap: 12px; border: 1px solid rgba(255,255,255,.1); border-radius: 18px; background: rgba(255,255,255,.04); padding: 16px; }
  .gate-check { display: flex; align-items: center; justify-content: space-between; gap: 16px; border-radius: 14px; background: rgba(2,6,23,.7); padding: 14px 16px; }
  .gate-check-l { display: flex; align-items: center; gap: 12px; }
  .gate-check-label { margin: 0; font-size: 14px; font-weight: 600; }
  .gate-check-detail { margin: 2px 0 0; font-size: 12px; color: #94a3b8; }
  .ok-ico { color: #6ee7b7; }
  .wait-ico { color: #67e8f9; }
  .bad-ico { color: #f87171; }
  .gate-check-detail.is-bad { color: #fca5a5; }
  .gate-dot { width: 10px; height: 10px; border-radius: 999px; }
  .gate-dot.is-ok { background: #34d399; }
  .gate-dot.is-wait { background: #fbbf24; }
  .gate-dot.is-bad { background: #f87171; }
  .gate-btn {
    margin-top: 24px; width: 100%;
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    border: 0; border-radius: 14px; background: #67e8f9; color: #020617;
    padding: 14px; font: 800 14px Manrope, sans-serif; cursor: pointer;
    box-shadow: 0 0 40px rgba(103,232,249,.18);
  }
  .gate-error { margin-top: 16px; text-align: center; font-size: 14px; color: #fecdd3; }
  .gate-spinner {
    width: 36px; height: 36px; margin: 0 auto 4px;
    border-radius: 999px;
    border: 3px solid rgba(255,255,255,.12);
    border-top-color: #67e8f9;
    animation: gate-spin .8s linear infinite;
  }
  @keyframes gate-spin { to { transform: rotate(360deg); } }

  /* ===== Informed-consent gate (polished) ===== */
  .consent-card { max-width: 600px; }
  .consent-badge {
    width: 54px; height: 54px; margin: 0 auto; border-radius: 16px;
    display: grid; place-items: center; color: #67e8f9;
    background: linear-gradient(150deg, rgba(103,232,249,.20), rgba(52,211,153,.12));
    border: 1px solid rgba(103,232,249,.35);
    box-shadow: 0 12px 34px rgba(103,232,249,.18), inset 0 1px 0 rgba(255,255,255,.12);
  }
  .consent-list { margin-top: 24px; display: grid; gap: 10px; text-align: left; }
  .consent-item {
    position: relative; display: flex; align-items: flex-start; gap: 14px;
    padding: 15px 16px; border-radius: 16px; cursor: pointer;
    background: rgba(255,255,255,.035); border: 1px solid rgba(255,255,255,.08);
    transition: border-color .18s ease, background .18s ease, box-shadow .18s ease, transform .06s ease;
  }
  .consent-item:hover { border-color: rgba(103,232,249,.35); background: rgba(255,255,255,.055); }
  .consent-item:active { transform: scale(.995); }
  .consent-item.is-on {
    border-color: rgba(52,211,153,.5); background: rgba(52,211,153,.09);
    box-shadow: 0 8px 24px rgba(52,211,153,.14);
  }
  .consent-native { position: absolute; opacity: 0; width: 0; height: 0; margin: 0; }
  .consent-box {
    flex: 0 0 auto; width: 22px; height: 22px; margin-top: 1px; border-radius: 7px;
    display: grid; place-items: center; color: #04121a;
    border: 1.5px solid rgba(255,255,255,.28); background: rgba(2,6,23,.55);
    transition: background .18s ease, border-color .18s ease, box-shadow .18s ease;
  }
  .consent-box > svg { opacity: 0; transform: scale(.55); transition: opacity .18s ease, transform .18s ease; }
  .consent-item.is-on .consent-box {
    background: linear-gradient(145deg, #67e8f9, #34d399); border-color: transparent;
    box-shadow: 0 4px 14px rgba(52,211,153,.4);
  }
  .consent-item.is-on .consent-box > svg { opacity: 1; transform: scale(1); }
  .consent-native:focus-visible + .consent-box { outline: 2px solid #67e8f9; outline-offset: 2px; }
  .consent-text { display: grid; gap: 3px; }
  .consent-title { font-size: 14px; font-weight: 600; color: #e8eefc; line-height: 1.4; }
  .consent-detail { font-size: 12.5px; color: #93a4c3; line-height: 1.5; }
  .consent-link { color: #67e8f9; text-decoration: underline; text-underline-offset: 2px; }
  .consent-link:hover { color: #a5f3fc; }
  .consent-all {
    margin-top: 4px;
    background: linear-gradient(135deg, rgba(52,211,153,.12), rgba(103,232,249,.06));
    border-color: rgba(52,211,153,.32);
  }
  .consent-all .consent-title { font-weight: 750; }
  .consent-actions { margin-top: 24px; display: grid; gap: 10px; }
  .consent-agree {
    width: 100%; display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    border: 0; border-radius: 14px; padding: 15px; color: #04121a;
    font: 800 14px Manrope, sans-serif; letter-spacing: .01em; cursor: pointer;
    background: linear-gradient(135deg, #67e8f9, #34d399);
    box-shadow: 0 12px 30px rgba(52,211,153,.28);
    transition: transform .06s ease, box-shadow .2s ease, opacity .2s ease;
  }
  .consent-agree:hover:not(:disabled) { box-shadow: 0 16px 42px rgba(52,211,153,.42); }
  .consent-agree:active:not(:disabled) { transform: translateY(1px); }
  .consent-agree:disabled { opacity: .45; cursor: not-allowed; box-shadow: none; }
  .consent-decline {
    width: 100%; display: inline-flex; align-items: center; justify-content: center;
    border: 1px solid rgba(255,255,255,.16); border-radius: 14px; padding: 13px;
    font: 700 13px Manrope, sans-serif; color: #9fb2d4; background: transparent; cursor: pointer;
    transition: color .18s ease, border-color .18s ease, background .18s ease;
  }
  .consent-decline:hover { color: #e2e8f0; border-color: rgba(255,255,255,.3); background: rgba(255,255,255,.03); }
  .consent-fineprint { margin: 16px 2px 0; text-align: center; font-size: 11.5px; color: #6b7a99; line-height: 1.5; }

  /* ===== Proctoring debug overlay ===== */
  .debug-toggle {
    margin-left: 14px;
    border: 1px solid rgba(255,255,255,.16);
    border-radius: 999px;
    background: rgba(255,255,255,.05);
    color: #cbd5e1;
    padding: 5px 12px;
    font: 700 11px Manrope, sans-serif;
    letter-spacing: .08em;
    cursor: pointer;
  }
  .debug-toggle:hover { background: rgba(255,255,255,.1); color: #fff; }

  .debug-panel {
    position: fixed;
    top: 16px;
    right: 16px;
    bottom: 16px;
    z-index: 9998;
    width: 380px;
    max-width: calc(100vw - 32px);
    display: flex;
    flex-direction: column;
    gap: 10px;
    border: 1px solid rgba(212,255,0,.25);
    border-radius: 18px;
    background: rgba(8,9,13,.94);
    box-shadow: 0 30px 90px rgba(0,0,0,.6);
    padding: 16px;
    overflow: auto;
    backdrop-filter: blur(20px);
    font-family: "IBM Plex Sans", system-ui, sans-serif;
  }
  .debug-head { display: flex; align-items: center; justify-content: space-between; }
  .debug-head strong { font: 800 14px Manrope, sans-serif; color: #d4ff00; letter-spacing: .04em; }
  .debug-head button { border: 0; background: rgba(255,255,255,.08); color: #fff; width: 26px; height: 26px; border-radius: 8px; cursor: pointer; }
  .debug-section-title { margin-top: 6px; color: #74829b; font: 700 10px Manrope, sans-serif; letter-spacing: .26em; text-transform: uppercase; }
  .debug-grid { display: grid; gap: 4px; }
  .debug-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; border-radius: 8px; background: rgba(255,255,255,.03); padding: 6px 10px; }
  .debug-row-k { display: flex; align-items: center; gap: 7px; font-size: 12px; color: #cbd5e1; }
  .debug-row-v { font: 600 11px "IBM Plex Sans", monospace; color: #fff; text-align: right; word-break: break-word; max-width: 200px; }
  .debug-dot { width: 8px; height: 8px; border-radius: 999px; flex: 0 0 auto; }
  .debug-dot.is-ok { background: #34d399; }
  .debug-dot.is-bad { background: #f95738; }
  .debug-events { display: grid; gap: 6px; }
  .debug-event { border-radius: 8px; border-left: 3px solid #64748b; background: rgba(255,255,255,.03); padding: 7px 10px; }
  .debug-event.sev-high, .debug-event.sev-critical { border-left-color: #f95738; }
  .debug-event.sev-medium { border-left-color: #fbbf24; }
  .debug-event.sev-low { border-left-color: #34d399; }
  .debug-event-type { display: inline-block; font: 700 11px Manrope, sans-serif; color: #fff; }
  .debug-event-sev { float: right; font-size: 10px; color: #94a3b8; letter-spacing: .1em; }
  .debug-event-meta { margin: 4px 0 0; font-size: 10px; color: #64748b; white-space: pre-wrap; word-break: break-word; }
  .debug-empty { color: #64748b; font-size: 12px; margin: 4px 0; }
  .debug-foot { margin-top: auto; padding-top: 8px; border-top: 1px solid rgba(255,255,255,.08); color: #64748b; font-size: 11px; }

  @media (max-width: 1100px) {
    .room { position: absolute; height: auto; min-height: 100vh; overflow: visible; }
    .topbar, .content { grid-template-columns: 1fr; }
    .connection { justify-content: flex-start; flex-wrap: wrap; }
    .avatar-panel { min-height: 620px; }
    .controlbar { padding-right: 32px; }
  }
`;
