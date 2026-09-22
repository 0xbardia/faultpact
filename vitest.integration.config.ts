import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: { alias: {
    "@faultpact/shared": `${root}/packages/shared/src/index.ts`,
    "@faultpact/contract": `${root}/packages/contract/src/index.ts`,
    "@faultpact/db": `${root}/packages/db/src/index.ts`,
    "@faultpact/monitoring": `${root}/packages/monitoring/src/index.ts`,
  } },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 30000,
  },
});
