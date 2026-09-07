import { connectHiringDatabase, migrateHiringDatabase, applications, applicationInterviewRefs, resumeAnalysisRuns } from "@interviehire/db-hiring";
import { connectInterviewDatabase, migrateInterviewDatabase, interviewEvaluations, interviewSessions } from "@interviehire/db-interview";
import { migrateOpsDatabase } from "@interviehire/db-ops"; import { resetHiringDb, resetInterviewDb, resetOpsDb } from "@interviehire/testing";
import { createQueue, QUEUE_NAMES } from "@interviehire/queue";
const url = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL; if (!url) throw new Error("DATABASE_URL is required");
const redisUrl = process.env.REDIS_URL ?? process.env.TEST_REDIS_URL;
if (redisUrl) {
  const queues = QUEUE_NAMES.map((name) => createQueue(name, redisUrl));
  try { await Promise.all(queues.map((queue) => queue.obliterate({ force: true }))); }
  finally { await Promise.all(queues.map((queue) => queue.close())); }
}
await migrateHiringDatabase(url); await migrateInterviewDatabase(url); await migrateOpsDatabase(url); await resetOpsDb(url); await resetInterviewDb(url); await resetHiringDb(url);
const hiring = connectHiringDatabase(url); const interview = connectInterviewDatabase(url); const createdAt = "2026-09-07T06:00:00.000Z";
try {
  await hiring.db.insert(applications).values([
    { id: "app_queued", tenantId: "tenant_demo", jobId: "job_software_engineer", candidateName: "Aditi Sharma", candidateEmail: "aditi@example.test", candidatePhone: "+919900000001", source: "Career page", resumeText: "Frontend engineer with React and accessibility experience.", asyncStatus: "queued" },
    { id: "app_ready", tenantId: "tenant_demo", jobId: "job_software_engineer", candidateName: "Kabir Mehta", candidateEmail: "kabir@example.test", candidatePhone: "+919900000002", source: "Referral", resumeText: "Distributed systems engineer with TypeScript and Postgres.", asyncStatus: "ready", resumeAnalysisComplete: true },
    { id: "app_screening", tenantId: "tenant_demo", jobId: "job_software_engineer", candidateName: "Meera Nair", candidateEmail: "meera@example.test", candidatePhone: "+919900000003", source: "LinkedIn", stage: "recruiter_screening", asyncStatus: "ready", resumeAnalysisComplete: true },
    { id: "app_screened", tenantId: "tenant_demo", jobId: "job_software_engineer", candidateName: "Rohan Iyer", candidateEmail: "rohan@example.test", candidatePhone: "+919900000004", source: "Referral", stage: "recruiter_screening", asyncStatus: "ready", resumeAnalysisComplete: true, screeningComplete: true },
    { id: "app_functional", tenantId: "tenant_demo", jobId: "job_software_engineer", candidateName: "Sara Khan", candidateEmail: "sara@example.test", candidatePhone: "+919900000005", source: "Career page", stage: "functional_interview", asyncStatus: "ready", resumeAnalysisComplete: true, screeningComplete: true },
    { id: "app_evaluating", tenantId: "tenant_demo", jobId: "job_software_engineer", candidateName: "Vikram Rao", candidateEmail: "vikram@example.test", candidatePhone: "+919900000006", source: "Direct", stage: "functional_interview", asyncStatus: "ready", resumeAnalysisComplete: true, screeningComplete: true },
    { id: "app_decision", tenantId: "tenant_demo", jobId: "job_software_engineer", candidateName: "Nila Joseph", candidateEmail: "nila@example.test", candidatePhone: "+919900000007", source: "Referral", stage: "functional_interview", asyncStatus: "ready", resumeAnalysisComplete: true, screeningComplete: true },
    { id: "app_failed", tenantId: "tenant_demo", jobId: "job_software_engineer", candidateName: "Arjun Das", candidateEmail: "arjun@example.test", candidatePhone: "+919900000008", source: "Bulk upload", resumeText: "Backend developer.", asyncStatus: "failed" },
  ]);
  await hiring.db.insert(resumeAnalysisRuns).values([
    { id: "resume_queued", applicationId: "app_queued", tenantId: "tenant_demo", status: "queued", idempotencyKey: "seed_queued", correlationId: "seed", resumeRevision: 1, createdAt, updatedAt: createdAt },
    { id: "resume_failed", applicationId: "app_failed", tenantId: "tenant_demo", status: "failed", attempt: 1, idempotencyKey: "seed_failed", correlationId: "seed", resumeRevision: 1, errorCode: "TRANSIENT", createdAt, updatedAt: createdAt },
  ]);
  const mappings = [
    ["app_screening","session_screening","recruiter_screening","2026-09-08T08:30:00.000Z"], ["app_screened","session_screened","recruiter_screening","2026-09-07T07:00:00.000Z"], ["app_functional","session_functional","functional_interview","2026-09-08T10:30:00.000Z"], ["app_evaluating","session_evaluating","functional_interview","2026-09-07T07:30:00.000Z"], ["app_decision","session_decision","functional_interview","2026-09-07T07:30:00.000Z"],
  ] as const;
  await hiring.db.insert(applicationInterviewRefs).values(mappings.map(([applicationId,interviewSessionId,stage,scheduledAt],index)=>({ applicationId, tenantId:"tenant_demo", interviewSessionId, stage, scheduledAt, timeZone:"Asia/Kolkata", deliveryMethods:["email"] as const, correlationId:"seed", idempotencyKey:`seed_schedule_${index}`, actorId:"recruiter_demo", createdAt })));
  await interview.db.insert(interviewSessions).values(mappings.map(([applicationId,id,interviewStage,scheduledAt])=>({ id, tenantId:"tenant_demo", applicationId, interviewStage, status: id==="session_screening"||id==="session_functional"?"scheduled" as const:id==="session_evaluating"?"evaluating" as const:"evaluated" as const, scheduledAt, timeZone:"Asia/Kolkata", hardLimitSeconds:interviewStage==="recruiter_screening"?300:1500, correlationId:"seed", idempotencyKey:`seed_${id}`, createdAt, candidateName: applicationId==="app_decision"?"Nila Joseph":"Demo Candidate", roleTitle:"Senior Software Engineer", initialQuestion:"Tell me about a system you designed.", resumePresent:true, transcript:[{speaker:"ai",text:"Tell me about a system you designed."},{speaker:"candidate",text:"I designed an idempotent event pipeline with PostgreSQL and Redis."}], ...(id==="session_evaluating"?{completedAt:"2026-09-07T07:55:00.000Z"}:{}), ...(id==="session_screened"||id==="session_decision"?{evaluation:{holistic:{overallScore:id==="session_decision"?88:81,summary:"Strong ownership and clear trade-off reasoning."},structured:{rubricScore:id==="session_decision"?86:79,recommendation:"advance",competencies:{systemDesign:90,communication:84}}},completedAt:"2026-09-07T07:55:00.000Z"}:{}) })));
  await interview.db.insert(interviewEvaluations).values([
    ...["session_screened","session_decision"].flatMap(sessionId=>["holistic","structured"].map(evaluator=>({sessionId,evaluator:evaluator as "holistic"|"structured",status:"ready" as const,attempt:1,result:evaluator==="holistic"?{overallScore:84}:{rubricScore:81},startedAt:createdAt,completedAt:createdAt}))),
    {sessionId:"session_evaluating",evaluator:"holistic",status:"ready",attempt:1,result:{overallScore:82},startedAt:createdAt,completedAt:createdAt}, {sessionId:"session_evaluating",evaluator:"structured",status:"running",attempt:1,startedAt:createdAt},
  ]);
  console.log("Seeded deterministic IntervieHire V2 demo: tenant_demo / job_software_engineer / 8 candidates");
} finally { await Promise.all([hiring.client.end(), interview.client.end()]); }
