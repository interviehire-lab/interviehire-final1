import type { InterviewProvisioner } from "@interviehire/domain-hiring";
export function createHttpInterviewProvisioner(options: { baseUrl: string; internalSecret: string; fetch?: typeof fetch }): InterviewProvisioner {
  const request = options.fetch ?? fetch;
  return { async provision(input) {
    const response = await request(new Request(`${options.baseUrl}/internal/v2/sessions`, { method: "POST", headers: { "content-type": "application/json", "x-internal-secret": options.internalSecret, "x-tenant-id": input.tenantId, "x-correlation-id": input.correlationId, "idempotency-key": input.idempotencyKey }, body: JSON.stringify({ applicationId: input.applicationId, interviewStage: input.interviewStage, scheduledAt: input.scheduledAt, timeZone: input.timeZone }) }));
    if (!response.ok) throw new Error(`Interview provisioning failed (${response.status}).`);
    const result = await response.json() as { ok: boolean; interviewSessionId?: string };
    if (!result.ok || !result.interviewSessionId) throw new Error("Interview provisioning returned an invalid response.");
    return { interviewSessionId: result.interviewSessionId };
  } };
}
