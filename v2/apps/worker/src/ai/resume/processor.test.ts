import { describe, expect, test } from "bun:test";
import type { JobEnvelopeV1 } from "@interviehire/contracts";
import {
  createResumeAnalysisProcessor,
  createHttpResumeAnalysisProvider,
  TransientProviderError,
  type ResumeAnalysisWorkerStore,
} from "./processor";

const envelope: JobEnvelopeV1 = {
  jobId: "evt_resume_001", tenantId: "org_001", correlationId: "corr_resume",
  idempotencyKey: "evt_resume_001", resourceRef: { type: "application", id: "app_001" },
  requestedAt: "2026-09-07T06:00:00.000Z", version: 1,
  payload: { eventType: "resume-analysis.requested.v1", runId: "resume_run_001" },
};

function store(): ResumeAnalysisWorkerStore & { state: { status: string; attempt: number; result: unknown } } {
  const state = { status: "queued", attempt: 0, result: null as unknown };
  return {
    state,
    claim: async () => {
      if (state.status === "ready") return { kind: "ready" };
      state.status = "running";
      state.attempt += 1;
      return { kind: "claimed", applicationId: "app_001" };
    },
    loadResumeText: async () => "Five years of TypeScript and distributed systems experience.",
    complete: async (_runId, result) => { state.status = "ready"; state.result = result; },
    fail: async () => { state.status = "failed"; },
  };
}

describe("resume analysis worker", () => {
  test("moves queued to running to ready with deterministic provider output", async () => {
    const persistence = store();
    let calls = 0;
    const processor = createResumeAnalysisProcessor(persistence, {
      analyseResume: async () => { calls += 1; return { score: 87, recommendation: "advance" }; },
    }, () => "2026-09-07T06:01:00.000Z");
    expect(await processor(envelope)).toEqual({ replayed: false, runId: "resume_run_001" });
    expect(persistence.state).toEqual({ status: "ready", attempt: 1, result: { score: 87, recommendation: "advance" } });
    expect(calls).toBe(1);
  });

  test("duplicate delivery replays READY without calling the provider", async () => {
    const persistence = store();
    persistence.state.status = "ready";
    let calls = 0;
    const processor = createResumeAnalysisProcessor(persistence, {
      analyseResume: async () => { calls += 1; return { score: 1 }; },
    }, () => "2026-09-07T06:01:00.000Z");
    expect(await processor(envelope)).toEqual({ replayed: true, runId: "resume_run_001" });
    expect(calls).toBe(0);
  });

  test("records transient failure and can succeed on retry", async () => {
    const persistence = store();
    let calls = 0;
    const processor = createResumeAnalysisProcessor(persistence, {
      analyseResume: async () => {
        calls += 1;
        if (calls === 1) throw new TransientProviderError("rate limited");
        return { score: 81 };
      },
    }, () => "2026-09-07T06:01:00.000Z");
    await expect(processor(envelope)).rejects.toThrow("rate limited");
    expect(persistence.state.status).toBe("failed");
    expect(await processor(envelope)).toMatchObject({ replayed: false });
    expect(persistence.state).toMatchObject({ status: "ready", attempt: 2, result: { score: 81 } });
  });
});

test("HTTP resume provider keeps real integrations injectable and classifies rate limits", async () => {
  let authorization = "";
  const provider = createHttpResumeAnalysisProvider({ url: "https://provider.test/resume", apiKey: "secret", fetch: async (_url, init) => { authorization = new Headers(init?.headers).get("authorization") ?? ""; return Response.json({ score: 90 }); } });
  expect(await provider.analyseResume({ applicationId: "app_1", resumeText: "TypeScript", correlationId: "corr_1" })).toEqual({ score: 90 });
  expect(authorization).toBe("Bearer secret");
  const limited = createHttpResumeAnalysisProvider({ url: "https://provider.test/resume", fetch: async () => new Response(null, { status: 429 }) });
  await expect(limited.analyseResume({ applicationId: "app_1", resumeText: "x", correlationId: "corr_1" })).rejects.toBeInstanceOf(TransientProviderError);
});
