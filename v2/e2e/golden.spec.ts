import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const coreHeaders = { "x-tenant-id": "tenant_demo", "x-correlation-id": "golden-e2e" };
const internalHeaders = { "x-internal-secret": "dev-internal-secret", "idempotency-key": "golden-e2e" };

function indiaSlot() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(Date.now() + 2 * 60_000));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { date: `${value.year}-${value.month}-${value.day}`, time: `${value.hour}:${value.minute}` };
}

async function schedule(page: Page, candidateName: string, stageLabel: string) {
  await page.getByRole("combobox", { name: `Move ${candidateName} to` }).click();
  await page.getByRole("option", { name: stageLabel }).click();
  const slot = indiaSlot();
  await page.getByLabel("Date").fill(slot.date);
  await page.getByLabel("Time", { exact: true }).fill(slot.time);
  const responsePromise = page.waitForResponse((response) => response.url().includes("/schedule") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Schedule & move" }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  return (await response.json()) as { interviewSessionId: string };
}

async function completeInterview(request: APIRequestContext, sessionId: string, suffix: string) {
  const endpoint = `http://127.0.0.1:4200/internal/livekit/sessions/${sessionId}`;
  expect((await request.post(`${endpoint}/start`, { headers: { ...internalHeaders, "idempotency-key": `${suffix}-start` }, data: {} })).ok()).toBe(true);
  expect((await request.post(`${endpoint}/turn`, {
    headers: { ...internalHeaders, "idempotency-key": `${suffix}-turn` },
    data: { text: "I designed an idempotent TypeScript event pipeline with PostgreSQL and Redis.", turnId: `${suffix}-turn`, metrics: { latencyMs: 240 } },
  })).ok()).toBe(true);
  expect((await request.post(`${endpoint}/complete`, { headers: { ...internalHeaders, "idempotency-key": `${suffix}-complete` }, data: { reason: "candidate_ended" } })).ok()).toBe(true);
}

test("recruiter golden path reaches a durable hiring decision", async ({ page, request }) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Senior Software Engineer" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Resume Analysis" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recruiter Screening" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Functional Interview" })).toBeVisible();
  await expect(page.getByText("8 candidates")).toBeVisible();

  await page.locator("article").filter({ hasText: "Kabir Mehta" }).dragTo(page.getByRole("region", { name: "Recruiter Screening" }));
  await expect(page.getByRole("heading", { name: "Schedule recruiter screening" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Add candidate" }).click();
  await page.getByLabel("Full name").fill("Priya Menon");
  await page.getByLabel("Email").fill("priya.menon@example.test");
  await page.getByLabel("Resume text").fill("Senior TypeScript engineer with PostgreSQL and distributed systems experience.");
  await page.getByRole("button", { name: "Add to pipeline" }).click();
  await expect(page.getByText("9 candidates")).toBeVisible();

  const card = page.locator("article").filter({ hasText: "Priya Menon" });
  await card.getByRole("button", { name: "Analyse" }).click();
  await expect(page.getByText("Priya Menon's analysis is queued.")).toBeVisible();
  await expect(card.getByText("Analysis ready")).toBeVisible();
  await card.getByRole("button", { name: /Details/ }).click();
  await page.getByRole("tab", { name: "Resume" }).click();
  await expect(page.getByText("Recommendation: advance")).toBeVisible();
  await expect(page.getByText("94", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  const screening = await schedule(page, "Priya Menon", "Recruiter Screening");
  await expect(page.getByRole("region", { name: "Recruiter Screening" }).getByText("Priya Menon")).toBeVisible();
  await completeInterview(request, screening.interviewSessionId, "screening");
  await expect.poll(async () => {
    const board = await (await request.get("http://127.0.0.1:4100/v2/jobs/job_software_engineer/board", { headers: coreHeaders })).json();
    return board.columns.flatMap((column: { applications: Array<{ candidateName: string; id: string }> }) => column.applications).find((candidate: { candidateName: string }) => candidate.candidateName === "Priya Menon")?.id;
  }).toBeTruthy();
  const board = await (await request.get("http://127.0.0.1:4100/v2/jobs/job_software_engineer/board", { headers: coreHeaders })).json();
  const applicationId = board.columns.flatMap((column: { applications: Array<{ candidateName: string; id: string }> }) => column.applications).find((candidate: { candidateName: string }) => candidate.candidateName === "Priya Menon").id;
  expect(screening.interviewSessionId).not.toBe(applicationId);
  await expect.poll(async () => (await (await request.get(`http://127.0.0.1:4100/v2/applications/${applicationId}/deep-analysis`, { headers: coreHeaders })).json()).status).toBe("evaluated");
  await expect.poll(async () => (await (await request.get(`http://127.0.0.1:4100/v2/applications/${applicationId}`, { headers: coreHeaders })).json()).screeningComplete).toBe(true);

  const functional = await schedule(page, "Priya Menon", "Functional Interview");
  await completeInterview(request, functional.interviewSessionId, "functional");
  await expect.poll(async () => (await (await request.get(`http://127.0.0.1:4100/v2/applications/${applicationId}/deep-analysis`, { headers: coreHeaders })).json()).status).toBe("evaluated");
  await page.getByRole("region", { name: "Functional Interview" }).getByRole("button", { name: "Priya Menon" }).click();
  await page.getByRole("tab", { name: "Deep Analysis" }).click();
  await expect(page.getByText("Overall recommendation")).toBeVisible();
  await expect(page.getByText("Structured competencies")).toBeVisible();
  await expect(page.getByText("Proctoring observations")).toBeVisible();
  await page.getByRole("button", { name: "Hire candidate" }).click();
  await expect(page.getByText("Priya Menon marked hired.")).toBeVisible();
  await page.reload();
  await expect(page.locator("article").filter({ hasText: "Priya Menon" }).getByText("hired")).toBeVisible();
  expect(browserErrors).toEqual([]);
});
