import { expect, test } from "bun:test"; import type { JobEnvelopeV1 } from "@interviehire/contracts"; import { createRetentionProcessor, type AutomationRunStore } from "./retention";
const envelope: JobEnvelopeV1 = { jobId: "retention:2026-09-07", tenantId: "platform", correlationId: "retention", idempotencyKey: "retention:2026-09-07", resourceRef: { type: "job", id: "legacy-retention" }, requestedAt: "2026-09-07T00:00:00.000Z", version: 1, payload: { dryRun: false } };
test("retention automation is retry-safe and calls the legacy compliance engine once", async () => {
  let state = "pending"; let calls = 0; const store: AutomationRunStore = { claim: async () => state === "complete" ? { kind: "complete" } : { kind: "claimed" }, complete: async () => { state = "complete"; }, fail: async () => { state = "failed"; } };
  const processor = createRetentionProcessor(store, { runRetention: async () => { calls++; return { anonymised: 3 }; } }, () => "2026-09-07T00:01:00.000Z");
  expect(await processor(envelope)).toMatchObject({ replayed: false, result: { anonymised: 3 } }); expect(await processor(envelope)).toMatchObject({ replayed: true }); expect(calls).toBe(1);
});
