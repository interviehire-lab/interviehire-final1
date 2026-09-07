// Ambient global augmentations for the dashboard's vanilla-JS surface.
//
// The dashboard deliberately attaches its state store (`AppState`), API client
// (`IHApi`), and navigation/kebab/drawer handler functions onto `window` so that
// inline HTML `on*="..."` attributes (and loosely-coupled cross-module calls) can
// reach them without an import graph. That is an intentional bridge pattern, not
// incidental global leakage — dozens of such names exist across the engine.
//
// Rather than declare each name (a long, ever-growing list), we open Window with a
// string index typed `any`. Real DOM Window members keep their precise lib.dom
// types; only the dashboard's own attached names resolve through the index.
export {};

declare global {
  interface Window {
    [key: string]: any;
  }
}

// videojs-markers has no published types — it's a small, stable UMD plugin
// (registers a `markers()` method on video.js's Player via `videojs.registerPlugin`)
// used by report-page.ts for the proctoring-recording seek-bar markers. The
// call site casts the player to `any` for this method rather than augmenting
// video.js's own `Player` type, since that type isn't published from a path
// module augmentation can target (it's imported internally from a relative
// submodule, not re-exported by name from the `video.js` package root).
declare module 'videojs-markers';
