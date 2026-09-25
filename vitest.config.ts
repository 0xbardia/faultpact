import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: { alias: {
    "@faultpact/shared": `${root}/packages/shared/src/index.ts`,
    "@faultpact/contract/legacy": `${root}/packages/contract/src/legacy.ts`,
    "@faultpact/contract/schema": `${root}/packages/contract/src/schema.ts`,
    "@faultpact/contract": `${root}/packages/contract/src/index.ts`,
    "@faultpact/db": `${root}/packages/db/src/index.ts`,
    "@faultpact/monitoring": `${root}/packages/monitoring/src/index.ts`,
  } },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["tests/integration/**", "tests/certification/**", "**/node_modules/**", "**/dist/**"],
    // Generous enough that CPU contention on a small runner cannot turn an
    // unrelated slow assertion into a timeout. No assertion is relaxed.
    testTimeout: 20000,
    coverage: { reporter: ["text"] },
  },
});
