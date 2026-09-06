import { Elysia, t } from "elysia";
import { Effect } from "effect";
import { createApplicationService, type ApplicationRepository } from "@interviehire/domain-hiring";

export interface CoreAppDependencies {
  readonly applicationRepository: ApplicationRepository;
}

export function createCoreApp(dependencies: CoreAppDependencies) {
  const applicationService = createApplicationService(dependencies.applicationRepository);

  return new Elysia({ name: "interviehire-v2-core" })
    .get("/health", () => ({ status: "ok", service: "core-api" }))
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
