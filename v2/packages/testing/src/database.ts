import postgres from "postgres";

export async function resetHiringDb(url: string): Promise<void> {
  const sql = postgres(url, { max: 1 });
  try {
    await sql`TRUNCATE v2_resume_analysis_runs, v2_application_interview_refs, v2_application_stage_history, v2_hiring_outbox, v2_applications CASCADE`;
  } finally { await sql.end(); }
}

export async function seedScenario(url: string, scenario: { applicationId: string; tenantId: string }): Promise<void> {
  const sql = postgres(url, { max: 1 });
  try {
    await sql`INSERT INTO v2_applications (id, tenant_id) VALUES (${scenario.applicationId}, ${scenario.tenantId})`;
  } finally { await sql.end(); }
}

export async function resetInterviewDb(_url: string): Promise<void> {
  throw new Error("Interview schema is not part of the foundation slice yet");
}
