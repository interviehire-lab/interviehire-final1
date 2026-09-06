import { Elysia, t } from "elysia";
import { Effect } from "effect";
import type { CompletionReason, InterviewEvaluationQueries, SessionProvisioningService, VoiceService } from "@interviehire/domain-interview";
export interface InterviewAppDependencies { readonly provisioning: SessionProvisioningService; readonly voice?: VoiceService; readonly evaluationQueries?: InterviewEvaluationQueries; readonly internalSecret: string }
export function createInterviewApp(dependencies: InterviewAppDependencies) {
  const authorized = (headers: Record<string, string | undefined>) => headers["x-internal-secret"] === dependencies.internalSecret;
  const unavailable = () => ({ ok: false as const, code: "SESSION_NOT_FOUND" as const, message: "Interview session not found." });
  const voice = dependencies.voice;
  return new Elysia({ name: "interviehire-v2-interview" }).get("/health", () => ({ status: "ok", service: "interview-api" }))
    .post("/internal/v2/sessions", async ({ body, headers, set }) => {
      if (headers["x-internal-secret"] !== dependencies.internalSecret) { set.status = 401; return { ok: false as const, code: "BAD_INTERNAL_SECRET" as const, message: "Unauthorized." }; }
      const result = await Effect.runPromise(Effect.tryPromise(() => dependencies.provisioning.provision({ ...body, tenantId: headers["x-tenant-id"], correlationId: headers["x-correlation-id"], idempotencyKey: headers["idempotency-key"] })));
      set.status = result.ok ? 201 : 400;
      return { ...result, correlationId: headers["x-correlation-id"] };
    }, { body: t.Object({ applicationId: t.String({ minLength: 1 }), interviewStage: t.Union([t.Literal("recruiter_screening"), t.Literal("functional_interview")]), scheduledAt: t.String({ format: "date-time" }), timeZone: t.String({ minLength: 1 }) }), headers: t.Object({ "x-tenant-id": t.String({ minLength: 1 }), "x-correlation-id": t.String({ minLength: 1 }), "idempotency-key": t.String({ minLength: 1 }), "x-internal-secret": t.Optional(t.String()) }, { additionalProperties: true }) })
    .get("/internal/v2/sessions/:id/evaluation", async ({ headers, params, set }) => {
      if (!authorized(headers)) { set.status = 401; return { error: "unauthorized", code: "BAD_INTERNAL_SECRET" }; }
      const result = await dependencies.evaluationQueries?.find(headers["x-tenant-id"], params.id);
      if (!result) { set.status = 404; return { error: "Interview session not found.", code: "SESSION_NOT_FOUND" }; }
      return { ...result, correlationId: headers["x-correlation-id"] };
    }, { params: t.Object({ id: t.String({ minLength: 1 }) }), headers: t.Object({ "x-internal-secret": t.Optional(t.String()), "x-tenant-id": t.String({ minLength: 1 }), "x-correlation-id": t.String({ minLength: 1 }) }, { additionalProperties: true }) })
    .post("/internal/livekit/sessions/:id/start", async ({ body, headers, params, set }) => {
      if (!authorized(headers)) { set.status = 401; return { error: "unauthorized", code: "BAD_INTERNAL_SECRET" }; }
      const result = voice ? await voice.start(params.id, body) : unavailable();
      if (!result.ok) { set.status = result.code === "SESSION_NOT_FOUND" ? 404 : result.code === "CV_REQUIRED" ? 400 : 403; return { error: result.message, code: result.code }; }
      return result;
    }, { params: t.Object({ id: t.String({ minLength: 1 }) }), headers: t.Object({ "x-internal-secret": t.Optional(t.String()), "idempotency-key": t.String({ minLength: 1 }) }, { additionalProperties: true }), body: t.Object({ token: t.Optional(t.String()) }, { additionalProperties: true }) })
    .post("/internal/livekit/sessions/:id/turn", async ({ body, headers, params, set }) => {
      if (!authorized(headers)) { set.status = 401; return { error: "unauthorized", code: "BAD_INTERNAL_SECRET" }; }
      const result = voice ? await voice.turn(params.id, { text: body.text, turnId: body.turnId || headers["idempotency-key"], metrics: body.metrics ?? {} }) : unavailable();
      if (!result.ok) { set.status = result.code === "SESSION_NOT_FOUND" ? 404 : result.code === "EMPTY_TRANSCRIPT" ? 400 : 409; return { error: result.message, code: result.code }; }
      return result;
    }, { params: t.Object({ id: t.String({ minLength: 1 }) }), headers: t.Object({ "x-internal-secret": t.Optional(t.String()), "idempotency-key": t.String({ minLength: 1 }) }, { additionalProperties: true }), body: t.Object({ text: t.String(), turnId: t.Optional(t.String({ maxLength: 128 })), metrics: t.Optional(t.Record(t.String(), t.Unknown())) }) })
    .post("/internal/livekit/sessions/:id/complete", async ({ body, headers, params, set }) => {
      if (!authorized(headers)) { set.status = 401; return { error: "unauthorized", code: "BAD_INTERNAL_SECRET" }; }
      const allowed: CompletionReason[] = ["director_completed", "all_questions_asked", "time_limit", "candidate_ended"];
      const reason: CompletionReason = allowed.includes(body.reason as CompletionReason) ? body.reason as CompletionReason : "candidate_ended";
      const result = voice ? await voice.complete(params.id, reason) : unavailable();
      if (!result.ok) { set.status = 404; return { error: result.message, code: result.code }; }
      return result;
    }, { params: t.Object({ id: t.String({ minLength: 1 }) }), headers: t.Object({ "x-internal-secret": t.Optional(t.String()), "idempotency-key": t.String({ minLength: 1 }) }, { additionalProperties: true }), body: t.Object({ reason: t.Optional(t.String()) }, { additionalProperties: true }) });
}
