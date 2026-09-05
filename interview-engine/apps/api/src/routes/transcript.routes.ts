import { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../lib/prisma.js';
import {
  finalizeTranscript,
  loadEvents,
  recordEvents,
  transcriptFilePath,
} from '../services/transcript.service.js';
import { asrAvailable, asrProvider, transcribeAudioSegments } from '../services/asr.service.js';
import { generateTranscriptReport } from '../services/transcript-report.service.js';
import { evaluateInterview } from '../services/evaluation.service.js';
import { evaluateInterviewWithAviral } from '../services/aviral-evaluation.service.js';
import { buildExitTranscriptReport, isExitInterviewSettings } from '../services/exit-report.service.js';

type TranscriptSpeaker = 'candidate' | 'interviewer';

// ─────────────────────────────────────────────────────────────────────────────
// Transcript API (mounted at /api/interviews).
//   POST /:sessionId/transcript/event      ingest one or many live events
//   GET  /:sessionId/transcript            read events + metadata (+ optional .txt body)
//   POST /:sessionId/transcript/finalize   build & save the .txt, update metadata
//   GET  /:sessionId/transcript/file       download the finalized .txt
// ─────────────────────────────────────────────────────────────────────────────

export async function transcriptRoutes(app: FastifyInstance) {
  // Lets the candidate room choose server ASR before recording. Only provider
  // availability is exposed; API keys never leave the server.
  app.get('/:sessionId/transcript/audio/status', async (req: any, reply) => {
    const { sessionId } = req.params;
    const session = await prisma.interviewSession.findUnique({ where: { id: sessionId }, select: { id: true } });
    if (!session) return reply.code(404).send({ error: 'Session not found' });
    return { available: asrAvailable(), provider: asrProvider() };
  });

  // Ingest live transcript events. Accepts a single { ...event } or { events: [...] }.
  // Best-effort: malformed events are skipped, never 500. Returns counts so the
  // client can detect (and retry) a fully-rejected batch.
  app.post('/:sessionId/transcript/event', async (req: any, reply) => {
    const { sessionId } = req.params;
    const body = req.body ?? {};
    const rawEvents = Array.isArray(body.events)
      ? body.events
      : Array.isArray(body)
        ? body
        : [body];

    if (!rawEvents.length) {
      return reply.code(400).send({ error: 'No transcript events provided' });
    }

    try {
      const result = await recordEvents(sessionId, rawEvents);
      return { ok: true, ...result };
    } catch (err: any) {
      if (err?.message === 'Interview session not found') {
        return reply.code(404).send({ error: err.message });
      }
      req.log?.error?.(err, 'transcript event ingest failed');
      return reply.code(500).send({ error: 'Failed to store transcript event' });
    }
  });

  // Ingest a candidate-microphone or interviewer-tab audio chunk and transcribe
  // it server-side with Deepgram (preferred) or Whisper into timestamped events.
  // Multipart: file + fields { speaker, startMs }. Returns 503 when neither ASR
  // provider is configured so the candidate client can switch to browser STT.
  app.post('/:sessionId/transcript/audio', async (req: any, reply) => {
    const { sessionId } = req.params;
    const session = await prisma.interviewSession.findUnique({ where: { id: sessionId }, select: { id: true } });
    if (!session) return reply.code(404).send({ error: 'Session not found' });

    const part = await req.file();
    if (!part) return reply.code(400).send({ error: 'No audio file uploaded' });

    const fields = part.fields ?? {};
    const speaker: TranscriptSpeaker = fields?.speaker?.value === 'candidate' ? 'candidate' : 'interviewer';
    const startMs = Number(fields?.startMs?.value ?? 0) || 0;

    const uploadsDir = path.resolve(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    const filename = `${Date.now()}-${speaker}-${part.filename || 'audio.webm'}`;
    const dest = path.join(uploadsDir, filename);
    const mimeType = part.mimetype || 'audio/webm';
    fs.writeFileSync(dest, await part.toBuffer());

    try {
      if (!asrAvailable()) {
        return reply.code(503).send({
          error: 'Server-side transcription is not configured. Set DEEPGRAM_API_KEY (or OPENAI_API_KEY).',
          stored: 0,
        });
      }
      const segments = await transcribeAudioSegments(dest, startMs, mimeType);
      if (!segments || !segments.length) {
        return { ok: true, stored: 0, note: 'No speech detected in the audio.' };
      }
      const result = await recordEvents(
        sessionId,
        segments.map((s) => ({ speaker, text: s.text, timestampMs: s.startMs, source: 'whisper', isFinal: true })),
      );
      return {
        ok: true,
        provider: asrProvider(),
        segments: segments.length,
        transcript: segments.map((segment) => segment.text).join(' '),
        ...result,
      };
    } catch (err: any) {
      req.log?.error?.(err, 'audio transcription failed');
      return reply.code(502).send({ error: err?.message || 'Audio transcription failed', stored: 0 });
    } finally {
      // Audio is transient transport data; transcript events are the durable copy.
      fs.rmSync(dest, { force: true });
    }
  });

  // Read the current transcript: raw events + metadata. ?text=1 also returns the
  // rendered .txt body (finalizing first if needed) for quick preview.
  app.get('/:sessionId/transcript', async (req: any, reply) => {
    const { sessionId } = req.params;
    const session = await prisma.interviewSession.findUnique({ where: { id: sessionId }, select: { id: true } });
    if (!session) return reply.code(404).send({ error: 'Session not found' });

    const [events, meta] = await Promise.all([
      loadEvents(sessionId),
      prisma.interviewTranscript.findUnique({ where: { sessionId } }),
    ]);

    let text: string | undefined;
    if (req.query?.text === '1' || req.query?.text === 'true') {
      const filePath = transcriptFilePath(sessionId);
      if (meta?.transcriptFilePath && fs.existsSync(meta.transcriptFilePath)) {
        text = fs.readFileSync(meta.transcriptFilePath, 'utf8');
      } else if (fs.existsSync(filePath)) {
        text = fs.readFileSync(filePath, 'utf8');
      } else {
        const result = await finalizeTranscript(sessionId);
        if (result.filePath && fs.existsSync(result.filePath)) {
          text = fs.readFileSync(result.filePath, 'utf8');
        }
      }
    }

    return { sessionId, events, meta, ...(text !== undefined ? { text } : {}) };
  });

  // Finalize: build the clean .txt, persist file path + metadata.
  app.post('/:sessionId/transcript/finalize', async (req: any, reply) => {
    const { sessionId } = req.params;
    const session = await prisma.interviewSession.findUnique({ where: { id: sessionId }, select: { id: true } });
    if (!session) return reply.code(404).send({ error: 'Session not found' });

    const result = await finalizeTranscript(sessionId);
    if (result.status === 'failed') {
      return reply.code(500).send({ error: 'Transcript finalization failed', ...result });
    }
    return { ok: true, ...result };
  });

  // Finalize the transcript, then generate the report by passing the WHOLE
  // transcript to the LLM (fits the Convai-driven interview where questions are
  // dynamic). Falls back to the deterministic evaluator when no LLM key / on error
  // so the candidate always gets a report. Returns { evaluation, engine }.
  app.post('/:sessionId/report', async (req: any, reply) => {
    const { sessionId } = req.params;
    const session = await prisma.interviewSession.findUnique({ where: { id: sessionId }, select: { id: true, settings: true } });
    if (!session) return reply.code(404).send({ error: 'Session not found' });

    await finalizeTranscript(sessionId);

    // Exit interviews are recorded, not scored: skip the holistic LLM report and the
    // structured grader, and store the no-LLM verbatim transcript report instead.
    if (isExitInterviewSettings(session.settings)) {
      const evaluation = await buildExitTranscriptReport(sessionId);
      return { evaluation, engine: 'exit_verbatim' };
    }

    // Primary holistic report (keeps Deep Analysis unchanged), then the structured
    // rubric/dimension/proctoring evaluation (gpt-4o when OPENAI_API_KEY is set,
    // else OpenRouter) merged under `.structured` for the new analysis section.
    let primary: any = null;
    let engine = 'transcript_llm';
    try {
      primary = await generateTranscriptReport(sessionId);
    } catch (llmErr) {
      req.log?.warn?.(llmErr, 'transcript LLM report failed; falling back to deterministic evaluator');
      try {
        primary = await evaluateInterview(sessionId);
        engine = 'deterministic';
      } catch (err: any) {
        primary = null;
      }
    }

    let structured: any = null;
    try {
      structured = await evaluateInterviewWithAviral(sessionId);
    } catch (structErr) {
      req.log?.warn?.(structErr, 'structured (aviral) evaluation failed');
    }

    if (!primary && !structured) {
      return reply.code(500).send({ error: 'Report generation failed' });
    }

    // Merge: holistic stays the headline report; the structured analysis is nested
    // (and also used standalone if the holistic pass failed).
    const evaluation = primary
      ? { ...primary, structured: structured ?? undefined }
      : { ...structured, structured };

    await prisma.interviewSession.update({
      where: { id: sessionId },
      data: { evaluation: evaluation as any, status: 'EVALUATED', completedAt: new Date() },
    });

    return { evaluation, engine: structured ? `${engine}+aviral` : engine };
  });

  // Recruiter-screening only: after `/report` has scored the session, ask the backend
  // to decide fit (it re-reads the evaluation we just persisted, never trusts the
  // client) and — on a fit — auto-mint + email the functional-interview invite.
  // Server-to-server forward, same pattern as drive-upload.service.ts.
  app.post('/:sessionId/screening-outcome', async (req: any, reply) => {
    const { sessionId } = req.params;
    const backendUrl = process.env.BACKEND_URL;
    if (!backendUrl) {
      return reply.code(503).send({ error: 'Backend not configured for screening outcome routing.' });
    }

    try {
      const res = await fetch(
        `${backendUrl.replace(/\/$/, '')}/api/public/interview-session/${sessionId}/screening-outcome`,
        { method: 'POST', headers: { 'X-Webhook-Secret': process.env.ENGINE_WEBHOOK_SECRET ?? '' } },
      );
      const data = await res.json().catch(() => ({}));
      return reply.code(res.status).send(data);
    } catch (err: any) {
      req.log?.error?.(err, 'screening-outcome forward failed');
      return reply.code(502).send({ error: 'Failed to reach backend for screening outcome.' });
    }
  });

  // Download the finalized .txt (finalizes on demand if missing).
  app.get('/:sessionId/transcript/file', async (req: any, reply) => {
    const { sessionId } = req.params;
    let filePath = transcriptFilePath(sessionId);
    if (!fs.existsSync(filePath)) {
      const result = await finalizeTranscript(sessionId);
      if (!result.filePath || !fs.existsSync(result.filePath)) {
        return reply.code(404).send({ error: 'Transcript not available' });
      }
      filePath = result.filePath;
    }
    reply.header('Content-Type', 'text/plain; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${sessionId}.txt"`);
    return reply.send(fs.createReadStream(filePath));
  });
}
