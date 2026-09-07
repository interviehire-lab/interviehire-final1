const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
if (!databaseUrl || !redisUrl) throw new Error("DATABASE_URL and REDIS_URL are required");

const common = { ...process.env, DATABASE_URL: databaseUrl, REDIS_URL: redisUrl, INTERNAL_SERVICE_SECRET: process.env.INTERNAL_SERVICE_SECRET ?? "dev-internal-secret" };
const commands = [
  ["bun", "run", "apps/interview-api/src/server.ts"],
  ["bun", "run", "apps/core-api/src/server.ts"],
  ["bun", "run", "worker"],
  ["bun", "run", "dev:web"],
] as const;
const children = commands.map((cmd) => Bun.spawn(cmd, { env: common, stdout: "inherit", stderr: "inherit" }));
let stopping = false;
async function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  await Promise.all(children.map((child) => child.exited));
  process.exit(exitCode);
}
for (const child of children) {
  void child.exited.then((code) => { if (!stopping && code !== 0) void stop(code); });
}
process.on("SIGINT", () => { void stop(); });
process.on("SIGTERM", () => { void stop(); });
await new Promise(() => undefined);
