import { connectHiringDatabase } from "./database";

export async function migrateHiringDatabase(url: string): Promise<void> {
  const { client } = connectHiringDatabase(url);
  const migration = await Bun.file(new URL("../migrations/0001_hiring_foundation.sql", import.meta.url)).text();
  try { await client.unsafe(migration); }
  finally { await client.end(); }
}

if (import.meta.main) {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required");
  await migrateHiringDatabase(url);
}
