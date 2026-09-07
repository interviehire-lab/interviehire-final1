const databaseUrl = process.env.DATABASE_URL ?? "postgres://interviehire:interviehire_test@127.0.0.1:55432/interviehire_v2_test";
const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:56379";
const env = { ...process.env, DATABASE_URL: databaseUrl, REDIS_URL: redisUrl, INTERNAL_SERVICE_SECRET: process.env.INTERNAL_SERVICE_SECRET ?? "dev-internal-secret" };
for (const command of [["bun", "run", "infra:up"], ["bun", "run", "seed:demo"]] as const) {
  const result = Bun.spawnSync(command, { env, stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) process.exit(result.exitCode);
}
const server = Bun.spawn(["bun", "run", "demo:serve"], { env, stdout: "inherit", stderr: "inherit" });
process.on("SIGINT", () => server.kill("SIGTERM"));
process.on("SIGTERM", () => server.kill("SIGTERM"));
process.exit(await server.exited);
