const databaseUrl = process.env.DATABASE_URL ?? "postgres://interviehire:interviehire_test@127.0.0.1:55432/interviehire_v2_test";
const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:56379";
const env = { ...process.env, DATABASE_URL: databaseUrl, REDIS_URL: redisUrl, INTERNAL_SERVICE_SECRET: process.env.INTERNAL_SERVICE_SECRET ?? "dev-internal-secret" };

const infrastructure = Bun.spawnSync(["bun", "run", "infra:up"], { env, stdout: "inherit", stderr: "inherit" });
if (infrastructure.exitCode !== 0) process.exit(infrastructure.exitCode);
const seed = Bun.spawnSync(["bun", "run", "seed:demo"], { env, stdout: "inherit", stderr: "inherit" });
if (seed.exitCode !== 0) process.exit(seed.exitCode);
const test = Bun.spawnSync(["bunx", "playwright", "test"], { env, stdout: "inherit", stderr: "inherit" });
process.exit(test.exitCode);
