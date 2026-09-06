import postgres from "postgres";
export async function migrateOpsDatabase(url: string) { const sql = postgres(url, { max: 1 }); try { for (const name of ["0001_notification_deliveries.sql", "0002_automation_runs.sql"]) await sql.unsafe(await Bun.file(new URL(`../migrations/${name}`, import.meta.url)).text()); } finally { await sql.end(); } }
if (import.meta.main) { const url = process.env.TEST_DATABASE_URL ?? process.env.OPS_DATABASE_URL; if (!url) throw new Error("OPS_DATABASE_URL is required"); await migrateOpsDatabase(url); }
