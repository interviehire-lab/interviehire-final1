import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type HiringDatabase = PostgresJsDatabase<typeof schema>;

export function connectHiringDatabase(url: string) {
  const client = postgres(url, { max: 5 });
  return { client, db: drizzle(client, { schema }) };
}
