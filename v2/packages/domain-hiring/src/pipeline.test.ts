import { describe, expect, test } from "bun:test";
import { transitionApplication } from "./pipeline";

const base = {
  id: "app_001",
  tenantId: "org_001",
  stage: "resume_analysis" as const,
  decision: "active" as const,
};

describe("application pipeline", () => {
  test("resume analysis can advance to recruiter screening when complete", () => {
    expect(transitionApplication(base, "recruiter_screening", {
      resumeAnalysisComplete: true,
      screeningComplete: false,
    })).toMatchObject({ ok: true, from: "resume_analysis", to: "recruiter_screening" });
  });

  test("cannot skip recruiter screening", () => {
    expect(transitionApplication(base, "functional_interview", {
      resumeAnalysisComplete: true,
      screeningComplete: true,
    })).toEqual({
      ok: false,
      code: "ILLEGAL_TRANSITION",
      message: "Recruiter screening must be completed before the functional interview.",
    });
  });

  test("screening must be complete before functional interview", () => {
    expect(transitionApplication({ ...base, stage: "recruiter_screening" }, "functional_interview", {
      resumeAnalysisComplete: true,
      screeningComplete: false,
    })).toMatchObject({ ok: false, code: "INTERVIEW_INCOMPLETE" });
  });

  test("hire and reject remain decisions and do not change stage", () => {
    expect(transitionApplication({ ...base, decision: "hired" }, "recruiter_screening", {
      resumeAnalysisComplete: true,
      screeningComplete: false,
    })).toMatchObject({ ok: false, code: "APPLICATION_INACTIVE" });
  });
});
