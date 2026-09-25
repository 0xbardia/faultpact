import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgresql://root@localhost/faultpact_test?host=%2Fvar%2Frun%2Fpostgresql&schema=public";
const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
if (!/(?:^|_)test$/.test(databaseName)) throw new Error("Integration tests require a dedicated database whose name ends in _test; set TEST_DATABASE_URL.");

const env = { ...process.env, DATABASE_URL: databaseUrl };
for (const [file, args] of [
  ["node_modules/prisma/build/index.js", ["migrate", "deploy"]],
  ["node_modules/vitest/vitest.mjs", ["run", "--config", "vitest.integration.config.ts"]],
]) {
  const result = spawnSync(process.execPath, [resolve(root, file), ...args], { cwd: root, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
