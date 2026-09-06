import { expect, test } from "bun:test";
import type { ApplicationRepository, SchedulingService } from "@interviehire/domain-hiring";
import { createCoreApp } from "./app";

const applicationRepository: ApplicationRepository = {
  transaction: (work) => work(applicationRepository), find: async () => undefined,
  updateStage: async () => undefined, appendHistory: async () => undefined,
  appendOutbox: async () => undefined, hasCommand: async () => false,
  recordCommand: async () => undefined,
};
const scheduling: SchedulingService = {
  schedule: async (command) => ({
    ok: true, applicationId: command.applicationId, interviewSessionId: "session_9f8d",
    interviewStage: command.interviewStage, scheduledAt: command.scheduledAt, replayed: false,
  }),
};

test("POST schedule returns the explicit Interview session reference", async () => {
  const response = await createCoreApp({ applicationRepository, scheduling }).handle(new Request(
    "http://localhost/v2/applications/app_001/schedule",
    {
      method: "POST",
      headers: {
        "content-type": "application/json", "x-tenant-id": "org_001",
        "x-actor-id": "recruiter_001", "x-correlation-id": "corr_schedule",
        "idempotency-key": "schedule_001",
      },
      body: JSON.stringify({
        interviewStage: "recruiter_screening", scheduledAt: "2026-09-08T09:00:00.000Z",
        timeZone: "Asia/Kolkata", deliveryMethods: ["email"],
      }),
    },
  ));
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({
    applicationId: "app_001", interviewSessionId: "session_9f8d",
    interviewStage: "recruiter_screening", correlationId: "corr_schedule",
  });
});
