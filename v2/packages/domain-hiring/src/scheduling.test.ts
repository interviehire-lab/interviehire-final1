import { describe, expect, test } from "bun:test";
import {
  createSchedulingService,
  type ScheduleRepository,
  type ScheduledInterview,
} from "./scheduling";

function repository(stage: "resume_analysis" | "recruiter_screening" = "resume_analysis") {
  const schedules: ScheduledInterview[] = [];
  const repo: ScheduleRepository & { schedules: ScheduledInterview[] } = {
    schedules,
    findApplication: async (tenantId, id) => tenantId === "org_001" && id === "app_001" ? {
      id, tenantId, stage, decision: "active", resumeAnalysisComplete: true,
      screeningComplete: stage === "recruiter_screening",
    } : undefined,
    findByIdempotencyKey: async (_tenantId, key) => schedules.find((schedule) => schedule.idempotencyKey === key),
    commitSchedule: async (schedule) => { schedules.push(schedule); },
  };
  return repo;
}

const base = {
  applicationId: "app_001", tenantId: "org_001", interviewStage: "recruiter_screening" as const,
  scheduledAt: "2026-09-08T09:00:00.000Z", timeZone: "Asia/Kolkata",
  deliveryMethods: ["email"] as const, correlationId: "corr_schedule",
  idempotencyKey: "schedule_001", actorId: "recruiter_001",
};

describe("interview scheduling", () => {
  test("persists an explicit independently generated session reference", async () => {
    const repo = repository();
    const service = createSchedulingService(repo, {
      provision: async () => ({ interviewSessionId: "session_9f8d" }),
    }, () => "2026-09-07T08:00:00.000Z");
    expect(await service.schedule(base)).toEqual({
      ok: true, applicationId: "app_001", interviewSessionId: "session_9f8d",
      interviewStage: "recruiter_screening", scheduledAt: base.scheduledAt, replayed: false,
    });
    expect(repo.schedules[0]).toMatchObject({ applicationId: "app_001", interviewSessionId: "session_9f8d" });
    expect(repo.schedules[0]?.applicationId).not.toBe(repo.schedules[0]?.interviewSessionId);
  });

  test("does not persist or move stage when Interview provisioning fails", async () => {
    const repo = repository();
    const service = createSchedulingService(repo, {
      provision: async () => { throw new Error("Interview API unavailable"); },
    }, () => "2026-09-07T08:00:00.000Z");
    await expect(service.schedule(base)).rejects.toThrow("Interview API unavailable");
    expect(repo.schedules).toHaveLength(0);
  });

  test("rejects functional scheduling until screening is complete without calling Interview", async () => {
    const repo = repository();
    let calls = 0;
    const service = createSchedulingService(repo, {
      provision: async () => { calls += 1; return { interviewSessionId: "session_nope" }; },
    }, () => "2026-09-07T08:00:00.000Z");
    expect(await service.schedule({ ...base, interviewStage: "functional_interview" })).toMatchObject({
      ok: false, code: "ILLEGAL_TRANSITION",
    });
    expect(calls).toBe(0);
  });

  test("idempotent replay does not provision another session", async () => {
    const repo = repository();
    let calls = 0;
    const service = createSchedulingService(repo, {
      provision: async () => { calls += 1; return { interviewSessionId: "session_9f8d" }; },
    }, () => "2026-09-07T08:00:00.000Z");
    await service.schedule(base);
    expect(await service.schedule(base)).toMatchObject({ interviewSessionId: "session_9f8d", replayed: true });
    expect(calls).toBe(1);
  });
});
