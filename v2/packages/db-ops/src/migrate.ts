import postgres from "postgres";
export async function migrateOpsDatabase(url: string) { const sql = postgres(url, { max: 1 }); try { await sql.unsafe(await Bun.file(new URL("../migrations/0001_notification_deliveries.sql", import.meta.url)).text()); } finally { await sql.end(); } }
if (import.meta.main) { const url = process.env.TEST_DATABASE_URL ?? process.env.OPS_DATABASE_URL; if (!url) throw new Error("OPS_DATABASE_URL is required"); await migrateOpsDatabase(url); }
