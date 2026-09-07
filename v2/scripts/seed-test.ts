import { applications, connectHiringDatabase, migrateHiringDatabase } from "@interviehire/db-hiring";
import { migrateInterviewDatabase } from "@interviehire/db-interview";
import { migrateOpsDatabase } from "@interviehire/db-ops";
import { resetHiringDb, resetInterviewDb, resetOpsDb } from "@interviehire/testing";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
await migrateHiringDatabase(databaseUrl);
await migrateInterviewDatabase(databaseUrl);
await migrateOpsDatabase(databaseUrl);
await resetOpsDb(databaseUrl);
await resetInterviewDb(databaseUrl);
await resetHiringDb(databaseUrl);
const connection = connectHiringDatabase(databaseUrl);
try {
  await connection.db.insert(applications).values({
    id: "app_test", tenantId: "tenant_test", jobId: "job_test", candidateName: "Test Candidate",
    candidateEmail: "candidate@example.test", source: "test", resumeText: "TypeScript engineer.",
  });
  console.log("Seeded minimal V2 test fixture: tenant_test / job_test / app_test");
} finally {
  await connection.client.end();
}
