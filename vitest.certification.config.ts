import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

/**
 * Live Studio Dev certification suites. These are excluded from the default
 * unit-test run because they read (and, for the reporter proof, write) real
 * GenLayer state.
 */
export default defineConfig({
  resolve: { alias: {
    "@faultpact/shared": `${root}/packages/shared/src/index.ts`,
    "@faultpact/contract": `${root}/packages/contract/src/index.ts`,
    "@faultpact/db": `${root}/packages/db/src/index.ts`,
    "@faultpact/monitoring": `${root}/packages/monitoring/src/index.ts`,
  } },
  test: {
    include: ["tests/certification/contract-live.test.ts"],
    testTimeout: 120_000,
    fileParallelism: false,
  },
});
