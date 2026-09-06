import postgres from "postgres";
export async function migrateInterviewDatabase(url: string): Promise<void> {
  const sql = postgres(url, { max: 1 });
  try {
    for (const name of ["0001_interview_sessions.sql", "0002_voice_contract.sql", "0003_evaluations.sql"]) {
      await sql.unsafe(await Bun.file(new URL(`../migrations/${name}`, import.meta.url)).text());
    }
  }
  finally { await sql.end(); }
}
if (import.meta.main) { const url = process.env.TEST_DATABASE_URL ?? process.env.INTERVIEW_DATABASE_URL; if (!url) throw new Error("INTERVIEW_DATABASE_URL is required"); await migrateInterviewDatabase(url); }
