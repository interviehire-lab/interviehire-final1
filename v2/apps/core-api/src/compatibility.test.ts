import { expect, test } from "bun:test";
import { createCoreApp } from "./app"; import { createLegacyGateway } from "./compatibility"; import type { ApplicationRepository } from "@interviehire/domain-hiring";
const applicationRepository: ApplicationRepository = { transaction: (work) => work(applicationRepository), find: async () => undefined, updateStage: async () => undefined, appendHistory: async () => undefined, appendOutbox: async () => undefined, hasCommand: async () => false, recordCommand: async () => undefined };
test("compatibility boundary forwards secondary routes without database access", async () => {
  let url = ""; const legacyGateway = createLegacyGateway({ baseUrl: "http://legacy/", fetch: async (request) => { url = request.url; return Response.json({ proxied: true }); } });
  const response = await createCoreApp({ applicationRepository, legacyGateway }).handle(new Request("http://core/compat/api/talent-finder/sources?active=true"));
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ proxied: true }); expect(url).toBe("http://legacy/api/talent-finder/sources?active=true");
});
