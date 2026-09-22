import { expect, test, type Page } from "@playwright/test";

const stats = { data: { providers: 1, services: 1, pacts: 2, coverages: 1, incidents: 1, claims: 1, evidence: 4 }, indexedAt: "2026-09-22T00:00:00.000Z" };
const pact = { id: 1, onchainId: "1", serviceId: 1, providerId: 1, status: "ACTIVE", raw: { terms: { region_scope: "us-east", p95_latency_ms: "150", claim_window_seconds: "60", max_coverage_amount: "1000000", min_coverage_duration_seconds: "60" } }, terms: { regionScope: "us-east", p95LatencyMs: "150", claimWindowSeconds: "60", maxCoverageAmount: "1000000", minCoverageDurationSeconds: "60" }, indexedAt: "2026-09-22T00:00:00.000Z" };

async function mockIndexedApi(page: Page): Promise<void> {
  await page.route("**/api/v1/stats", (route) => route.fulfill({ json: stats }));
  await page.route("**/api/v1/network", (route) => route.fulfill({ json: { data: { network: "GenLayer Studio Development Preview", chainId: 61997, contractAddress: "0xeb858957e3C426597245f6b59E260f1cC556Bf13" } } }));
  await page.route("**/api/v1/providers*", (route) => route.fulfill({ json: { data: [{ id: 1, onchainId: "1", name: "Indexed Provider", address: "0x1111111111111111111111111111111111111111", status: "ACTIVE", totalCapital: "1000000000000000000", serviceCount: 1 }], pagination: { cursor: 0, limit: 25, total: 1, nextCursor: null }, indexedAt: stats.indexedAt } }));
  await page.route("**/api/v1/pacts/1", (route) => route.fulfill({ json: { data: pact } }));
  await page.route("**/api/v1/pacts?*", (route) => route.fulfill({ json: { data: [pact], pagination: { cursor: 0, limit: 25, total: 1, nextCursor: null }, indexedAt: stats.indexedAt } }));
}

test("LANDING_LOADS", async ({ page }) => {
  await mockIndexedApi(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Reliability with consequences");
  await expect(page.getByText("Live indexed protocol state")).toBeVisible();
});

test("PUBLIC_EXPLORER_LOADS_INDEXED_DATA", async ({ page }) => {
  await mockIndexedApi(page);
  await page.goto("/providers");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Providers");
  await expect(page.getByText("Indexed Provider")).toBeVisible();
});

test("DOCS_NAVIGATION", async ({ page }) => {
  await page.goto("/docs");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Make the protocol legible");
  await page.getByRole("link", { name: "Evidence model" }).first().click();
  await expect(page).toHaveURL(/\/docs\/evidence$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Evidence");
});

test("MOBILE_NAVIGATION", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("button", { name: "Close navigation" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Explore" }).last()).toBeVisible();
});

test("BUY_COVERAGE_REVIEW_AND_DISCONNECTED_WALLET", async ({ page }) => {
  await mockIndexedApi(page);
  await page.goto("/app/purchase?pact=1");
  await expect(page.getByRole("heading", { name: "Pact #1" })).toBeVisible();
  await expect(page.getByText("us-east")).toBeVisible();
  await page.getByRole("button", { name: "Connect wallet to review" }).click();
  await expect(page.locator(".action-error")).toContainText("No compatible wallet detected");
});

test("API_FAILURE_STATE", async ({ page }) => {
  await page.route("**/api/v1/providers*", (route) => route.abort("failed"));
  await page.goto("/providers");
  await expect(page.locator(".error-state")).toContainText("Data unavailable");
});

test("REDUCED_MOTION", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const motion = await page.locator(".orbit-a").evaluate((element) => ({ duration: getComputedStyle(element).animationDuration, iterations: getComputedStyle(element).animationIterationCount }));
  expect(motion.duration).toBe("1e-05s");
  expect(motion.iterations).toBe("1");
});
