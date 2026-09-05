import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../lib/prisma.js';
import { handleCandidateTranscript } from '../services/interview-conversation.service.js';
import { getEffectiveQuestions } from '../services/effective-questions.js';
import { deadlineFor, hardLimitSeconds } from '../services/interview-policy.js';
import { ensureTranscriptMeta, finalizeTranscript } from '../services/transcript.service.js';
import { transcriptFilePath as transcriptPathEnv } from '../services/transcript.service.js';
import { transcriptFilePath as transcriptPathFixed } from '../services/flagcheckTranscription.service.js';

/**
 * Internal service-to-service routes, called ONLY by the FastAPI backend (never the
 * browser), guarded by a shared-secret header.
 *
 * Because the two services share one Postgres, the backend performs all DB anonymise/erase
 * itself (deleting a Candidate cascades its sessions/transcripts/proctoring at the DB
 * level). The engine's sole job here is to unlink its ON-DISK artifacts — transcript .txt
 * files and recording blobs — which live on this container's filesystem and are
 * unreachable via the DB. Part of the DPDP Act 2023 right-to-erasure flow.
 */

function safeEntries(transcript: unknown): any[] {
  if (Array.isArray(transcript)) return transcript;
  if (typeof transcript === 'string') {
    try { const v = JSON.parse(transcript); return Array.isArray(v) ? v : []; } catch { return []; }
  }
  return [];
}

function hasInternalAccess(req: any): boolean {
  const expected = process.env.INTERNAL_SERVICE_SECRET?.trim();
  return !!expected && req.headers['x-internal-secret'] === expected;
}

export async function internalRoutes(app: FastifyInstance) {
  app.post('/livekit/sessions/:id/start', async (req: any, reply) => {
    if (!hasInternalAccess(req)) {
      return reply.code(401).send({ error: 'unauthorized', code: 'BAD_INTERNAL_SECRET' });
    }
    const session = await prisma.interviewSession.findUnique({
      where: { id: req.params.id },
      include: {
        candidate: { select: { fullName: true } },
        jobRole: { include: { questions: { where: { isActive: true }, orderBy: { createdAt: 'asc' } } } },
      },
    });
    if (!session) return reply.code(404).send({ error: 'Interview session not found', code: 'SESSION_NOT_FOUND' });

    const questions = getEffectiveQuestions(session as any);

    const settings = (session.settings && typeof session.settings === 'object')
      ? session.settings as Record<string, unknown>
      : {};
    const startedAt = session.startedAt ?? new Date();
    const firstQuestion = questions[0]?.text ?? 'Tell me about your professional background.';
    const transcript = safeEntries(session.transcript);
    if (!transcript.some((entry) => entry?.speaker === 'ai')) {
      transcript.push({ speaker: 'ai', text: firstQuestion, timestamp: new Date().toISOString(), questionIndex: 0, kind: 'question' });
    }
    await prisma.interviewSession.update({
      where: { id: session.id },
      data: { status: 'IN_PROGRESS', startedAt, transcript },
    });
    await ensureTranscriptMeta(session.id);

    return {
      sessionId: session.id,
      candidateName: session.candidate.fullName,
      roleTitle: session.jobRole.title,
      initialQuestion: firstQuestion,
      startedAt: startedAt.toISOString(),
      deadlineAt: deadlineFor(startedAt, settings).toISOString(),
      hardLimitSeconds: hardLimitSeconds(settings),
    };
  });

  app.post('/livekit/sessions/:id/turn', async (req: any, reply) => {
    if (!hasInternalAccess(req)) {
      return reply.code(401).send({ error: 'unauthorized', code: 'BAD_INTERNAL_SECRET' });
    }
    const text = String(req.body?.text ?? '').trim();
    if (!text) return reply.code(400).send({ error: 'Candidate transcript text is required', code: 'EMPTY_TRANSCRIPT' });
    const headerTurnId = Array.isArray(req.headers['idempotency-key'])
      ? req.headers['idempotency-key'][0]
      : req.headers['idempotency-key'];
    const turnId = String(req.body?.turnId || headerTurnId || '').trim().slice(0, 128);
    if (turnId) {
      const existing = await prisma.interviewSession.findUnique({
        where: { id: req.params.id },
        select: { transcript: true },
      });
      const entries = safeEntries(existing?.transcript);
      const priorAi = entries.find(
        (entry) => entry?.speaker === 'ai' && entry?.livekitTurnId === turnId && typeof entry?.text === 'string',
      );
      if (priorAi) {
        const interviewPhase = priorAi.questionIndex == null
          ? 'closing'
          : priorAi.kind === 'followup' ? 'follow_up' : 'questioning';
        return reply.send({
          answer: { text },
          replayed: true,
          ai: {
            text: priorAi.text,
            interviewPhase,
            emotionState: interviewPhase === 'closing' ? 'encouraging' : 'curious',
            shouldEnd: interviewPhase === 'closing',
          },
        });
      }
    }
    const metrics = req.body?.metrics && typeof req.body.metrics === 'object' ? req.body.metrics : {};
    const ai = await handleCandidateTranscript(req.params.id, text, {
      ...metrics,
      ...(turnId ? { livekitTurnId: turnId } : {}),
    });
    return reply.send({ answer: { text }, ai });
  });

  app.post('/livekit/sessions/:id/complete', async (req: any, reply) => {
    if (!hasInternalAccess(req)) {
      return reply.code(401).send({ error: 'unauthorized', code: 'BAD_INTERNAL_SECRET' });
    }
    const existing = await prisma.interviewSession.findUnique({ where: { id: req.params.id } });
    if (!existing) return reply.code(404).send({ error: 'Interview session not found', code: 'SESSION_NOT_FOUND' });

    const completionReason = ['director_completed', 'all_questions_asked', 'time_limit', 'candidate_ended'].includes(req.body?.reason)
      ? req.body.reason
      : 'candidate_ended';
    const transcriptEntries = safeEntries(existing.transcript);
    if (!transcriptEntries.some((entry) => entry?.type === 'interview_completion')) {
      transcriptEntries.push({
        type: 'interview_completion',
        completionReason,
        timestamp: new Date().toISOString(),
      });
    }
    const session = existing.status === 'EVALUATED'
      ? existing
      : await prisma.interviewSession.update({
          where: { id: existing.id },
          data: {
            status: 'COMPLETED',
            completedAt: existing.completedAt ?? new Date(),
            transcript: transcriptEntries,
          },
        });
    const transcript = await finalizeTranscript(existing.id).catch((error) => {
      req.log.error({ error, sessionId: existing.id }, 'LiveKit transcript finalization failed');
      return null;
    });
    return reply.send({ session, transcript, completionReason });
  });

  // POST /internal/data-rights/erase-files
  // Body: { sessionIds: string[], requestId?: string }
  // Unlinks each session's transcript .txt (two dir resolutions + the stored column) and
  // any recording blobs referenced in its transcript JSON. Best-effort, idempotent.
  app.post('/data-rights/erase-files', async (req: any, reply) => {
    if (!hasInternalAccess(req)) {
      return reply.code(401).send({ error: 'unauthorized', code: 'BAD_INTERNAL_SECRET' });
    }

    const body = (req.body ?? {}) as { sessionIds?: string[] };
    const sessionIds = Array.isArray(body.sessionIds)
      ? body.sessionIds.filter((s) => typeof s === 'string')
      : [];
    const uploadsDir = path.resolve(process.cwd(), 'uploads');
    const unlinked: string[] = [];

    const tryUnlink = (p: string) => {
      try { if (p && fs.existsSync(p)) { fs.unlinkSync(p); unlinked.push(p); } } catch { /* ignore */ }
    };

    for (const sid of sessionIds) {
      // 1) transcript .txt — two independent helpers resolve the dir differently, plus the
      //    authoritative path stored on InterviewTranscript.
      const paths = new Set<string>();
      try { paths.add(transcriptPathEnv(sid)); } catch { /* ignore */ }
      try { paths.add(transcriptPathFixed(sid)); } catch { /* ignore */ }
      try {
        const meta = await prisma.interviewTranscript.findUnique({
          where: { sessionId: sid }, select: { transcriptFilePath: true },
        });
        if (meta?.transcriptFilePath) paths.add(meta.transcriptFilePath);
      } catch { /* ignore */ }

      // 2) recording blobs referenced in the session transcript JSON (basename only).
      try {
        const session = await prisma.interviewSession.findUnique({
          where: { id: sid }, select: { transcript: true },
        });
        for (const e of safeEntries(session?.transcript)) {
          if (e && e.type === 'recording' && typeof e.filename === 'string') {
            paths.add(path.join(uploadsDir, path.basename(e.filename)));
          }
        }
      } catch { /* ignore */ }

      for (const p of paths) tryUnlink(p);
    }

    return reply.send({ ok: true, count: unlinked.length, filesUnlinked: unlinked });
  });
}
