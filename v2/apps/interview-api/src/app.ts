import { Elysia, t } from "elysia";
import { Effect } from "effect";
import type { SessionProvisioningService } from "@interviehire/domain-interview";
export interface InterviewAppDependencies { readonly provisioning: SessionProvisioningService; readonly internalSecret: string }
export function createInterviewApp(dependencies: InterviewAppDependencies) {
  return new Elysia({ name: "interviehire-v2-interview" }).get("/health", () => ({ status: "ok", service: "interview-api" }))
    .post("/internal/v2/sessions", async ({ body, headers, set }) => {
      if (headers["x-internal-secret"] !== dependencies.internalSecret) { set.status = 401; return { ok: false as const, code: "BAD_INTERNAL_SECRET" as const, message: "Unauthorized." }; }
      const result = await Effect.runPromise(Effect.tryPromise(() => dependencies.provisioning.provision({ ...body, tenantId: headers["x-tenant-id"], correlationId: headers["x-correlation-id"], idempotencyKey: headers["idempotency-key"] })));
      set.status = result.ok ? 201 : 400;
      return { ...result, correlationId: headers["x-correlation-id"] };
    }, { body: t.Object({ applicationId: t.String({ minLength: 1 }), interviewStage: t.Union([t.Literal("recruiter_screening"), t.Literal("functional_interview")]), scheduledAt: t.String({ format: "date-time" }), timeZone: t.String({ minLength: 1 }) }), headers: t.Object({ "x-tenant-id": t.String({ minLength: 1 }), "x-correlation-id": t.String({ minLength: 1 }), "idempotency-key": t.String({ minLength: 1 }), "x-internal-secret": t.Optional(t.String()) }, { additionalProperties: true }) });
}
