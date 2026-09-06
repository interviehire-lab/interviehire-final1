import { Elysia, t } from "elysia";
import { Effect } from "effect";
import {
  buildCandidateBoard,
  createApplicationService,
  type ApplicationQueryRepository,
  type ApplicationRepository,
  type ResumeAnalysisService,
} from "@interviehire/domain-hiring";

export interface CoreAppDependencies {
  readonly applicationRepository: ApplicationRepository;
  readonly applicationQueries?: ApplicationQueryRepository;
  readonly resumeAnalysis?: ResumeAnalysisService;
}

export function createCoreApp(dependencies: CoreAppDependencies) {
  const applicationService = createApplicationService(dependencies.applicationRepository);
  const queries: ApplicationQueryRepository = dependencies.applicationQueries ?? {
    findForTenant: async () => undefined,
    listForJob: async () => [],
  };
  const readHeaders = t.Object({
    "x-tenant-id": t.String({ minLength: 1 }),
    "x-correlation-id": t.String({ minLength: 1 }),
  }, { additionalProperties: true });
  const unavailableResumeAnalysis: ResumeAnalysisService = {
    request: async () => ({ ok: false, code: "NOT_FOUND", message: "Application not found." }),
    findJob: async () => undefined,
  };
  const resumeAnalysis = dependencies.resumeAnalysis ?? unavailableResumeAnalysis;

  return new Elysia({ name: "interviehire-v2-core" })
    .get("/health", () => ({ status: "ok", service: "core-api" }))
    .get("/v2/jobs/:id/board", async ({ headers, params }) => {
      const applications = await Effect.runPromise(Effect.tryPromise(() =>
        queries.listForJob(headers["x-tenant-id"], params.id),
      ));
      return {
        ...buildCandidateBoard(params.id, applications),
        correlationId: headers["x-correlation-id"],
      };
    }, {
      headers: readHeaders,
      params: t.Object({ id: t.String({ minLength: 1 }) }),
    })
    .get("/v2/applications/:id", async ({ headers, params, set }) => {
      const application = await Effect.runPromise(Effect.tryPromise(() =>
        queries.findForTenant(headers["x-tenant-id"], params.id),
      ));
      if (!application) {
        set.status = 404;
        return { code: "NOT_FOUND" as const, message: "Application not found.", correlationId: headers["x-correlation-id"] };
      }
      return { ...application, correlationId: headers["x-correlation-id"] };
    }, {
      headers: readHeaders,
      params: t.Object({ id: t.String({ minLength: 1 }) }),
    })
    .post("/v2/applications/:id/resume-analysis", async ({ body, headers, params, set }) => {
      const result = await Effect.runPromise(Effect.tryPromise(() => resumeAnalysis.request({
        applicationId: params.id,
        tenantId: headers["x-tenant-id"],
        correlationId: headers["x-correlation-id"],
        idempotencyKey: headers["idempotency-key"],
        resumeRevision: body.resumeRevision,
      })));
      set.status = result.ok ? 202 : 404;
      return { ...result, correlationId: headers["x-correlation-id"] };
    }, {
      body: t.Object({ resumeRevision: t.Integer({ minimum: 1 }) }),
      headers: t.Object({
        "x-tenant-id": t.String({ minLength: 1 }),
        "x-correlation-id": t.String({ minLength: 1 }),
        "idempotency-key": t.String({ minLength: 1 }),
      }, { additionalProperties: true }),
      params: t.Object({ id: t.String({ minLength: 1 }) }),
    })
    .get("/v2/async-jobs/:id", async ({ headers, params, set }) => {
      const run = await Effect.runPromise(Effect.tryPromise(() =>
        resumeAnalysis.findJob(headers["x-tenant-id"], params.id),
      ));
      if (!run) {
        set.status = 404;
        return { code: "NOT_FOUND" as const, message: "Async job not found.", correlationId: headers["x-correlation-id"] };
      }
      return { ...run, correlationId: headers["x-correlation-id"] };
    }, {
      headers: readHeaders,
      params: t.Object({ id: t.String({ minLength: 1 }) }),
    })
    .post("/v2/applications/:id/transitions", async ({ body, headers, params, set }) => {
      const correlationId = headers["x-correlation-id"];
      const result = await Effect.runPromise(Effect.tryPromise(() => applicationService.transition({
        applicationId: params.id,
        tenantId: headers["x-tenant-id"],
        actorId: headers["x-actor-id"],
        correlationId,
        idempotencyKey: headers["idempotency-key"],
        to: body.to,
        occurredAt: body.occurredAt,
      })));
      if (!result.ok) set.status = result.code === "NOT_FOUND" ? 404 : 409;
      return { ...result, correlationId };
    }, {
      body: t.Object({
        to: t.Union([
          t.Literal("resume_analysis"),
          t.Literal("recruiter_screening"),
          t.Literal("functional_interview"),
        ]),
        occurredAt: t.String({ format: "date-time" }),
      }),
      headers: t.Object({
        "x-tenant-id": t.String({ minLength: 1 }),
        "x-actor-id": t.String({ minLength: 1 }),
        "x-correlation-id": t.String({ minLength: 1 }),
        "idempotency-key": t.String({ minLength: 1 }),
      }, { additionalProperties: true }),
      params: t.Object({ id: t.String({ minLength: 1 }) }),
    });
}
