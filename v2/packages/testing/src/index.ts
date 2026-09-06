export interface Clock { now(): Date }

export class FixedClock implements Clock {
  readonly #instant: Date;
  constructor(instant: string | Date) {
    this.#instant = new Date(instant);
    if (Number.isNaN(this.#instant.valueOf())) throw new Error("FixedClock requires a valid instant");
  }
  now(): Date { return new Date(this.#instant); }
}

export class FakeLlm<TResume = unknown> {
  readonly #resumeResult: TResume;
  calls = 0;
  constructor(resumeResult: TResume) { this.#resumeResult = resumeResult; }
  async analyseResume(_applicationId: string): Promise<TResume> {
    this.calls += 1;
    return structuredClone(this.#resumeResult);
  }
}

export function createApplicationFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "app_fixture_001",
    tenantId: "org_fixture_001",
    stage: "resume_analysis" as const,
    decision: "active" as const,
    resumeAnalysisComplete: false,
    screeningComplete: false,
    ...overrides,
  };
}

export * from "./database";
export * from "./queue";
