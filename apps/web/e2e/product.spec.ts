import { expect, test, type Page } from "@playwright/test";

const stats = { data: { providers: 1, services: 1, pacts: 2, coverages: 1, incidents: 1, claims: 1, evidence: 4 }, indexedAt: "2026-09-22T00:00:00.000Z" };
const pact = { id: 1, onchainId: "1", serviceId: 1, providerId: 1, status: "PUBLISHED", provider: { name: "Indexed Provider" }, service: { name: "Indexed Service", onchainId: "1" }, capacity: { remaining: "10000000000000000000" }, raw: { terms: { region_scope: "us-east" } }, terms: { regionScope: "us-east", p95LatencyMs: "150", claimWindowSeconds: "60", minCoverageAmount: "1000000000000000000", maxCoverageAmount: "10000000000000000000", minCoverageDurationSeconds: "60", maxCoverageDurationSeconds: "600", premiumBpsPerYear: "1000", deductibleBps: "0", maxPayoutBps: "10000", raw: { region_scope: "us-east", enabled_clauses: ["P95_LATENCY"], availability_threshold_ppm: "0", p95_latency_ms: "150", error_rate_threshold_ppm: "0", block_lag_threshold: "0" } }, indexedAt: "2026-09-22T00:00:00.000Z" };

async function mockIndexedApi(page: Page): Promise<void> {
  await page.route("**/api/v1/stats", (route) => route.fulfill({ json: stats }));
  await page.route("**/api/v1/network", (route) => route.fulfill({ json: { data: { network: "GenLayer Studio Development Preview", chainId: 61997, contractAddress: "0xeb858957e3C426597245f6b59E260f1cC556Bf13" } } }));
  await page.route("**/api/v1/providers*", (route) => route.fulfill({ json: { data: [{ id: 1, onchainId: "1", name: "Indexed Provider", address: "0x1111111111111111111111111111111111111111", status: "ACTIVE", totalCapital: "1000000000000000000", serviceCount: 1 }], pagination: { cursor: 0, limit: 25, total: 1, nextCursor: null }, indexedAt: stats.indexedAt } }));
  await page.route("**/api/v1/pacts/1", (route) => route.fulfill({ json: { data: pact } }));
  await page.route("**/api/v1/pacts/1/capacity", (route) => route.fulfill({ json: { data: { totalAllocated: "15", totalReserved: "0", remaining: "15" }, indexedAt: stats.indexedAt } }));
  await page.route("**/api/v1/pacts?*", (route) => route.fulfill({ json: { data: [pact], pagination: { cursor: 0, limit: 25, total: 1, nextCursor: null }, indexedAt: stats.indexedAt } }));
  await page.route("**/api/v1/incidents*", (route) => route.fulfill({ json: { data: [{ id: 1, onchainId: "1", serviceId: 1, status: "FINALIZED", observedStart: "1790003620", openClaims: "0" }], pagination: { cursor: 0, limit: 25, total: 1, nextCursor: null }, indexedAt: stats.indexedAt } }));
  await page.route("**/api/v1/claims*", (route) => route.fulfill({ json: { data: [{ id: 1, onchainId: "7", incidentId: 1, coverageId: 4, status: "SETTLED", payout: "500000000000000000" }], pagination: { cursor: 0, limit: 25, total: 1, nextCursor: null }, indexedAt: stats.indexedAt } }));
  await page.route("**/api/v1/incidents/1/evidence", (route) => route.fulfill({ json: { data: [{ onchainId: "1", evidenceUri: "https://example.com/evidence", contentHash: "a".repeat(64), reporter: "0x1111111111111111111111111111111111111111", authoritative: true, reporterAuthorized: true, fetchStatus: "NOT_CHECKED", hashStatus: "NOT_CHECKED", schemaStatus: "NOT_CHECKED", usable: null, artifactSha256: null }] } }));
  await page.route("**/api/v1/incidents/1/resolution", (route) => route.fulfill({ json: { data: { factStatus: "INCIDENT_CONFIRMED", faultDomain: "PROVIDER", scope: "us-east", p95LatencyMs: "300", availabilityPpm: "0", errorRatePpm: "0", duration: "10", supportIds: {} } } }));
  await page.route("**/api/v1/incidents/1/challenge", (route) => route.fulfill({ json: { data: null } }));
  await page.route("**/api/v1/incidents/1", (route) => route.fulfill({ json: { data: { onchainId: "1", serviceId: "1", status: "FINALIZED", observedStart: "1790003620", observedEnd: "1790003630" } } }));
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

test("INCIDENT_LIST_FORMATS_UNIX_TIMESTAMPS", async ({ page }) => {
  await mockIndexedApi(page);
  await page.goto("/incidents");
  await expect(page.getByRole("cell", { name: /2026/ })).toBeVisible();
  await expect(page.getByText("1790003620", { exact: true })).toHaveCount(0);
});

test("INCIDENT_SHOWS_RELATED_CLAIM_SETTLEMENT", async ({ page }) => {
  await mockIndexedApi(page);
  await page.goto("/incidents/1");
  await expect(page.getByRole("heading", { name: "Pact evaluation and Claims" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Claim #7/ })).toBeVisible();
  await expect(page.getByText("GenLayer resolves the canonical Incident facts.")).toBeVisible();
  await expect(page.getByText("Hash Not checked by app")).toBeVisible();
  await expect(page.getByText(/Submitted SHA-256/)).toBeVisible();
  await expect(page.getByText(/Hash VALID|Fetch FETCHED/)).toHaveCount(0);
});

test("PACT_SMALL_GEN_CAPITAL_FITS_DESKTOP_AND_MOBILE", async ({ page }) => {
  await mockIndexedApi(page);
  await page.goto("/pacts/1");
  await expect(page.getByRole("link", { name: /Review Coverage/ })).toHaveAttribute("href", "/app/purchase?pact=1");
  await expect(page.getByText("0.000000000000000015 GEN").first()).toBeVisible();
  const fitsDesktop = await page.locator(".capacity-grid .metric strong").evaluateAll((values) => values.every((value) => value.scrollWidth <= value.clientWidth));
  expect(fitsDesktop).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  const fitsMobile = await page.locator(".capacity-grid .metric strong").evaluateAll((values) => values.every((value) => value.scrollWidth <= value.clientWidth));
  expect(fitsMobile).toBe(true);
});

test("DOCS_NAVIGATION", async ({ page }) => {
  await page.goto("/docs");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Make the protocol legible");
  await page.locator('.docs-index-grid a[href="/docs/evidence"]').click();
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

test("KEYBOARD_SKIP_LINK_FOCUSES_MAIN", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
});

test("BUY_COVERAGE_REVIEW_AND_DISCONNECTED_WALLET", async ({ page }) => {
  await mockIndexedApi(page);
  await page.goto("/app/purchase?pact=1");
  await expect(page.getByRole("heading", { name: "Pact #1" })).toBeVisible();
  await expect(page.getByText("us-east")).toBeVisible();
  await expect(page.getByLabel("Coverage limit (GEN)")).toHaveValue("1");
  await expect(page.getByText("Estimated premium")).toBeVisible();
  await expect(page.getByText("0.000000190258751903 GEN", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Connect wallet to review" }).click();
  await expect(page.locator(".action-error")).toContainText("No compatible wallet detected");
});

test("INVALID_PACT_SELECTION_DOES_NOT_FALL_BACK", async ({ page }) => {
  await mockIndexedApi(page);
  await page.route("**/api/v1/pacts/999", (route) => route.fulfill({ status: 404, json: { error: "not found" } }));
  await page.goto("/app/purchase?pact=999");
  await expect(page.locator(".error-state")).toContainText("not found");
  await expect(page.getByRole("heading", { name: "Pact #1" })).toHaveCount(0);
});

test("API_FAILURE_STATE", async ({ page }) => {
  await page.route("**/api/v1/providers*", (route) => route.abort("failed"));
  await page.goto("/providers");
  await expect(page.locator(".error-state")).toContainText("Data unavailable");
});

test("REDUCED_MOTION", async ({ page }) => {
  await page.goto("/");
  const motionName = await page.locator(".lifecycle-steps li").first().evaluate((element) => getComputedStyle(element).animationName);
  expect(motionName).toBe("none");
});
