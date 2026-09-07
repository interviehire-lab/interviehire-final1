import type { JobEnvelopeV1 } from "@interviehire/contracts";
import type { InterviewStage } from "@interviehire/domain-interview";

export interface CoreInterviewResultClient {
  notify(input: {
    readonly tenantId: string;
    readonly applicationId: string;
    readonly interviewSessionId: string;
    readonly interviewStage: InterviewStage;
    readonly correlationId: string;
  }): Promise<void>;
}

export function createHttpCoreInterviewResultClient(options: { baseUrl: string; internalSecret: string; fetch?: typeof fetch }): CoreInterviewResultClient {
  const send = options.fetch ?? fetch;
  return {
    async notify(input) {
      const response = await send(new Request(new URL("/internal/v2/interview-results", options.baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json", "x-internal-secret": options.internalSecret, "x-tenant-id": input.tenantId },
        body: JSON.stringify({ applicationId: input.applicationId, interviewSessionId: input.interviewSessionId, interviewStage: input.interviewStage }),
      }));
      if (!response.ok) throw new Error(`Core interview-result command failed (${response.status}).`);
    },
  };
}

export function createInterviewResultProcessor(client: CoreInterviewResultClient) {
  return async (envelope: JobEnvelopeV1) => {
    const applicationId = envelope.payload?.applicationId;
    const interviewStage = envelope.payload?.interviewStage;
    if (envelope.resourceRef.type !== "interview_session" || typeof applicationId !== "string" || !["recruiter_screening", "functional_interview"].includes(String(interviewStage))) {
      throw new Error("Interview evaluated event is invalid");
    }
    const interviewSessionId = envelope.resourceRef.id;
    await client.notify({ tenantId: envelope.tenantId, applicationId, interviewSessionId, interviewStage: interviewStage as InterviewStage, correlationId: envelope.correlationId });
    return { applicationId, interviewSessionId };
  };
}
