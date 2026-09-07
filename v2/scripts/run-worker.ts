import type { JobEnvelopeV1 } from "@interviehire/contracts";
import type { Processor } from "bullmq";
import {
  connectHiringDatabase,
  DrizzleHiringOutboxStore,
  DrizzleNotificationDirectory,
  DrizzleResumeAnalysisWorkerStore,
} from "@interviehire/db-hiring";
import {
  connectInterviewDatabase,
  DrizzleEvaluationStore,
  DrizzleInterviewOutboxStore,
} from "@interviehire/db-interview";
import {
  connectOpsDatabase,
  DrizzleAutomationRunStore,
  DrizzleNotificationDeliveryStore,
} from "@interviehire/db-ops";
import {
  createBullMqPublisher,
  createQueue,
  createRoutedOutboxPublisher,
  type QueueName,
} from "@interviehire/queue";
import {
  createBullMqInterviewProcessor,
  createBullMqNotificationProcessor,
  createBullMqResumeProcessor,
  createBullMqRetentionProcessor,
  createInterviewEvaluationProcessor,
  createInterviewResultProcessor,
  createHttpCoreInterviewResultClient,
  createHttpInterviewEvaluator,
  createHttpResumeAnalysisProvider,
  createLegacyRetentionClient,
  createNotificationProcessor,
  createResumeAnalysisProcessor,
  createResilientEvaluator,
  createRetentionProcessor,
  startWorkerRuntime,
  upsertRetentionScheduler,
  type InterviewEvaluator,
  type NotificationProvider,
  type WorkerGroup,
} from "@interviehire/worker";

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
if (!databaseUrl || !redisUrl) throw new Error("DATABASE_URL and REDIS_URL are required");

const hiring = connectHiringDatabase(databaseUrl);
const interview = connectInterviewDatabase(databaseUrl);
const ops = connectOpsDatabase(databaseUrl);
const queueNames = ["ai.resume", "ai.interview", "notifications", "automations"] as const;
const queues = Object.fromEntries(queueNames.map((name) => [name, createQueue(name, redisUrl)])) as Record<(typeof queueNames)[number], ReturnType<typeof createQueue>>;
const routedPublisher = createRoutedOutboxPublisher(Object.fromEntries(
  queueNames.map((name) => [name, createBullMqPublisher(queues[name])]),
));

const now = () => new Date().toISOString();
const deterministicEvaluator = (kind: "holistic" | "structured"): InterviewEvaluator => ({
  async evaluate(input) {
    const candidateTurns = input.transcript.filter((entry) => entry.speaker === "candidate").length;
    const score = Math.min(96, 72 + candidateTurns * 4);
    return kind === "holistic"
      ? { overallScore: score, recommendation: score >= 80 ? "advance" : "review", summary: "Deterministic demo evaluation from durable transcript evidence." }
      : { rubricScore: score - 2, communication: score, problemSolving: score - 4, source: "structured-demo" };
  },
});
const evaluator = (kind: "holistic" | "structured") => {
  const url = process.env[kind === "holistic" ? "HOLISTIC_EVALUATOR_URL" : "STRUCTURED_EVALUATOR_URL"];
  return url
    ? createResilientEvaluator(createHttpInterviewEvaluator({ url, ...(process.env.AI_PROVIDER_API_KEY ? { apiKey: process.env.AI_PROVIDER_API_KEY } : {}) }), deterministicEvaluator(kind))
    : deterministicEvaluator(kind);
};
const deterministicResumeProvider = {
  async analyseResume(input: { resumeText: string }) {
    const skills = ["TypeScript", "PostgreSQL", "distributed systems"].filter((skill) =>
      input.resumeText.toLowerCase().includes(skill.toLowerCase()),
    );
    return { score: 76 + skills.length * 6, recommendation: skills.length >= 2 ? "advance" : "review", matchedSkills: skills };
  },
};
const resumeProvider = process.env.RESUME_ANALYSIS_PROVIDER_URL
  ? createHttpResumeAnalysisProvider({ url: process.env.RESUME_ANALYSIS_PROVIDER_URL, ...(process.env.AI_PROVIDER_API_KEY ? { apiKey: process.env.AI_PROVIDER_API_KEY } : {}) })
  : deterministicResumeProvider;
const notificationProvider: NotificationProvider = {
  async send(message) {
    const providerMessageId = `demo_${message.channel}_${crypto.randomUUID()}`;
    console.log(JSON.stringify({
      service: "v2-worker", event: "notification.simulated", channel: message.channel,
      template: message.template, resourceId: message.resourceId, providerMessageId,
    }));
    return { providerMessageId };
  },
};

const interviewResultProcessor = createInterviewResultProcessor(createHttpCoreInterviewResultClient({
  baseUrl: process.env.CORE_API_URL ?? "http://127.0.0.1:4100",
  internalSecret: process.env.INTERNAL_SERVICE_SECRET ?? "dev-internal-secret",
}));

const processors: Partial<Record<QueueName, Processor<JobEnvelopeV1>>> = {
  "ai.resume": createBullMqResumeProcessor(createResumeAnalysisProcessor(
    new DrizzleResumeAnalysisWorkerStore(hiring.db),
    resumeProvider,
    now,
  )),
  "ai.interview": createBullMqInterviewProcessor(createInterviewEvaluationProcessor(
    new DrizzleEvaluationStore(interview.db),
    evaluator("holistic"),
    evaluator("structured"),
    now,
  )),
  notifications: createBullMqNotificationProcessor(createNotificationProcessor(
    new DrizzleNotificationDeliveryStore(ops.db),
    new DrizzleNotificationDirectory(hiring.db),
    notificationProvider,
    now,
  )),
  automations: async (job) => job.data.payload?.eventType === "interview.evaluated.v1"
    ? interviewResultProcessor(job.data)
    : { acknowledged: true, eventType: job.data.payload?.eventType },
};

const legacyBaseUrl = process.env.LEGACY_API_URL;
if (legacyBaseUrl) {
  const retention = createRetentionProcessor(
    new DrizzleAutomationRunStore(ops.db),
    createLegacyRetentionClient({
      baseUrl: legacyBaseUrl,
      internalSecret: process.env.INTERNAL_SERVICE_SECRET ?? "dev-internal-secret",
    }),
    now,
  );
  processors.automations = async (job) => {
    if (job.name === "retention.scan.v1") return createBullMqRetentionProcessor(retention)(job);
    if (job.data.payload?.eventType === "interview.evaluated.v1") return interviewResultProcessor(job.data);
    return { acknowledged: true, eventType: job.data.payload?.eventType };
  };
  await upsertRetentionScheduler(queues.automations, now());
}

const runtime = await startWorkerRuntime({
  redisUrl,
  group: (process.env.WORKER_GROUP ?? "all") as WorkerGroup,
  stores: [new DrizzleHiringOutboxStore(hiring.db), new DrizzleInterviewOutboxStore(interview.db)],
  publisher: routedPublisher,
  processors,
});

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await runtime.close();
  await Promise.all(queueNames.map((name) => queues[name].close()));
  await Promise.all([hiring.client.end(), interview.client.end(), ops.client.end()]);
  process.exit(0);
}
let shuttingDown = false;
process.on("SIGINT", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });
