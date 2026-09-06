import { expect, test } from "bun:test";
import { FakeLlm, FixedClock, createApplicationFixture } from "./index";

test("fixed clock and fixture factories are deterministic", async () => {
  const clock = new FixedClock("2026-09-07T04:00:00.000Z");
  expect(clock.now().toISOString()).toBe("2026-09-07T04:00:00.000Z");
  expect(createApplicationFixture().id).toBe("app_fixture_001");
  expect(await new FakeLlm({ score: 87 }).analyseResume("app_fixture_001")).toEqual({ score: 87 });
});
