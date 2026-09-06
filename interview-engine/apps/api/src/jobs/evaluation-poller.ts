import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { generateSessionReport, runScreeningOutcome } from '../routes/transcript.routes.js';

// ─────────────────────────────────────────────────────────────────────────────
// Evaluation poller — the candidate room used to call POST /report (two LLM
// passes) and, for screening sessions, POST /screening-outcome synchronously
// before showing anything useful, trapping the candidate behind a spinner. Both
// now run here instead, entirely decoupled from whether the candidate's browser
// is still open (it closes itself 5s after the interview ends).
//
// POST /sessions/:id/complete already flips a session to COMPLETED the moment
// the candidate ends the call (fast — no LLM calls, see interview.routes.ts) —
// that status is this poller's queue. EVALUATING is a transient claim marker so
// two overlapping ticks (or, if this service ever runs >1 instance) can't both
// pick up and double-process the same session.
//
// Mirrors backend/app/jobs/reminders.py's shape (plain function, best-effort,
// one bad session never blocks the rest of the batch or a future tick).
// ─────────────────────────────────────────────────────────────────────────────

const BATCH_SIZE = 5;

export async function runEvaluationPoll(app: FastifyInstance): Promise<void> {
  const due = await prisma.interviewSession.findMany({
    where: { status: 'COMPLETED' },
    orderBy: { completedAt: 'asc' },
    take: BATCH_SIZE,
    select: { id: true },
  });

  for (const { id } of due) {
    // Atomic claim: only proceeds if this tick is the one that flips it, so a
    // session already grabbed by a concurrent tick/instance is skipped here.
    const claim = await prisma.interviewSession.updateMany({
      where: { id, status: 'COMPLETED' },
      data: { status: 'EVALUATING' },
    });
    if (claim.count === 0) continue;

    try {
      const session = await prisma.interviewSession.findUnique({ where: { id }, select: { settings: true } });
      await generateSessionReport(id, app.log);

      const stage = (session?.settings as Record<string, unknown> | null)?.stage;
      if (stage === 'screening') {
        const { status, data } = await runScreeningOutcome(id, app.log);
        if (status >= 400) {
          app.log.warn({ sessionId: id, status, data }, 'screening-outcome did not succeed after evaluation');
        }
      }
    } catch (err) {
      app.log.error({ err, sessionId: id }, 'evaluation poll failed for session; reverting for retry next tick');
      // Best-effort retry, same philosophy as the reminders job — no retry-limit
      // or backoff machinery exists elsewhere in this repo either.
      await prisma.interviewSession.updateMany({
        where: { id, status: 'EVALUATING' },
        data: { status: 'COMPLETED' },
      }).catch((revertErr) => app.log.error({ revertErr, sessionId: id }, 'failed to revert session after failed evaluation'));
    }
  }
}
