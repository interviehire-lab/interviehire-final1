'use client';
// Pre-interview lobby / barrier. Shown when a session has a scheduledAt that is
// still in the future (beyond the early-entry allowance). It holds the candidate
// behind a live countdown + an auto-advancing "how the room works" slideshow —
// like a game's loading screen — and unlocks itself into the normal permission
// gate the instant the entry time is reached (the parent re-renders on its tick).
//
// This is the UX half of the barrier; the engine's POST /sessions/:id/start also
// rejects an early start with { code: 'TOO_EARLY' } so the lock can't be bypassed
// by editing client JS. unlockAtMs (passed in as a prop) is computed by the
// parent from the shared EARLY_ENTRY_MS constant (@interviehire/shared).
import { useEffect, useState } from 'react';

type Brand = { name?: string; primaryColor?: string; logoUrl?: string; whiteLabel?: boolean } | null;

// The tour spotlights ONE real screenshot of the room (public/guide/room.png):
// each slide shows the full room with everything dimmed except `focus` — the
// rectangle (in % of the image) it is describing — outlined with a glowing
// border. `art` is the emoji fallback shown if the screenshot fails to load.
type Focus = { top: number; left: number; width: number; height: number };
type Slide = { badge: string; title: string; body: string; art: string; focus?: Focus };

// Full-screenshot of the interview room. Regions below are tuned to this layout;
// if you replace the image, re-check the `focus` rects.
const ROOM_IMAGE = '/guide/room.png';

const SLIDES: Slide[] = [
  {
    badge: 'The interview room',
    title: 'A quick tour before you begin',
    body: 'Your interview happens right here on one screen: your AI interviewer on the left, the current question on the right, and your camera and controls along the bottom. Here’s what each part does.',
    art: '🗺️',
    // No focus → the whole room is shown, undimmed, as an overview.
  },
  {
    badge: 'On the left',
    title: 'Lina, your AI interviewer',
    body: 'The big panel is Lina — a live AI avatar who asks the questions out loud and listens to your reply. Just speak naturally when she finishes; if you’d rather type, press Enter to open the text box. The “LIVE” badge means she’s hearing you.',
    art: '🧑‍💼',
    focus: { top: 15, left: 2, width: 61, height: 76 },
  },
  {
    badge: 'On the right',
    title: 'The question card',
    body: 'Every question appears here in text with its topic (e.g. “Data Structures”), a difficulty hint, and a counter like “Question 01/04”. Use ‹ and NEXT › to move between questions at your own pace — nothing is timed per question.',
    art: '❓',
    focus: { top: 15, left: 65, width: 33, height: 76 },
  },
  {
    badge: 'Bottom-right tile',
    title: 'Your camera & microphone',
    body: 'The small “YOU” tile is your live webcam so you can see yourself. Before the interview you’ll grant camera + screen-share access and do a short gaze calibration — this only takes a moment and keeps everything verified.',
    art: '🎥',
    focus: { top: 66, left: 45, width: 18, height: 23 },
  },
  {
    badge: 'Top bar',
    title: 'Connection & fair-play monitoring',
    body: 'The top strip shows your role, connection quality and a running timer. The shield badge means the session is proctored — please stay on this tab and keep your eyes on the screen. Switching tabs or looking away is flagged.',
    art: '🛡️',
    focus: { top: 1, left: 0, width: 100, height: 12 },
  },
  {
    badge: 'Bottom controls',
    title: 'Controls & finishing up',
    body: 'Along the bottom you can toggle your headphones, microphone and camera. When you’re done, press the red end-call button. Your transcript is captured automatically and your report is generated — no copying or pasting needed.',
    art: '📞',
    focus: { top: 91, left: 0, width: 100, height: 9 },
  },
];

const SLIDE_MS = 6000;

function pad(n: number) {
  return String(n).padStart(2, '0');
}

export function WaitingRoom({
  scheduledAtMs,
  unlockAtMs,
  nowMs,
  brand,
}: {
  scheduledAtMs: number;
  unlockAtMs: number;
  nowMs: number;
  brand: Brand;
}) {
  const [slide, setSlide] = useState(0);
  // One-way fallback: if the room screenshot can't load, every slide shows its
  // emoji instead of a broken image, so the tour still reads cleanly.
  const [imgOk, setImgOk] = useState(true);

  // Auto-advance the tour; pausing is not needed — dots let them jump manually.
  useEffect(() => {
    const id = setInterval(() => setSlide((s) => (s + 1) % SLIDES.length), SLIDE_MS);
    return () => clearInterval(id);
  }, []);

  const remaining = Math.max(0, unlockAtMs - nowMs);
  const totalSec = Math.floor(remaining / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  const accent = (brand?.whiteLabel && brand?.primaryColor) || '#67e8f9';
  const wl = !!(brand?.whiteLabel && brand?.name);

  // Interview scheduling is IST (Asia/Kolkata) app-wide — show it in IST regardless
  // of the candidate's own device/browser timezone, not the candidate's local time.
  const slotLabel = new Date(scheduledAtMs).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }) + ' IST';

  const s = SLIDES[slide];

  return (
    <div className="lobby">
      <style>{lobbyStyles(accent)}</style>

      <div className="lobby-inner">
        {/* Left: identity + countdown */}
        <div className="lobby-left">
          <div className="lobby-brand">
            <div className="lobby-logo">
              {wl && brand?.logoUrl ? <img src={brand.logoUrl} alt="" /> : '✦'}
            </div>
            <div className="lobby-brand-name">
              {wl ? brand?.name : <>Intervie<span>Hire</span></>}
            </div>
          </div>

          <p className="lobby-eyebrow">Interview lobby</p>
          <h1 className="lobby-title">Your interview isn’t open just yet</h1>
          <p className="lobby-sub">
            You’re early — nice. This room unlocks automatically at your scheduled time.
            Keep this tab open; the guide on the right walks you through everything while you wait.
          </p>

          <div className="lobby-count" aria-live="polite">
            {days > 0 && (
              <div className="lobby-unit">
                <b>{days}</b>
                <span>days</span>
              </div>
            )}
            <div className="lobby-unit">
              <b>{pad(hours)}</b>
              <span>hrs</span>
            </div>
            <div className="lobby-unit">
              <b>{pad(mins)}</b>
              <span>min</span>
            </div>
            <div className="lobby-unit">
              <b>{pad(secs)}</b>
              <span>sec</span>
            </div>
          </div>
          <p className="lobby-slot">
            Scheduled for <strong>{slotLabel}</strong>
            <br />
            <span>Doors open a few minutes before — you don’t need to refresh.</span>
          </p>
        </div>

        {/* Right: auto-advancing UI tour */}
        <div className="lobby-right">
          <div className="tour-badge">{s.badge}</div>
          <div className="tour-art" key={slide}>
            {imgOk ? (
              <div className="tour-shot">
                <img src={ROOM_IMAGE} alt={s.title} onError={() => setImgOk(false)} />
                {s.focus && (
                  <div
                    className="tour-spot"
                    style={{
                      top: `${s.focus.top}%`,
                      left: `${s.focus.left}%`,
                      width: `${s.focus.width}%`,
                      height: `${s.focus.height}%`,
                    }}
                  />
                )}
              </div>
            ) : (
              <span className="tour-emoji">{s.art}</span>
            )}
          </div>
          <h2 className="tour-title">{s.title}</h2>
          <p className="tour-body">{s.body}</p>
          <div className="tour-dots">
            {SLIDES.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Go to slide ${i + 1}`}
                className={i === slide ? 'is-active' : ''}
                onClick={() => setSlide(i)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function lobbyStyles(accent: string) {
  return `
  .lobby {
    position: fixed; inset: 0; z-index: 9998;
    display: grid; place-items: center;
    padding: 24px;
    color: #e2e8f0;
    font-family: "IBM Plex Sans", system-ui, sans-serif;
    background:
      radial-gradient(circle at 0 0, rgba(249,87,56,.16), transparent 30%),
      radial-gradient(circle at 100% 50%, rgba(103,232,249,.10), transparent 28%),
      #0a0f1a;
  }
  .lobby-inner {
    width: 100%; max-width: 1040px;
    display: grid; grid-template-columns: 1.05fr 1fr; gap: 28px;
    align-items: stretch;
  }
  @media (max-width: 860px) { .lobby-inner { grid-template-columns: 1fr; } }

  .lobby-left { display: flex; flex-direction: column; }
  .lobby-brand { display: flex; align-items: center; gap: 12px; margin-bottom: 26px; }
  .lobby-logo {
    display: grid; place-items: center; width: 40px; height: 40px; border-radius: 999px;
    background: linear-gradient(135deg, #f95738, #8b1d13); font: 900 18px Manrope, sans-serif; color: #fff;
    overflow: hidden;
  }
  .lobby-logo img { width: 100%; height: 100%; object-fit: cover; }
  .lobby-brand-name { font: 800 20px Manrope, sans-serif; letter-spacing: -.02em; }
  .lobby-brand-name span { color: #f95738; }

  .lobby-eyebrow { margin: 0; color: ${accent}; font-size: 12px; letter-spacing: .35em; text-transform: uppercase; }
  .lobby-title { margin: 12px 0 0; font: 900 32px Manrope, sans-serif; line-height: 1.1; }
  .lobby-sub { margin: 14px 0 0; color: #94a3b8; font-size: 14px; line-height: 1.65; max-width: 46ch; }

  .lobby-count { margin-top: 28px; display: flex; gap: 12px; }
  .lobby-unit {
    min-width: 74px; padding: 14px 10px; border-radius: 16px;
    background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.1);
    display: grid; justify-items: center; gap: 4px;
  }
  .lobby-unit b { font: 800 30px Manrope, sans-serif; color: #fff; font-variant-numeric: tabular-nums; }
  .lobby-unit span { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: #94a3b8; }

  .lobby-slot { margin: 20px 0 0; font-size: 14px; color: #cbd5e1; line-height: 1.6; }
  .lobby-slot strong { color: #fff; }
  .lobby-slot span { color: #64748b; font-size: 12.5px; }

  .lobby-right {
    display: flex; flex-direction: column; align-items: center; text-align: center;
    padding: 28px 26px;
    border-radius: 22px;
    background: rgba(255,255,255,.035);
    border: 1px solid rgba(255,255,255,.1);
    box-shadow: 0 30px 80px rgba(0,0,0,.35);
  }
  .tour-badge {
    align-self: center; padding: 6px 14px; border-radius: 999px;
    background: ${accent}22; color: ${accent};
    font: 700 11px Manrope, sans-serif; letter-spacing: .1em; text-transform: uppercase;
  }
  .tour-art {
    margin-top: 20px; width: 100%; aspect-ratio: 16 / 9;
    display: grid; place-items: center; overflow: hidden;
    border-radius: 16px;
    background: linear-gradient(160deg, rgba(103,232,249,.10), rgba(249,87,56,.08));
    border: 1px solid rgba(255,255,255,.08);
    animation: tourfade .5s ease;
  }
  .tour-shot { position: relative; width: 100%; height: 100%; }
  .tour-shot img { width: 100%; height: 100%; object-fit: cover; display: block; }
  /* Spotlight: the huge spread box-shadow dims the whole screenshot except this
     rect, and the border+glow ring the region the current slide describes. */
  .tour-spot {
    position: absolute; border-radius: 10px;
    border: 2px solid ${accent};
    box-shadow: 0 0 0 9999px rgba(3,7,18,.60), 0 0 22px ${accent};
    animation: spotpulse 1.8s ease-in-out infinite;
  }
  @keyframes spotpulse {
    0%,100% { box-shadow: 0 0 0 9999px rgba(3,7,18,.60), 0 0 14px ${accent}; }
    50%     { box-shadow: 0 0 0 9999px rgba(3,7,18,.60), 0 0 28px ${accent}; }
  }
  .tour-emoji { font-size: 72px; filter: drop-shadow(0 8px 24px rgba(0,0,0,.4)); }
  @keyframes tourfade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

  .tour-title { margin: 20px 0 0; font: 800 20px Manrope, sans-serif; }
  .tour-body { margin: 10px 0 0; color: #94a3b8; font-size: 13.5px; line-height: 1.65; max-width: 42ch; min-height: 4.5em; }

  .tour-dots { margin-top: 20px; display: flex; gap: 8px; }
  .tour-dots button {
    width: 8px; height: 8px; padding: 0; border: 0; border-radius: 999px; cursor: pointer;
    background: rgba(255,255,255,.22); transition: all .25s ease;
  }
  .tour-dots button.is-active { width: 22px; background: ${accent}; }
  `;
}
