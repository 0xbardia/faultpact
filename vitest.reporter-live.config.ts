import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: { alias: {
    "@faultpact/shared": `${root}/packages/shared/src/index.ts`,
    "@faultpact/contract": `${root}/packages/contract/src/index.ts`,
    "@faultpact/db": `${root}/packages/db/src/index.ts`,
    "@faultpact/monitoring": `${root}/packages/monitoring/src/index.ts`,
    "@faultpact/worker/reporter": `${root}/apps/worker/src/reporter-runtime.ts`,
    "@faultpact/worker/submit": `${root}/apps/worker/src/reporter-submit.ts`,
    "@faultpact/worker/summary": `${root}/apps/worker/src/reporter-summary.ts`,
  } },
  test: {
    include: ["tests/certification/reporter-live.test.ts"],
    // GenLayer Studio finalization plus contract read-back is not instantaneous.
    testTimeout: 900_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
});
