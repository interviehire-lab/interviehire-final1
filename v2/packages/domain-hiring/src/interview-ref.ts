import type { ApplicationInterviewRef } from "@interviehire/contracts";

export function createApplicationInterviewRef(input: ApplicationInterviewRef): ApplicationInterviewRef {
  if (!input.applicationId || !input.interviewSessionId) throw new Error("Both explicit IDs are required");
  return Object.freeze({ ...input });
}
