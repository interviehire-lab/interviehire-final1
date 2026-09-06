// ==========================================
// SOUND ENGINE (disabled)
// ==========================================
// Sound effects have been removed from the product. This engine is kept as a
// no-op shape rather than deleted outright — ~150 call sites across the
// dashboard (mount.ts, navigation.ts, sourcing.ts, blueprint-studio.ts, etc.)
// call `soundEngine.playClick()`/`playChime()` inline alongside real UI logic
// (e.g. `soundEngine.playClick(); reRender(); break;`), so removing the calls
// themselves would mean hundreds of risky micro-edits across nearly the whole
// codebase for zero behavioral gain over simply never producing audio here.
class SoundEngine {
  muted: boolean;

  constructor() {
    this.muted = true;
  }

  playChime(_notes: number[], _duration?: number, _delayMultiplier?: number): void {
    // no-op
  }

  playClick(): void {
    // no-op
  }
}

const soundEngine = new SoundEngine();

export { soundEngine, SoundEngine };
