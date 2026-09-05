import { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { RoomAgentDispatch, RoomConfiguration } from '@livekit/protocol';
import { AccessToken } from 'livekit-server-sdk';
import { prisma } from '../lib/prisma.js';
import { evaluateInterview, generatePdfReport, getCandidateFacingReport } from '../services/evaluation.service.js';
import nodemailer from 'nodemailer';
import fs from 'node:fs';
import path from 'node:path';
import { processRecordingForSession, transcribeUploadedFile } from '../services/transcription.service.js';
import { uploadRecordingToDrive } from '../services/drive-upload.service.js';
import { handleCandidateTranscript } from '../services/interview-conversation.service.js';
import {
  deadlineFor,
  hardLimitSeconds,
} from '../services/interview-policy.js';
import { ensureTranscriptMeta, finalizeTranscript } from '../services/transcript.service.js';
import { saveTranscriptFile, flagcheckTranscriptFile, transcriptFilePath, FLAGCHECK_DISCLAIMER } from '../services/flagcheckTranscription.service.js';
import { EARLY_ENTRY_MS } from '@interviehire/shared';

// Per-candidate invite enforcement shared by the post-start session routes: a
// session bound to an inviteToken only serves the matching ?token=. Returns true
// (and sends a 403) when blocked, false otherwise. Token-free sessions pass.
async function blockedByInviteToken(req: any, reply: any): Promise<boolean> {
  const bound = await prisma.interviewSession.findUnique({ where: { id: req.params.id }, select: { inviteToken: true } });
  if (bound?.inviteToken && req.query.token !== bound.inviteToken) {
    reply.code(403).send({ error: 'This interview link is invalid or has expired.', code: 'INVALID_TOKEN' });
    return true;
  }
  return false;
}

type SpeechTranscriptSegment = {
  speaker: 'candidate';
  text: string;
  timestamp: string;
  source: 'speech_to_text';
};

type TranscriptRecord = Record<string, any>;

function readTranscript(raw: unknown): TranscriptRecord[] {
  if (Array.isArray(raw)) return raw as TranscriptRecord[];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as TranscriptRecord[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Only call the LLM semantic pass once the transcript has grown enough since the last run. */
const FLAGCHECK_LLM_MIN_GROWTH_CHARS = 400;

/**
 * Transcript flagcheck. Best-effort, fire-and-forget: saves the full transcript
 * to `transcripts/<sessionId>.txt`, then runs the AI-tone analysis on that file
 * (deterministic heuristics always; LLM semantic pass only once enough new text
 * has accumulated, or when finalized). The verdict is stored in a dedicated
 * `transcript_flagcheck` entry on the session transcript JSON, keyed by
 * transcriptId. Re-reads immediately before writing to limit clobbering the
 * concurrent speech-to-text save (last-writer-wins is acceptable for this MVP).
 */
async function runTranscriptFlagcheck(
  sessionId: string,
  transcriptId: string,
  fullText: string,
  finalized: boolean,
): Promise<void> {
  const session = await prisma.interviewSession.findUnique({ where: { id: sessionId } });
  if (!session) return;

  // 1. Persist the live transcription to a .txt file.
  const filePath = await saveTranscriptFile(sessionId, fullText);

  // 2. Decide whether this run earns an LLM pass.
  const current = readTranscript(session.transcript);
  const existing = current.find(
    (item) => item?.type === 'transcript_flagcheck' && item?.transcriptId === transcriptId,
  );
  const analyzedChars = Number(existing?.analyzedChars) || 0;
  const runLlm = finalized || fullText.length - analyzedChars >= FLAGCHECK_LLM_MIN_GROWTH_CHARS;

  // 3. Run the flagcheck on the file.
  const assessment = await flagcheckTranscriptFile(filePath, { runLlm });

  const entry = {
    type: 'transcript_flagcheck',
    transcriptId,
    transcriptFile: transcriptFilePath(sessionId),
    assessment,
    // Track chars analyzed by the LLM so the next run knows when to re-run it.
    analyzedChars: runLlm ? fullText.length : analyzedChars,
    finalized,
    updatedAt: new Date().toISOString(),
    disclaimer: FLAGCHECK_DISCLAIMER,
  };

  // Re-read just before writing to reduce the window for clobbering the speech save.
  const fresh = readTranscript(
    (await prisma.interviewSession.findUnique({ where: { id: sessionId } }))?.transcript,
  );
  const index = fresh.findIndex(
    (item) => item?.type === 'transcript_flagcheck' && item?.transcriptId === transcriptId,
  );
  const updated = index >= 0
    ? fresh.map((item, i) => (i === index ? { ...item, ...entry } : item))
    : [...fresh, entry];

  await prisma.interviewSession.update({ where: { id: sessionId }, data: { transcript: updated as any } });
}

const juniorSdeQuestions = [
  {
    text: 'Explain the difference between an array and a linked list. When would you choose one over the other?',
    difficulty: 'EASY' as const,
    topicCategories: ['data structures', 'fundamentals'],
    aiEvaluationGuidance: JSON.stringify({
      questionType: 'technical_theory',
      modelAnswer: 'Arrays store elements contiguously and allow O(1) index access, but insertion or deletion in the middle can be O(n). Linked lists store nodes with references, so insertion or deletion can be O(1) when the node is known, but random access is O(n) and there is extra pointer memory overhead. Choose arrays for fast indexing and cache locality; choose linked lists when frequent insertions or deletions are needed and traversal is acceptable.',
      rubric: {
        requiredPoints: [
          { id: 'array_contiguous_indexing', description: 'Arrays use contiguous storage and support fast index-based access.', keywords: ['contiguous', 'index', 'o(1)', 'random access'], weight: 30 },
          { id: 'linked_list_nodes', description: 'Linked lists use nodes and references/pointers rather than contiguous storage.', keywords: ['node', 'pointer', 'reference', 'linked'], weight: 25 },
          { id: 'operation_tradeoffs', description: 'Explains insertion/deletion and access-time tradeoffs.', keywords: ['insert', 'delete', 'o(n)', 'o(1)', 'access'], weight: 30 },
        ],
        secondaryPoints: [
          { id: 'memory_cache_tradeoff', description: 'Mentions memory overhead or cache locality.', keywords: ['memory', 'cache', 'overhead', 'locality'], weight: 10 },
        ],
        excellentAnswerSignals: [
          { id: 'use_case_choice', description: 'Gives a clear rule for choosing one structure over the other.', keywords: ['choose', 'when', 'frequent', 'indexing'], weight: 10 },
        ],
        redFlags: [
          { id: 'claims_same_structure', description: 'Claims arrays and linked lists are essentially the same structure.', severity: 'high' },
        ],
      },
    }),
  },
  {
    text: 'What is time complexity, and why does it matter when writing code?',
    difficulty: 'EASY' as const,
    topicCategories: ['algorithms', 'complexity'],
    aiEvaluationGuidance: JSON.stringify({
      questionType: 'technical_theory',
      modelAnswer: 'Time complexity describes how an algorithm’s running time grows as input size grows, usually using Big O notation such as O(1), O(log n), O(n), or O(n squared). It matters because code that works on small inputs may become too slow on large inputs. Engineers use it to compare approaches, choose efficient algorithms, and understand scalability.',
      rubric: {
        requiredPoints: [
          { id: 'growth_with_input', description: 'Defines complexity as runtime growth relative to input size.', keywords: ['input', 'size', 'grow', 'runtime', 'running time'], weight: 35 },
          { id: 'big_o', description: 'Mentions Big O or common complexity classes.', keywords: ['big o', 'o(n)', 'o(1)', 'o(log', 'o(n^2)'], weight: 25 },
          { id: 'scalability_reason', description: 'Explains why complexity matters for larger inputs and scalability.', keywords: ['large', 'slow', 'scale', 'scalability', 'efficient'], weight: 30 },
        ],
        secondaryPoints: [
          { id: 'compare_approaches', description: 'Uses complexity to compare possible implementations.', keywords: ['compare', 'approach', 'algorithm', 'choose'], weight: 10 },
        ],
        excellentAnswerSignals: [
          { id: 'concrete_example', description: 'Gives a concrete example such as nested loops or binary search.', keywords: ['example', 'nested', 'binary search', 'loop'], weight: 10 },
        ],
        redFlags: [
          { id: 'only_actual_seconds', description: 'Defines complexity only as exact seconds on one machine.', severity: 'medium' },
        ],
      },
    }),
  },
  {
    text: 'How would you debug an API endpoint that is returning a 500 error?',
    difficulty: 'MEDIUM' as const,
    topicCategories: ['debugging', 'backend'],
    aiEvaluationGuidance: JSON.stringify({
      questionType: 'technical_theory',
      modelAnswer: 'Start by reproducing the request and checking logs, stack traces, and recent changes. Verify inputs, request body, authentication, database calls, environment variables, and downstream services. Add targeted logging or use a debugger, isolate the failing layer, write or update a test once the issue is understood, and return a safe error response without leaking internal details.',
      rubric: {
        requiredPoints: [
          { id: 'reproduce_and_logs', description: 'Reproduces the issue and checks logs or stack traces.', keywords: ['reproduce', 'logs', 'stack trace', 'trace'], weight: 30 },
          { id: 'check_inputs_dependencies', description: 'Checks request inputs and dependencies such as database or downstream services.', keywords: ['input', 'request', 'database', 'dependency', 'service'], weight: 30 },
          { id: 'isolate_fix_verify', description: 'Isolates the failing layer, fixes it, and verifies with testing.', keywords: ['isolate', 'debugger', 'test', 'verify', 'fix'], weight: 25 },
        ],
        secondaryPoints: [
          { id: 'safe_error_handling', description: 'Mentions safe errors and avoiding leaked internals.', keywords: ['safe', 'error', 'leak', 'internal'], weight: 10 },
        ],
        excellentAnswerSignals: [
          { id: 'recent_changes_observability', description: 'Mentions recent deploys, metrics, or observability.', keywords: ['recent', 'deploy', 'metrics', 'observability'], weight: 10 },
        ],
        redFlags: [
          { id: 'guess_without_logs', description: 'Suggests changing random code without checking logs or reproducing.', severity: 'medium' },
        ],
      },
    }),
  },
  {
    text: 'Describe how you would design a simple URL shortener.',
    difficulty: 'MEDIUM' as const,
    topicCategories: ['system design', 'backend'],
    aiEvaluationGuidance: JSON.stringify({
      questionType: 'system_design',
      modelAnswer: 'A simple URL shortener needs an API to create a short code for a long URL and another API to redirect from the code to the long URL. Store mappings in a database with fields like code, long URL, created time, and optional expiry. Generate unique codes using hashing, random IDs, or an incrementing ID encoded in base62, and handle collisions. Discuss redirects, validation, analytics, caching for popular links, and basic abuse prevention.',
      rubric: {
        requiredPoints: [
          { id: 'core_apis', description: 'Defines create-short-link and redirect APIs.', keywords: ['api', 'create', 'redirect', 'short', 'long url'], weight: 25 },
          { id: 'storage_mapping', description: 'Stores short code to long URL mapping in a database.', keywords: ['database', 'store', 'mapping', 'code', 'url'], weight: 25 },
          { id: 'unique_code_generation', description: 'Explains unique code generation and collision handling.', keywords: ['unique', 'code', 'hash', 'base62', 'collision'], weight: 25 },
        ],
        secondaryPoints: [
          { id: 'cache_analytics_expiry', description: 'Mentions caching, analytics, expiry, or validation.', keywords: ['cache', 'analytics', 'expiry', 'validation'], weight: 15 },
        ],
        excellentAnswerSignals: [
          { id: 'abuse_and_scale', description: 'Mentions abuse prevention or scaling popular redirects.', keywords: ['abuse', 'rate limit', 'scale', 'popular'], weight: 10 },
        ],
        redFlags: [
          { id: 'no_persistence', description: 'Design has no persistence for URL mappings.', severity: 'high' },
        ],
      },
    }),
  },
];

// Shared by GET /demo-session and POST /voice-test-session — both just need a
// real, working company/role/questions/candidate to seed a session against;
// find-or-create so repeated calls (across restarts, or from either route)
// converge on the same demo data instead of piling up duplicates.
async function getOrCreateDemoSession() {
  const company = await prisma.company.upsert({
      where: { slug: 'demo-junior-sde' },
      update: {
        name: 'IntervieHire Demo Engineering',
        description: 'A demo engineering team hiring junior software development engineers.',
        primaryColor: '#0e7490',
      },
      create: {
        name: 'IntervieHire Demo Engineering',
        slug: 'demo-junior-sde',
        description: 'A demo engineering team hiring junior software development engineers.',
        reportEmail: 'hr@example.com',
        primaryColor: '#0e7490',
      },
    });

    let role = await prisma.jobRole.findFirst({ where: { companyId: company.id, title: 'Junior Software Development Engineer' } });
    if (!role) {
      role = await prisma.jobRole.create({
        data: {
          companyId: company.id,
          title: 'Junior Software Development Engineer',
          roleType: 'GENERAL',
          description: 'Junior engineering role focused on fundamentals, debugging, backend basics, and clear technical communication.',
          requirements: 'Data structures, algorithms, debugging, APIs, databases, and basic system design.',
          primaryCriteria: ['data structures', 'algorithms', 'debugging', 'backend fundamentals'],
          secondaryCriteria: ['communication', 'system design basics', 'testing'],
          atsScoringWeights: { primary: 0.4, secondary: 0.3, education: 0.1, experience: 0.1, communication: 0.1 },
          evaluationCriteria: { modelAnswerAlignment: 1, correctness: 1, reasoning: 1, communication: 1, confidence: 1 },
        },
      });
    }

    for (const question of juniorSdeQuestions) {
      const existing = await prisma.question.findFirst({
        where: { companyId: company.id, jobRoleId: role.id, text: question.text },
      });
      if (!existing) {
        await prisma.question.create({
          data: {
            companyId: company.id,
            jobRoleId: role.id,
            text: question.text,
            roleApplicability: ['GENERAL'],
            difficulty: question.difficulty,
            topicCategories: question.topicCategories,
            aiEvaluationGuidance: question.aiEvaluationGuidance,
          },
        });
      } else {
        await prisma.question.update({
          where: { id: existing.id },
          data: {
            difficulty: question.difficulty,
            topicCategories: question.topicCategories,
            aiEvaluationGuidance: question.aiEvaluationGuidance,
            isActive: true,
          },
        });
      }
    }

    let candidate = await prisma.candidate.findFirst({ where: { companyId: company.id, email: 'aarav@example.com' } });
    if (!candidate) {
      candidate = await prisma.candidate.create({
        data: {
          companyId: company.id,
          fullName: 'Aarav Sharma',
          email: 'aarav@example.com',
          parsedResume: { yearsOfExperience: 2, skills: ['analytics', 'presentation', 'client communication', 'problem-solving'] },
          atsScore: 82,
          atsBreakdown: { demo: true },
        },
      });
    }

    let session = await prisma.interviewSession.findFirst({
      where: { companyId: company.id, candidateId: candidate.id, jobRoleId: role.id, status: 'SCHEDULED' },
      orderBy: { createdAt: 'desc' },
    });
    if (!session) {
      session = await prisma.interviewSession.create({
        data: {
          companyId: company.id,
          candidateId: candidate.id,
          jobRoleId: role.id,
          status: 'SCHEDULED',
          scheduledAt: new Date(),
        },
      });
    }

  return { company, role, candidate, session };
}

export async function interviewRoutes(app: FastifyInstance) {
  app.get('/demo-session', async () => {
    const { company, role, candidate, session } = await getOrCreateDemoSession();
    return { sessionId: session.id, companyId: company.id, roleId: role.id, candidateId: candidate.id };
  });

  // POST /voice-test-session — a lightweight harness for manually testing the
  // real-time voice pipeline (director + LiveKit + AgentAudioVisualizerAura)
  // without going through the full candidate-room consent/permission/proctoring
  // flow. Reuses the exact same demo company/role/questions as /demo-session,
  // with `settings.conversationalInterview` forced to true — /sessions/:id/livekit-token
  // 409s otherwise. Public, no auth: same trust level as /demo-session itself
  // (no real candidate data touched).
  app.post('/voice-test-session', async (_req: any, reply) => {
    const { session } = await getOrCreateDemoSession();
    const settings = (session.settings && typeof session.settings === 'object')
      ? session.settings as Record<string, unknown>
      : {};
    const updated = await prisma.interviewSession.update({
      where: { id: session.id },
      data: { settings: { ...settings, conversationalInterview: true } },
    });
    return reply.send({ sessionId: updated.id });
  });

  // ── Candidate consent audit log ("security log") ───────────────────────────
  // Persist the candidate's informed-consent decision (granted / declined)
  // recorded by the consent gate in the candidate room BEFORE any camera / mic /
  // recording starts. This is the server-side, durable record of biometric,
  // recording+AI, 18+, privacy-policy and cookies consent — the client also
  // keeps a localStorage proof, but this row is the authoritative audit trail.
  // Unauthenticated by design (candidates are not logged-in users); rate limited
  // by the global plugin. The client IP + User-Agent are captured server-side.
  app.post('/consent', async (req:any, reply:any) => {
    const b = req.body ?? {};
    const sessionId = String(b.sessionId ?? '').trim();
    const consentVersion = String(b.consentVersion ?? '').trim();
    const action = b.action === 'declined' ? 'declined' : 'granted';
    if (!sessionId || !consentVersion) {
      return reply.code(400).send({ error: 'sessionId and consentVersion are required' });
    }
    const scopes = (b.scopes && typeof b.scopes === 'object' && !Array.isArray(b.scopes)) ? b.scopes : {};
    const xff = req.headers['x-forwarded-for'];
    const ipAddress =
      (typeof xff === 'string' ? xff.split(',')[0].trim() : Array.isArray(xff) ? xff[0] : '') || req.ip || null;
    const ua = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;
    const record = await prisma.consentLog.create({
      data: {
        sessionId,
        action,
        consentVersion,
        scopes,
        candidateEmail: b.candidateEmail ? String(b.candidateEmail) : null,
        candidateName: b.candidateName ? String(b.candidateName) : null,
        inviteToken: b.inviteToken ? String(b.inviteToken) : null,
        userAgent: b.userAgent ? String(b.userAgent) : ua,
        ipAddress,
        locale: b.locale ? String(b.locale) : null,
      },
    });
    return { ok: true, id: record.id, createdAt: record.createdAt };
  });

  // Consent history for a session (newest first) — recruiter/audit verification.
  app.get('/consent/:sessionId', async (req:any) => {
    const records = await prisma.consentLog.findMany({
      where: { sessionId: req.params.sessionId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return { sessionId: req.params.sessionId, count: records.length, records };
  });

  app.get('/sessions/:id', async (req:any, reply:any) => {
    const session = await prisma.interviewSession.findUnique({where:{id:req.params.id}, include:{company:true,candidate:true,jobRole:{include:{questions:true}},proctoringLogs:true}});
    // A token-bound session only reveals its config/questions to the matching token.
    if (session && (session as any).inviteToken && req.query.token !== (session as any).inviteToken) {
      return reply.code(403).send({ error: 'This interview link is invalid or has expired.', code: 'INVALID_TOKEN' });
    }
    return session;
  });
  app.post('/sessions/:id/start', async (req:any, reply:any) => {
    const session = await prisma.interviewSession.findUniqueOrThrow({
      where: { id: req.params.id },
      include: { candidate: true, jobRole: { include: { questions: { where: { isActive: true }, orderBy: { createdAt: 'asc' } } } } },
    });
    // Per-candidate invite enforcement: a token-bound session only starts for the
    // matching token. Token-free (legacy/scheduled/demo) sessions are unaffected.
    if ((session as any).inviteToken && req.query.token !== (session as any).inviteToken) {
      return reply.code(403).send({ error: 'This interview link is invalid or has expired.', code: 'INVALID_TOKEN' });
    }
    // Per-job interview settings synced from the recruiter dashboard. A missing
    // value is treated as permissive so existing sessions keep working.
    const s: any = session.settings || {};
    if (s.interviewEnabled === false) {
      return reply.code(403).send({ error: 'This interview is currently disabled.', code: 'INTERVIEW_DISABLED' });
    }
    if (s.allowReattempt === false && (session.status === 'COMPLETED' || session.status === 'EVALUATED')) {
      return reply.code(403).send({ error: 'This interview has already been completed.', code: 'NO_REATTEMPT' });
    }
    // A small grace buffer so a punctual candidate starting a few moments after
    // their slot (clock skew, page load) isn't rejected when late attempts are off.
    const LATE_GRACE_MS = 5 * 60 * 1000;
    if (s.allowLate === false && session.scheduledAt && Date.now() > new Date(session.scheduledAt).getTime() + LATE_GRACE_MS) {
      return reply.code(403).send({ error: 'The scheduled interview window has passed.', code: 'LATE_ATTEMPT' });
    }
    // Scheduled-slot barrier: a session with a future slot cannot be started until
    // its early-entry window opens. This is the server half of the candidate-room
    // countdown lobby — it makes the lock real (a bypassed client can't start
    // early). EARLY_ENTRY_MS is shared from @interviehire/shared so the client
    // and server can never drift out of sync. Sessions with no scheduledAt
    // (plain link / demo) are unaffected.
    if (session.scheduledAt && Date.now() < new Date(session.scheduledAt).getTime() - EARLY_ENTRY_MS) {
      return reply.code(403).send({ error: 'This interview has not opened yet. Please return at your scheduled time.', code: 'TOO_EARLY' });
    }
    if (s.requireCv === true && !session.candidate?.resumeText) {
      return reply.code(400).send({ error: 'A CV/resume is required before starting this interview.', code: 'CV_REQUIRED' });
    }
    // accessControl: 'link' (default) = anyone with the link. 'scheduled' requires a
    // scheduled slot; 'invited' requires a linked candidate record. Permissive for
    // unknown/legacy values so existing sessions keep working.
    if (s.accessControl === 'scheduled' && !session.scheduledAt) {
      return reply.code(403).send({ error: 'This interview is open to scheduled candidates only.', code: 'ACCESS_SCHEDULED_ONLY' });
    }
    if (s.accessControl === 'invited' && !session.candidate) {
      return reply.code(403).send({ error: 'This interview is open to invited candidates only.', code: 'ACCESS_INVITED_ONLY' });
    }
    const firstQuestion = session.jobRole.questions[0]?.text ?? 'Tell me about your software engineering background.';
    // continueFromMiddle: default on (resume). An explicit false starts fresh,
    // ignoring any prior transcript so a refresh restarts the interview.
    const resume = s.continueFromMiddle !== false;
    const transcript = (resume && Array.isArray(session.transcript)) ? session.transcript as any[] : [];
    const hasAiQuestion = transcript.some((entry) => entry?.speaker === 'ai');
    const updatedTranscript = hasAiQuestion
      ? transcript
      : [...transcript, { speaker: 'ai', text: firstQuestion, timestamp: new Date().toISOString(), questionIndex: 0 }];
    const updated = await prisma.interviewSession.update({
      where: { id: req.params.id },
      data: { status: 'IN_PROGRESS', startedAt: session.startedAt ?? new Date(), transcript: updatedTranscript as any },
    });
    // Open the transcript metadata row (status: recording). We do NOT log the
    // blueprint question here: in the Convai-driven room the avatar asks its own
    // questions (captured via STT), and the backend-driven room records its own
    // interviewer turns client-side — seeding here would inject a phantom line.
    await ensureTranscriptMeta(req.params.id);
    const settings = (updated.settings && typeof updated.settings === 'object')
      ? updated.settings as Record<string, unknown>
      : {};
    const startedAt = updated.startedAt ?? new Date();
    return {
      session: updated,
      initialQuestion: firstQuestion,
      startedAt: startedAt.toISOString(),
      deadlineAt: deadlineFor(startedAt, settings).toISOString(),
      hardLimitSeconds: hardLimitSeconds(settings),
    };
  });
  app.post('/sessions/:id/livekit-token', async (req:any, reply:any) => {
    if (await blockedByInviteToken(req, reply)) return reply;

    const livekitUrl = process.env.LIVEKIT_URL?.trim();
    const apiKey = process.env.LIVEKIT_API_KEY?.trim();
    const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();
    if (!livekitUrl || !apiKey || !apiSecret) {
      return reply.code(503).send({ error: 'LiveKit is not configured on the interview engine.', code: 'LIVEKIT_NOT_CONFIGURED' });
    }

    const session = await prisma.interviewSession.findUnique({
      where: { id: req.params.id },
      include: {
        candidate: { select: { id: true, fullName: true } },
        jobRole: { include: { questions: { where: { isActive: true }, orderBy: { createdAt: 'asc' } } } },
      },
    });
    if (!session) return reply.code(404).send({ error: 'Interview session not found', code: 'SESSION_NOT_FOUND' });
    if (session.status !== 'IN_PROGRESS' || !session.startedAt) {
      return reply.code(409).send({ error: 'Start the interview session before requesting a LiveKit token.', code: 'SESSION_NOT_STARTED' });
    }

    const settings = (session.settings && typeof session.settings === 'object')
      ? session.settings as Record<string, unknown>
      : {};
    if (settings.conversationalInterview !== true) {
      return reply.code(409).send({ error: 'This interview is not configured for conversational voice.', code: 'LIVEKIT_NOT_ENABLED' });
    }

    const roomName = `interview-${session.id}`;
    const deadlineAt = deadlineFor(session.startedAt, settings);
    const participantIdentity = `candidate-${session.candidate.id}-${randomUUID().slice(0, 8)}`;
    const agentName = process.env.LIVEKIT_AGENT_NAME?.trim() || 'interviehire-interviewer';
    const metadata = JSON.stringify({
      sessionId: session.id,
      startedAt: session.startedAt.toISOString(),
      deadlineAt: deadlineAt.toISOString(),
    });
    const accessToken = new AccessToken(apiKey, apiSecret, {
      identity: participantIdentity,
      name: session.candidate.fullName,
      ttl: hardLimitSeconds(settings) + 5 * 60,
      metadata: JSON.stringify({ sessionId: session.id }),
    });
    accessToken.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    accessToken.roomConfig = new RoomConfiguration({
      maxParticipants: 2,
      departureTimeout: 30,
      agents: [new RoomAgentDispatch({ agentName, metadata })],
    });

    return {
      url: livekitUrl,
      token: await accessToken.toJwt(),
      roomName,
      participantIdentity,
      startedAt: session.startedAt.toISOString(),
      deadlineAt: deadlineAt.toISOString(),
      hardLimitSeconds: hardLimitSeconds(settings),
    };
  });
  app.post('/sessions/:id/complete', async (req:any, reply:any) => {
    if (await blockedByInviteToken(req, reply)) return reply;
    const session = await prisma.interviewSession.update({ where: { id: req.params.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
    // Auto-finalize the transcript on completion. Best-effort: a failure here
    // must not break the completion flow (the .txt can still be built on demand
    // via POST /api/interviews/:id/transcript/finalize).
    const transcript = await finalizeTranscript(req.params.id).catch((err) => {
      app.log.error('Transcript finalize on complete failed', err);
      return null;
    });
    return { session, transcript };
  });
  app.post('/sessions/:id/answers', async (req:any, reply) => {
    if (await blockedByInviteToken(req, reply)) return reply;
    const text = String(req.body?.text ?? '').trim();
    if (!text) return reply.code(400).send({ error: 'Answer text is required' });

    const ai = await handleCandidateTranscript(req.params.id, text, req.body?.metrics ?? {});
    return { answer: { text }, ai };
  });
  // Ingest a pasted interview transcript (e.g. copied from Convai's memory tab)
  // and store it as session.transcript in the shape the evaluator expects
  // ({speaker:'ai'|'candidate', text, questionIndex}). Tolerant of several paste
  // formats: a {turns:[...]} / Convai {interaction:[...]} array, or raw text with
  // "Speaker: line" prefixes (User/Candidate/You ↔ Character/Interviewer/AI).
  app.post('/sessions/:id/transcript-text', async (req:any, reply) => {
    const session = await prisma.interviewSession.findUnique({ where: { id: req.params.id } });
    if (!session) return reply.code(404).send({ error: 'Session not found' });

    const body = req.body ?? {};
    const aiRe = /character|interviewer|assistant|^ai\b|\bai\b|lina|bot/i;
    const candidateRe = /user|candidate|\byou\b|\bme\b|human|applicant/i;

    function rawToTurns(): Array<{ speaker?: string; role?: string; text?: string; message?: string; content?: string }> {
      if (Array.isArray(body.turns)) return body.turns;
      if (Array.isArray(body.interaction)) return body.interaction; // Convai chatHistory shape
      const text = typeof body.text === 'string' ? body.text : (typeof body === 'string' ? body : '');
      if (!text.trim()) return [];
      const lines = text.split(/\r?\n/);
      const speakerRe = /^\s*([A-Za-z][A-Za-z ()/_-]{0,24}?)\s*[:\-–]\s*(.*)$/;
      const turns: Array<{ speaker: string; text: string }> = [];
      for (const line of lines) {
        const m = line.match(speakerRe);
        if (m && (aiRe.test(m[1]) || candidateRe.test(m[1]))) {
          turns.push({ speaker: m[1], text: m[2] });
        } else if (line.trim() && turns.length) {
          turns[turns.length - 1].text += ' ' + line.trim();
        }
      }
      return turns;
    }

    const normalized: Array<{ speaker: 'ai' | 'candidate'; text: string; questionIndex: number; timestamp: string }> = [];
    let qi = -1;
    for (const t of rawToTurns()) {
      const who = String(t.speaker ?? t.role ?? '');
      const txt = String(t.text ?? t.message ?? t.content ?? '').trim();
      if (!txt) continue;
      const speaker: 'ai' | 'candidate' = aiRe.test(who) ? 'ai' : candidateRe.test(who) ? 'candidate' : 'candidate';
      if (speaker === 'ai') qi += 1;
      normalized.push({ speaker, text: txt, questionIndex: Math.max(0, qi), timestamp: new Date().toISOString() });
    }

    if (!normalized.length) {
      return reply.code(400).send({ error: 'Could not parse any interview turns. Paste the conversation with "Speaker: text" lines, or send a {turns:[{speaker,text}]} array.' });
    }

    await prisma.interviewSession.update({ where: { id: req.params.id }, data: { transcript: normalized as any } });
    return { ok: true, turns: normalized.length, transcript: normalized };
  });

  app.post('/sessions/:id/evaluate', async (req:any, reply:any) => {
    if (await blockedByInviteToken(req, reply)) return reply;
    return { evaluation: await evaluateInterview(req.params.id) };
  });
  app.get('/sessions/:id/candidate-report', async (req:any) => ({report: await getCandidateFacingReport(req.params.id)}));
  app.post('/sessions/:id/report', async (req:any) => ({filePath: await generatePdfReport(req.params.id)}));
  app.post('/sessions/:id/email-report', async (req:any) => {
    const session = await prisma.interviewSession.findUnique({where:{id:req.params.id}, include:{company:true,candidate:true}});
    if (!session) throw new Error('Session not found');
    const filePath = session.reportUrl || await generatePdfReport(req.params.id);
    const transporter = nodemailer.createTransport({host:process.env.SMTP_HOST, port:Number(process.env.SMTP_PORT || 587), secure:false, auth:{user:process.env.SMTP_USER, pass:process.env.SMTP_PASS}});
    await transporter.sendMail({from:process.env.REPORT_FROM, to: session.company.reportEmail || req.body?.to, subject:`Interview report: ${session.candidate.fullName}`, text:'Attached is the IntervieHire evaluation report.', attachments:[{filename:`${session.candidate.fullName}-report.pdf`, content:fs.createReadStream(filePath)}]});
    return {sent:true};
  });

  app.post('/sessions/:id/transcript', async (req:any, reply) => {
    const session = await prisma.interviewSession.findUnique({ where: { id: req.params.id } });
    if (!session) return reply.code(404).send({ error: 'Session not found' });

    const body = req.body ?? {};
    const transcriptId = typeof body.transcriptId === 'string' && body.transcriptId.trim()
      ? body.transcriptId.trim()
      : 'browser-speech-recognition';
    const segments = Array.isArray(body.transcript) ? body.transcript : [];
    const transcript: SpeechTranscriptSegment[] = segments
      .map((segment: any) => ({
        speaker: 'candidate' as const,
        text: typeof segment?.text === 'string' ? segment.text.trim() : '',
        timestamp: typeof segment?.timestamp === 'string' ? segment.timestamp : new Date().toISOString(),
        source: 'speech_to_text' as const,
      }))
      .filter((segment: SpeechTranscriptSegment) => segment.text.length > 0);

    if (!transcript.length) {
      return reply.code(400).send({ error: 'Transcript must contain at least one text segment' });
    }

    const fullText = typeof body.fullText === 'string' && body.fullText.trim()
      ? body.fullText.trim()
      : transcript.map((segment) => segment.text).join('\n');

    const entry = {
      type: 'speech_to_text_transcript',
      source: 'speech_to_text',
      text: fullText,
      segments: transcript,
      sessionId: session.id,
      candidateId: session.candidateId,
      transcriptId,
      finalized: body.finalized === true,
      createdAt: typeof body.createdAt === 'string' ? body.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const current = readTranscript(session.transcript);
    const existingIndex = current.findIndex(
      (item) => item?.type === 'speech_to_text_transcript' && item?.transcriptId === transcriptId,
    );
    const updated = existingIndex >= 0
      ? current.map((item, index) => index === existingIndex ? { ...item, ...entry, createdAt: item.createdAt ?? entry.createdAt } : item)
      : [...current, entry];
    await prisma.interviewSession.update({ where: { id: req.params.id }, data: { transcript: updated as any } });

    // Save transcript to .txt + run AI-tone flagcheck on the file (best-effort, non-blocking).
    runTranscriptFlagcheck(req.params.id, transcriptId, fullText, body.finalized === true).catch((err) =>
      app.log.error('Transcript flagcheck error', err),
    );

    return { stored: true, entry };
  });

  // Accept a recording upload (audio/video blob) and attach metadata to the session transcript JSON
  app.post('/sessions/:id/recording', async (req:any, reply) => {
    // requires @fastify/multipart registered
    const part = await req.file();
    if (!part) return reply.code(400).send({ error: 'No file uploaded' });
    const uploadsDir = path.resolve(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    const filename = `${Date.now()}-${part.filename || 'recording.webm'}`;
    const dest = path.join(uploadsDir, filename);
    const buffer = await part.toBuffer();
    fs.writeFileSync(dest, buffer);

    // Attach a recording entry to the session transcript JSON
    const session = await prisma.interviewSession.findUnique({ where: { id: req.params.id } });
    const entry = { type: 'recording', filename, url: `/uploads/${filename}`, createdAt: new Date() };
    if (session) {
      const current = readTranscript(session.transcript);
      const updated = [...current, entry];
      await prisma.interviewSession.update({ where: { id: req.params.id }, data: { transcript: updated as any } });
      // kick off transcription and question-fit processing (async)
      processRecordingForSession(req.params.id, filename).catch((err) => app.log.error('Transcription error', err));
      // Forward to the backend, which uploads it into the Drive "Recordings" folder
      // (fire-and-forget — the candidate-facing response above must not wait on this).
      // Stored on dedicated InterviewSession columns rather than inside the
      // transcript JSON: finalizeTranscript() rewrites that field to a clean
      // dialogue-only projection (often within seconds of this upload, on
      // /complete), which would silently wipe a driveUrl merged into it.
      uploadRecordingToDrive(req.params.id, dest, filename, part.mimetype || 'video/webm')
        .then(async (drive) => {
          if (!drive) return;
          await prisma.interviewSession.update({
            where: { id: req.params.id },
            data: { recordingDriveFileId: drive.driveFileId, recordingDriveUrl: drive.driveUrl },
          });
        })
        .catch((err) => app.log.error(err, 'drive upload failed'));
      return { url: `/uploads/${filename}`, entry };
    }

    // If session not found, return upload info — file saved but not attached to a session
    return { url: `/uploads/${filename}`, entry, note: 'session not found; recording stored but not linked' };
  });

  app.post('/sessions/:id/answer-transcription', async (req:any, reply) => {
    const part = await req.file();
    if (!part) return reply.code(400).send({ error: 'No file uploaded' });

    const uploadsDir = path.resolve(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    const filename = `${Date.now()}-${part.filename || 'answer.webm'}`;
    const dest = path.join(uploadsDir, filename);
    const buffer = await part.toBuffer();
    fs.writeFileSync(dest, buffer);

    try {
      const text = await transcribeUploadedFile(dest);
      return { text, filename };
    } catch (error:any) {
      app.log.error('Answer transcription error', error);
      return reply.code(502).send({ error: error?.message || 'Answer transcription failed' });
    }
  });

  // Serve uploaded files
  app.get('/uploads/:file', async (req:any, reply) => {
    const p = path.join(process.cwd(), 'uploads', req.params.file);
    if (!fs.existsSync(p)) return reply.code(404).send({ error: 'Not found' });
    return reply.send(fs.createReadStream(p));
  });
}
