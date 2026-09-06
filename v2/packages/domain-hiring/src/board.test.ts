import { describe, expect, test } from "bun:test";
import { buildCandidateBoard } from "./board";

describe("candidate board", () => {
  test("always returns exactly the three ordered operational stages", () => {
    const board = buildCandidateBoard("job_001", [
      { id: "app_3", jobId: "job_001", tenantId: "org_001", candidateName: "Chen Wei", stage: "functional_interview", decision: "active", source: "ats", asyncStatus: "ready" },
      { id: "app_1", jobId: "job_001", tenantId: "org_001", candidateName: "Aditi Sharma", stage: "resume_analysis", decision: "active", source: "referral", asyncStatus: "queued" },
    ]);

    expect(board.columns.map((column) => column.stage)).toEqual([
      "resume_analysis",
      "recruiter_screening",
      "functional_interview",
    ]);
    expect(board.columns[1]?.applications).toEqual([]);
  });

  test("keeps decisions on cards instead of creating outcome columns", () => {
    const board = buildCandidateBoard("job_001", [
      { id: "app_1", jobId: "job_001", tenantId: "org_001", candidateName: "Aditi Sharma", stage: "functional_interview", decision: "hired", source: "referral", asyncStatus: "ready" },
    ]);
    expect(board.columns).toHaveLength(3);
    expect(board.columns[2]?.applications[0]).toMatchObject({ decision: "hired", stage: "functional_interview" });
  });
});
