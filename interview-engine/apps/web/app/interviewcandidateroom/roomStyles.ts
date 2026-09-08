// Styles for the AI Interview Room. Ported verbatim from mockups/interview-page.html
// and extended with the permission gate, live-integrity pill, and live candidate webcam.
export const roomStyles = `
  .room, .room * { box-sizing: border-box; }

  .room {
    --bg: #08090d;
    --panel: #11131a;
    --line: rgba(255, 255, 255, .1);
    --muted: #94a3b8;
    /* Brand colors — same teal + indigo used everywhere else in the product
       (dashboard sidebar, landing page, transactional emails; see
       backend/app/utils/email_sender.py's own brand-color comment). The room
       previously used an unrelated orange/lime "gamer HUD" palette that
       matched nothing else in the app. --danger keeps the old orange hex
       verbatim, since it's still the right color for what it's used for now
       (recording indicator, end-call, mute, alerts) — those are universal
       call-UI conventions (red = recording/hang up/warning), not branding,
       and shouldn't become teal just because the brand pass touched them. */
    --teal: #2dd4bf;
    --indigo: #64a0dc;
    --danger: #f95738;
    position: fixed;
    inset: 0;
    z-index: 40;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: #fff;
    font-family: "IBM Plex Sans", system-ui, sans-serif;
    background:
      radial-gradient(circle at 0 0, rgba(100, 160, 220, .16), transparent 28%),
      radial-gradient(circle at 100% 45%, rgba(45, 212, 191, .10), transparent 26%),
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
    background: linear-gradient(135deg, #2dd4bf, #64a0dc);
    box-shadow: 0 0 40px rgba(45, 212, 191, .28);
    font: 900 18px Manrope, sans-serif;
  }

  .brand-name { font: 800 22px Manrope, sans-serif; letter-spacing: -.03em; }
  .brand-name span { color: var(--teal); }

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
    background: var(--teal);
    box-shadow: 0 0 18px rgba(45, 212, 191, .85);
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
  .integrity.ok { color: var(--teal); border-color: rgba(45,212,191,.3); background: rgba(45,212,191,.08); }
  .integrity.warn { color: #fbbf24; border-color: rgba(251,191,36,.35); background: rgba(251,191,36,.1); }
  .integrity.alert { color: var(--danger); border-color: rgba(249,87,56,.45); background: rgba(249,87,56,.14); }

  .bars {
    display: inline-grid;
    grid-template-columns: repeat(4, 3px);
    align-items: end;
    gap: 3px;
    height: 17px;
  }
  .bars i { display: block; width: 3px; border-radius: 999px; background: var(--teal); }
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

  /* Lina and the candidate each get an equal half of the panel, side by side,
     instead of the candidate camera floating as a small PiP over Lina. */
  .avatar-panel { position: relative; min-height: 0; overflow: hidden; border-radius: 30px; display: flex; }

  .lina-panel { position: relative; flex: 1 1 50%; min-width: 0; overflow: hidden; }

  /* AgentAudioVisualizerAura (LiveKit-audio-driven WebGL shader) replaces the
     legacy CSS blob/sphere/wave visualization entirely (one visual system
     everywhere, no CSS-orb fallback). This is just the sizing/positioning
     wrapper .avatar-panel needs — the aura component owns everything about
     its own rendering. .identity and .candidate-panel still stack above it
     via their own z-index. */
  .orb-stage {
    position: absolute; inset: 0; z-index: 1;
    /* flex (not grid): a flex child's width:100% resolves against .orb-stage's
       own definite box (it fills .lina-panel via inset:0). A single-item
       CSS grid's implicit auto-track sizes to the item's own content instead
       of the container, so the aura's Tailwind w-full/aspect-square combo
       (see AIVisualAssistant.tsx) wouldn't reliably fill the panel there. */
    display: flex; align-items: center; justify-content: center;
    padding: 24px;
    overflow: hidden;
    background:
      radial-gradient(circle at 50% 47%, rgba(45, 212, 191, .055), transparent 32%),
      #060810;
  }
  .orb-stage-orb { display: block; }

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
    color: var(--teal);
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

  .red-dot { width: 10px; height: 10px; border-radius: 999px; background: var(--danger); }

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
  .wave i { width: 4px; height: 4px; border-radius: 999px; background: var(--teal); animation: pulse 1s infinite ease-in-out; }
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
  .hd-audio i { width: 7px; height: 7px; border-radius: 999px; background: var(--teal); }

  .right-stack { display: grid; min-height: 0; grid-template-rows: minmax(0, 1fr); gap: 30px; }

  /* Candidate camera = the other half of the panel, equal size to Lina's side. */
  .candidate-panel {
    position: relative; flex: 1 1 50%; min-width: 0;
    overflow: hidden; background: #020617;
    border-left: 1px solid rgba(255, 255, 255, .14);
    transition: box-shadow .12s ease;
  }

  /* Lights up while the candidate's own voice is actually detected — see the
     AnalyserNode-based check in page.tsx. Answers "is my mic picking me up?". */
  .candidate-panel.speaking {
    box-shadow: inset 0 0 0 3px rgba(45, 212, 191, .45), inset 0 0 26px rgba(45, 212, 191, .3);
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
  .stt-dot.stt-listening { background: var(--teal); box-shadow: 0 0 8px rgba(45, 212, 191, .7); }
  .stt-dot.stt-unavailable { background: #fbbf24; }
  .stt-dot.stt-error, .stt-dot.stt-unsupported { background: var(--danger); }

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
  .you-pill i { width: 8px; height: 8px; border-radius: 999px; background: var(--teal); }

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
    border: 1px solid rgba(100, 160, 220, .4); border-radius: 999px; color: var(--indigo);
    padding: 6px 12px; font-size: 11px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase;
    white-space: normal; text-align: right; max-width: 60%;
  }

  .question-card p { margin: 20px 0 0; border-top: 1px solid rgba(255, 255, 255, .07); padding-top: 18px; color: #94a3b8; font-size: 15px; }
  .question-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px; }

  .circle-btn, .next-btn { border: 1px solid rgba(255, 255, 255, .08); color: #fff; cursor: pointer; }
  .circle-btn { width: 46px; height: 46px; border-radius: 999px; background: rgba(255, 255, 255, .03); }
  .circle-btn:disabled { opacity: .35; cursor: not-allowed; }
  .next-btn { border-color: rgba(45, 212, 191, .42); border-radius: 999px; background: rgba(45, 212, 191, .18); padding: 0 24px; color: var(--teal); font-weight: 800; letter-spacing: .08em; }

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
  .control-actions button.muted { background: rgba(249, 87, 56, .14); border-color: rgba(249,87,56,.4); color: var(--danger); }
  .control-actions .end { width: 58px; background: rgba(249, 87, 56, .2); color: var(--danger); }

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
  .gate-eyebrow { margin: 0; color: #2dd4bf; font-size: 12px; letter-spacing: .35em; text-transform: uppercase; text-align: center; }
  .gate-title { margin: 18px 0 0; font: 900 30px Manrope, sans-serif; text-align: center; }
  .gate-sub { margin: 12px 0 0; color: #94a3b8; font-size: 14px; line-height: 1.6; text-align: center; }
  .gate-checks { margin-top: 28px; display: grid; gap: 12px; border: 1px solid rgba(255,255,255,.1); border-radius: 18px; background: rgba(255,255,255,.04); padding: 16px; }
  .gate-check { display: flex; align-items: center; justify-content: space-between; gap: 16px; border-radius: 14px; background: rgba(2,6,23,.7); padding: 14px 16px; }
  .gate-check-l { display: flex; align-items: center; gap: 12px; }
  .gate-check-label { margin: 0; font-size: 14px; font-weight: 600; }
  .gate-check-detail { margin: 2px 0 0; font-size: 12px; color: #94a3b8; }
  .ok-ico { color: #2dd4bf; }
  .wait-ico { color: #2dd4bf; }
  .bad-ico { color: #f87171; }
  .gate-check-detail.is-bad { color: #fca5a5; }
  .gate-dot { width: 10px; height: 10px; border-radius: 999px; }
  .gate-dot.is-ok { background: #64a0dc; }
  .gate-dot.is-wait { background: #fbbf24; }
  .gate-dot.is-bad { background: #f87171; }
  .gate-btn {
    margin-top: 24px; width: 100%;
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    border: 0; border-radius: 14px; background: #2dd4bf; color: #020617;
    padding: 14px; font: 800 14px Manrope, sans-serif; cursor: pointer;
    box-shadow: 0 0 40px rgba(45,212,191,.18);
  }
  .gate-error { margin-top: 16px; text-align: center; font-size: 14px; color: #fecdd3; }
  .gate-spinner {
    width: 36px; height: 36px; margin: 0 auto 4px;
    border-radius: 999px;
    border: 3px solid rgba(255,255,255,.12);
    border-top-color: #2dd4bf;
    animation: gate-spin .8s linear infinite;
  }
  @keyframes gate-spin { to { transform: rotate(360deg); } }

  /* ===== Informed-consent gate (polished) ===== */
  .consent-card { max-width: 600px; }
  .consent-badge {
    width: 54px; height: 54px; margin: 0 auto; border-radius: 16px;
    display: grid; place-items: center; color: #2dd4bf;
    background: linear-gradient(150deg, rgba(45,212,191,.20), rgba(100,160,220,.12));
    border: 1px solid rgba(45,212,191,.35);
    box-shadow: 0 12px 34px rgba(45,212,191,.18), inset 0 1px 0 rgba(255,255,255,.12);
  }
  .consent-list { margin-top: 24px; display: grid; gap: 10px; text-align: left; }
  .consent-item {
    position: relative; display: flex; align-items: flex-start; gap: 14px;
    padding: 15px 16px; border-radius: 16px; cursor: pointer;
    background: rgba(255,255,255,.035); border: 1px solid rgba(255,255,255,.08);
    transition: border-color .18s ease, background .18s ease, box-shadow .18s ease, transform .06s ease;
  }
  .consent-item:hover { border-color: rgba(45,212,191,.35); background: rgba(255,255,255,.055); }
  .consent-item:active { transform: scale(.995); }
  .consent-item.is-on {
    border-color: rgba(100,160,220,.5); background: rgba(100,160,220,.09);
    box-shadow: 0 8px 24px rgba(100,160,220,.14);
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
    background: linear-gradient(145deg, #2dd4bf, #64a0dc); border-color: transparent;
    box-shadow: 0 4px 14px rgba(100,160,220,.4);
  }
  .consent-item.is-on .consent-box > svg { opacity: 1; transform: scale(1); }
  .consent-native:focus-visible + .consent-box { outline: 2px solid #2dd4bf; outline-offset: 2px; }
  .consent-text { display: grid; gap: 3px; }
  .consent-title { font-size: 14px; font-weight: 600; color: #e8eefc; line-height: 1.4; }
  .consent-detail { font-size: 12.5px; color: #93a4c3; line-height: 1.5; }
  .consent-link { color: #2dd4bf; text-decoration: underline; text-underline-offset: 2px; }
  .consent-link:hover { color: #a5f3fc; }
  .consent-all {
    margin-top: 4px;
    background: linear-gradient(135deg, rgba(100,160,220,.12), rgba(45,212,191,.06));
    border-color: rgba(100,160,220,.32);
  }
  .consent-all .consent-title { font-weight: 750; }
  .consent-actions { margin-top: 24px; display: grid; gap: 10px; }
  .consent-agree {
    width: 100%; display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    border: 0; border-radius: 14px; padding: 15px; color: #04121a;
    font: 800 14px Manrope, sans-serif; letter-spacing: .01em; cursor: pointer;
    background: linear-gradient(135deg, #2dd4bf, #64a0dc);
    box-shadow: 0 12px 30px rgba(100,160,220,.28);
    transition: transform .06s ease, box-shadow .2s ease, opacity .2s ease;
  }
  .consent-agree:hover:not(:disabled) { box-shadow: 0 16px 42px rgba(100,160,220,.42); }
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
    border: 1px solid rgba(45,212,191,.25);
    border-radius: 18px;
    background: rgba(8,9,13,.94);
    box-shadow: 0 30px 90px rgba(0,0,0,.6);
    padding: 16px;
    overflow: auto;
    backdrop-filter: blur(20px);
    font-family: "IBM Plex Sans", system-ui, sans-serif;
  }
  .debug-head { display: flex; align-items: center; justify-content: space-between; }
  .debug-head strong { font: 800 14px Manrope, sans-serif; color: #2dd4bf; letter-spacing: .04em; }
  .debug-head button { border: 0; background: rgba(255,255,255,.08); color: #fff; width: 26px; height: 26px; border-radius: 8px; cursor: pointer; }
  .debug-section-title { margin-top: 6px; color: #74829b; font: 700 10px Manrope, sans-serif; letter-spacing: .26em; text-transform: uppercase; }
  .debug-grid { display: grid; gap: 4px; }
  .debug-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; border-radius: 8px; background: rgba(255,255,255,.03); padding: 6px 10px; }
  .debug-row-k { display: flex; align-items: center; gap: 7px; font-size: 12px; color: #cbd5e1; }
  .debug-row-v { font: 600 11px "IBM Plex Sans", monospace; color: #fff; text-align: right; word-break: break-word; max-width: 200px; }
  .debug-dot { width: 8px; height: 8px; border-radius: 999px; flex: 0 0 auto; }
  .debug-dot.is-ok { background: #64a0dc; }
  .debug-dot.is-bad { background: #f95738; }
  .debug-events { display: grid; gap: 6px; }
  .debug-event { border-radius: 8px; border-left: 3px solid #64748b; background: rgba(255,255,255,.03); padding: 7px 10px; }
  .debug-event.sev-high, .debug-event.sev-critical { border-left-color: #f95738; }
  .debug-event.sev-medium { border-left-color: #fbbf24; }
  .debug-event.sev-low { border-left-color: #64a0dc; }
  .debug-event-type { display: inline-block; font: 700 11px Manrope, sans-serif; color: #fff; }
  .debug-event-sev { float: right; font-size: 10px; color: #94a3b8; letter-spacing: .1em; }
  .debug-event-meta { margin: 4px 0 0; font-size: 10px; color: #64748b; white-space: pre-wrap; word-break: break-word; }
  .debug-empty { color: #64748b; font-size: 12px; margin: 4px 0; }
  .debug-foot { margin-top: auto; padding-top: 8px; border-top: 1px solid rgba(255,255,255,.08); color: #64748b; font-size: 11px; }

  @media (max-width: 1100px) {
    .room { position: absolute; height: auto; min-height: 100vh; overflow: visible; }
    .topbar, .content { grid-template-columns: 1fr; }
    /* .content's flex:1 (flex-basis:0) assumes .room has a definite height to
       flex against — true in the default position:fixed/inset:0 layout, but
       .room switches to height:auto right above so the page can grow/scroll
       naturally. Left as flex:1, .content's own box came out SHORTER than
       .avatar-panel's min-height (measured: content ~427px vs avatar-panel's
       460px min-height), so avatar-panel silently overflowed past .content's
       bottom edge and visually collided with .controlbar below it. flex:none
       makes .content size to its actual children again. */
    .content { flex: none; }
    .connection { justify-content: flex-start; flex-wrap: wrap; }
    .avatar-panel { min-height: 620px; flex-direction: column; }
    .candidate-panel { border-left: none; border-top: 1px solid rgba(255, 255, 255, .14); }
    .controlbar { padding-right: 32px; }
  }

  /* Phone redesign (≤640px) — a real header/scroll/footer layout, not a
     shrink-everything-and-hope-it-fits patch. The previous version kept
     .room's ≤1100px 'position: absolute; overflow: visible' and just wrapped
     .controlbar's contents — but position:absolute (and position:fixed, the
     default) both take an element out of normal document flow for height
     purposes, so once wrapped content pushed .room's total height past the
     viewport, there was no scrollbar anywhere that could reach the
     overflow: .control-actions (mic/camera/end-call — the buttons a
     candidate actually needs mid-call) rendered a few pixels below the
     visible viewport edge with zero way to scroll to them. Verified via a
     real 375×812 render before writing this rule.
     Fix: .room becomes a real flex column with a fixed-height header, a
     FLEXIBLE + SCROLLABLE middle (min-height:0 is what makes flex-basis:0
     actually shrink instead of overflowing), and a footer that never
     shrinks — the same structural pattern every mobile call UI (Meet, Zoom)
     uses so the call controls are physically guaranteed to stay on screen
     no matter how tall the middle content gets. */
  @media (max-width: 640px) {
    .room {
      position: fixed;
      inset: 0;
      height: 100dvh; /* not 100vh — accounts for mobile browser chrome
                          showing/hiding, which 100vh does not */
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    /* Condensed single-row header: logo + stage name + status, everything
       that isn't essential mid-call (the "AI INTERVIEW ROOM" eyebrow, the
       "Round 1"/"5-min check-in" sub-label, the live connection-quality
       bars/text) is dropped rather than squeezed, since none of it is
       actionable — the candidate can't do anything with "Excellent
       connection" beyond seeing the dot/pill. */
    .topbar {
      height: auto;
      min-height: 0;
      flex: 0 0 auto;
      display: flex;
      flex-wrap: nowrap;
      grid-template-columns: none;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 10px 12px;
    }
    .brand { gap: 8px; min-width: 0; flex: 0 1 auto; }
    .logo { width: 32px; height: 32px; font-size: 14px; flex-shrink: 0; }
    .brand-name { font-size: 15px; white-space: nowrap; }
    .room-label { display: none; }
    .job-pill {
      min-width: 0; width: auto; flex: 1 1 auto; justify-content: flex-start;
      padding: 6px 12px; gap: 8px; overflow: hidden;
    }
    .job-pill strong { font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .job-pill span { display: none; }
    .connection { gap: 6px; flex: 0 0 auto; justify-content: flex-end; }
    .connection-text, .bars { display: none; }
    .integrity { padding: 5px 9px; font-size: 10.5px; gap: 4px; }
    .timer { padding: 6px 10px; font-size: 12px; }

    /* The scrollable middle. flex-basis:0 + min-height:0 is load-bearing —
       without min-height:0 a flex item won't shrink below its content's
       natural size, which is exactly the bug being fixed here. */
    .content {
      flex: 1 1 0;
      min-height: 0;
      overflow-y: auto;
      padding: 10px;
      gap: 10px;
    }
    .avatar-panel { min-height: 100%; border-radius: 20px; }

    .identity { top: 14px; left: 14px; gap: 8px; }
    .identity-icon { width: 36px; height: 36px; font-size: 15px; }
    .identity strong { font-size: 14px; }
    .you-pill { top: 10px; left: 10px; padding: 6px 11px; font-size: 11px; }

    .listen-card { left: 14px; right: 14px; bottom: 14px; padding: 12px 16px; gap: 10px; }
    .listen-copy span { max-width: 46vw; }

    /* The footer: fixed height, never wraps, never shrinks. This is what
       guarantees the buttons stay on screen — not a height/padding guess. */
    .controlbar {
      flex: 0 0 auto;
      height: 64px;
      padding: 0 12px;
      gap: 8px;
    }
    .control-time { gap: 6px; min-width: 0; overflow: hidden; }
    .elapsed-label { font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 30vw; }
    .debug-toggle { padding: 4px 7px; font-size: 9px; margin-left: 4px; flex-shrink: 0; }
    .control-actions { gap: 10px; flex-shrink: 0; }
    .control-actions button { width: 46px; height: 46px; font-size: 17px; }
    .control-actions .end { width: 52px; }

    .gate { padding: 16px; }
    .gate-title { font-size: 24px; }
  }
`;
