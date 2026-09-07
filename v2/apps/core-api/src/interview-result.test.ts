import { expect, test } from "bun:test";
import type { ApplicationRepository } from "@interviehire/domain-hiring";
import { createCoreApp } from "./app";

const repository: ApplicationRepository = {
  transaction: (work) => work(repository), find: async () => undefined, updateStage: async () => undefined,
  appendHistory: async () => undefined, appendOutbox: async () => undefined, hasCommand: async () => false,
  recordCommand: async () => undefined,
};

test("internal interview result command is authenticated and delegates mapped evaluation", async () => {
  let recorded = "";
  const app = createCoreApp({
    applicationRepository: repository,
    internalServiceSecret: "secret",
    interviewResults: { record: async (input) => { recorded = input.interviewSessionId; return { ok: true, screeningComplete: true }; } },
  });
  const unauthorized = await app.handle(new Request("http://localhost/internal/v2/interview-results", {
    method: "POST", headers: { "content-type": "application/json", "x-internal-secret": "wrong", "x-tenant-id": "tenant_1" },
    body: JSON.stringify({ applicationId: "app_1", interviewSessionId: "session_1", interviewStage: "recruiter_screening" }),
  }));
  expect(unauthorized.status).toBe(401);
  const response = await app.handle(new Request("http://localhost/internal/v2/interview-results", {
    method: "POST", headers: { "content-type": "application/json", "x-internal-secret": "secret", "x-tenant-id": "tenant_1" },
    body: JSON.stringify({ applicationId: "app_1", interviewSessionId: "session_1", interviewStage: "recruiter_screening" }),
  }));
  expect(response.status).toBe(200);
  expect(recorded).toBe("session_1");
});
