import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js"; import postgres from "postgres"; import * as schema from "./schema";
export type OpsDatabase = PostgresJsDatabase<typeof schema>;
export function connectOpsDatabase(url: string) { const client = postgres(url, { max: 5 }); return { client, db: drizzle(client, { schema }) }; }
