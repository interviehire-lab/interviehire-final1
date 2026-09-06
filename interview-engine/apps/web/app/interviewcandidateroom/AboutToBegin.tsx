'use client';
// Small explainer screen shown during the gap between calibration-complete and
// the LiveKit voice-agent worker actually joining (voice.agentConnected turning
// true) — replacing the previously-generic "connecting" spinner/copy for this
// specific gap. Copy is adapted (present tense) from WaitingRoom.tsx's existing
// "Lina, your AI interviewer" slide, rather than invented from scratch, so a
// candidate who skipped the early-arrival lobby (most candidates) still gets a
// real introduction before the first question lands.
//
// Reuses the room's existing `.gate`/`.gate-card`/`.gate-spinner` styles
// (roomStyles.ts) rather than adding a parallel style system for one static card.
// "Lina" is kept as-is regardless of white-labeling — the room's own identity
// badge and WaitingRoom's tour do the same; white-labeling only swaps the
// company brand/logo shown elsewhere, never the AI interviewer's persona name.

export function AboutToBegin() {
  return (
    <div className="gate">
      <div className="gate-card" style={{ textAlign: 'center' }}>
        <div className="gate-spinner" />
        <p className="gate-eyebrow">Getting ready</p>
        <h1 className="gate-title">Lina is joining now</h1>
        <p className="gate-sub">
          She&apos;ll ask you a few questions out loud and listen to your answers. Speak naturally,
          like a normal conversation — there&apos;s no need to rush.
        </p>
      </div>
    </div>
  );
}
