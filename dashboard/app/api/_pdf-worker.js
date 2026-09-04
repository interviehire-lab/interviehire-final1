// pdfjs-dist's Node "fake worker" path does `await import(this.workerSrc)`, where
// workerSrc is a runtime string ("./pdf.worker.mjs" resolved relative to
// pdfjs-dist/legacy/build/pdf.mjs). That's a dynamic import built from a string,
// which Vercel's output file tracer can't follow — so the worker module goes
// missing from the deployed function no matter what outputFileTracingIncludes
// globs point at it, producing "Setting up fake worker failed: Cannot find
// module .../pdfjs-dist/legacy/build/pdf.worker.mjs" at runtime.
//
// pdfjs-dist checks `globalThis.pdfjsWorker.WorkerMessageHandler` before ever
// attempting that dynamic import (see PDFWorker.#mainThreadWorkerMessageHandler
// in pdfjs-dist/legacy/build/pdf.mjs). Importing the worker module statically
// here lets Next's bundler trace it like any normal dependency, and populating
// the global short-circuits pdfjs-dist so it never reaches the dynamic import.
import { WorkerMessageHandler } from 'pdfjs-dist/legacy/build/pdf.worker.mjs';

if (!globalThis.pdfjsWorker) {
  globalThis.pdfjsWorker = { WorkerMessageHandler };
}
