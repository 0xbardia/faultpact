-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Deployment" (
    "id" SERIAL NOT NULL,
    "network" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "sourceSha256" TEXT NOT NULL,
    "sourceByteLength" INTEGER,
    "schemaFingerprint" TEXT,
    "schema" JSONB,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProtocolSnapshot" (
    "id" SERIAL NOT NULL,
    "deploymentId" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProtocolSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Provider" (
    "id" SERIAL NOT NULL,
    "deploymentId" INTEGER NOT NULL,
    "onchainId" DECIMAL(78,0) NOT NULL,
    "address" TEXT,
    "name" TEXT,
    "status" TEXT,
    "raw" JSONB NOT NULL,
    "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderVault" (
    "id" SERIAL NOT NULL,
    "providerId" INTEGER NOT NULL,
    "totalCapital" DECIMAL(78,0) NOT NULL,
    "allocated" DECIMAL(78,0) NOT NULL,
    "reserved" DECIMAL(78,0) NOT NULL,
    "pending" DECIMAL(78,0) NOT NULL,
    "raw" JSONB NOT NULL,
    "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderVault_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderStats" (
    "id" SERIAL NOT NULL,
    "providerId" INTEGER NOT NULL,
    "totalPacts" DECIMAL(78,0) NOT NULL,
    "totalCoverages" DECIMAL(78,0) NOT NULL,
    "finalizedIncidents" DECIMAL(78,0) NOT NULL,
    "providerFaultIncidents" DECIMAL(78,0) NOT NULL,
    "raw" JSONB NOT NULL,
    "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Service" (
    "id" SERIAL NOT NULL,
    "deploymentId" INTEGER NOT NULL,
    "providerId" INTEGER,
    "onchainId" DECIMAL(78,0) NOT NULL,
    "serviceType" TEXT,
    "name" TEXT,
    "status" TEXT,
    "metadataUri" TEXT,
    "metadataHash" TEXT,
    "raw" JSONB NOT NULL,
    "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pact" (
    "id" SERIAL NOT NULL,
    "deploymentId" INTEGER NOT NULL,
    "serviceId" INTEGER NOT NULL,
    "providerId" INTEGER,
    "onchainId" DECIMAL(78,0) NOT NULL,
    "revision" DECIMAL(78,0),
    "status" TEXT,
    "regionScope" TEXT,
    "raw" JSONB NOT NULL,
    "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PactTerms" (
    "id" SERIAL NOT NULL,
    "pactId" INTEGER NOT NULL,
    "availabilityThresholdPpm" DECIMAL(78,0),
    "p95LatencyMs" DECIMAL(78,0),
    "errorRateThresholdPpm" DECIMAL(78,0),
    "blockLagThreshold" DECIMAL(78,0),
    "minIncidentDurationSeconds" DECIMAL(78,0),
    "claimWindowSeconds" DECIMAL(78,0),
    "minCoverageDurationSeconds" DECIMAL(78,0),
    "maxCoverageDurationSeconds" DECIMAL(78,0),
    "minCoverageAmount" DECIMAL(78,0),
    "maxCoverageAmount" DECIMAL(78,0),
    "premiumBpsPerYear" DECIMAL(78,0),
    "deductibleBps" DECIMAL(78,0),
    "maxPayoutBps" DECIMAL(78,0),
    "termsUri" TEXT,
    "termsHash" TEXT,
    "raw" JSONB NOT NULL,
    "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PactTerms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PactCapacity" (
    "id" SERIAL NOT NULL,
    "pactId" INTEGER NOT NULL,
    "totalAllocated" DECIMAL(78,0) NOT NULL,
    "totalReserved" DECIMAL(78,0) NOT NULL,
    "remaining" DECIMAL(78,0) NOT NULL,
    "raw" JSONB NOT NULL,
    "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PactCapacity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coverage" (
    "id" SERIAL NOT NULL,
    "deploymentId" INTEGER NOT NULL,
    "pactId" INTEGER NOT NULL,
    "onchainId" DECIMAL(78,0) NOT NULL,
    "buyerAddress" TEXT,
    "status" TEXT,
    "coverageLimit" DECIMAL(78,0) NOT NULL,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "raw" JSONB NOT NULL,
    "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Coverage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" SERIAL NOT NULL,
    "deploymentId" INTEGER NOT NULL,
    "serviceId" INTEGER NOT NULL,
    "onchainId" DECIMAL(78,0) NOT NULL,
    "status" TEXT,
    "observedStart" DECIMAL(78,0) NOT NULL,
    "observedEnd" DECIMAL(78,0) NOT NULL,
    "reportBond" DECIMAL(78,0),
    "challengeBond" DECIMAL(78,0),
    "openClaims" DECIMAL(78,0),
    "raw" JSONB NOT NULL,
    "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentResolution" (
    "id" SERIAL NOT NULL,
    "incidentId" INTEGER NOT NULL,
    "status" TEXT,
    "factStatus" TEXT,
    "faultDomain" TEXT,
    "scope" TEXT,
    "incidentStart" DECIMAL(78,0),
    "incidentEnd" DECIMAL(78,0),
    "duration" DECIMAL(78,0),
    "p95LatencyMs" DECIMAL(78,0),
    "availabilityPpm" DECIMAL(78,0),
    "errorRatePpm" DECIMAL(78,0),
    "blockLag" DECIMAL(78,0),
    "supportIds" JSONB,
    "raw" JSONB NOT NULL,
    "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentResolution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" SERIAL NOT NULL,
    "deploymentId" INTEGER NOT NULL,
    "incidentId" INTEGER NOT NULL,
    "challengeId" INTEGER,
    "onchainId" DECIMAL(78,0) NOT NULL,
    "evidenceType" TEXT,
    "evidenceUri" TEXT,
    "contentHash" TEXT,
    "description" TEXT,
    "reporter" TEXT,
    "authoritative" BOOLEAN NOT NULL DEFAULT false,
    "reporterAuthorized" BOOLEAN NOT NULL DEFAULT false,
    "fetchStatus" TEXT,
    "hashStatus" TEXT,
    "schemaStatus" TEXT,
    "usable" BOOLEAN NOT NULL DEFAULT false,
    "artifactSha256" TEXT,
    "raw" JSONB NOT NULL,
    "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Challenge" (
    "id" SERIAL NOT NULL,
    "deploymentId" INTEGER NOT NULL,
    "incidentId" INTEGER NOT NULL,
    "challenger" TEXT,
    "status" TEXT,
    "challengeBond" DECIMAL(78,0),
    "raw" JSONB NOT NULL,
    "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Challenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" SERIAL NOT NULL,
    "deploymentId" INTEGER NOT NULL,
    "coverageId" INTEGER NOT NULL,
    "incidentId" INTEGER NOT NULL,
    "onchainId" DECIMAL(78,0) NOT NULL,
    "claimant" TEXT,
    "status" TEXT,
    "payout" DECIMAL(78,0),
    "raw" JSONB NOT NULL,
    "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReporterSnapshot" (
    "id" SERIAL NOT NULL,
    "deploymentId" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "authorized" BOOLEAN NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReporterSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncCursor" (
    "id" SERIAL NOT NULL,
    "deploymentId" INTEGER NOT NULL,
    "entityKind" TEXT NOT NULL,
    "nextId" DECIMAL(78,0) NOT NULL,
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UNKNOWN',

    CONSTRAINT "SyncCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractSnapshot" (
    "id" SERIAL NOT NULL,
    "deploymentId" INTEGER NOT NULL,
    "chainId" INTEGER NOT NULL,
    "blockReference" TEXT,
    "config" JSONB,
    "counters" JSONB,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionRecord" (
    "id" SERIAL NOT NULL,
    "deploymentId" INTEGER NOT NULL,
    "txHash" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "initiator" TEXT,
    "entityKind" TEXT,
    "entityId" DECIMAL(78,0),
    "status" TEXT NOT NULL,
    "decisionStatus" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizedAt" TIMESTAMP(3),
    "error" TEXT,
    "raw" JSONB,

    CONSTRAINT "TransactionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitorTarget" (
    "id" SERIAL NOT NULL,
    "serviceId" INTEGER,
    "name" TEXT NOT NULL,
    "endpointUrl" TEXT NOT NULL,
    "expectedChainId" INTEGER NOT NULL,
    "region" TEXT NOT NULL,
    "profile" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "intervalMs" INTEGER NOT NULL,
    "timeoutMs" INTEGER NOT NULL,
    "evidenceMode" TEXT NOT NULL DEFAULT 'observe',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonitorTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProbeSample" (
    "id" BIGSERIAL NOT NULL,
    "targetId" INTEGER NOT NULL,
    "probeId" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "latencyMs" INTEGER,
    "httpStatus" INTEGER,
    "expectedChainId" INTEGER,
    "observedChainId" INTEGER,
    "targetBlock" DECIMAL(78,0),
    "referenceBlock" DECIMAL(78,0),
    "blockLag" DECIMAL(78,0),
    "blockLagKnown" BOOLEAN NOT NULL DEFAULT false,
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "raw" JSONB,

    CONSTRAINT "ProbeSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricAggregate" (
    "id" BIGSERIAL NOT NULL,
    "targetId" INTEGER NOT NULL,
    "windowSeconds" INTEGER NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "sampleCount" INTEGER NOT NULL,
    "successCount" INTEGER NOT NULL,
    "failureCount" INTEGER NOT NULL,
    "availabilityPpm" DECIMAL(65,30) NOT NULL,
    "errorRatePpm" DECIMAL(65,30) NOT NULL,
    "p50LatencyMs" INTEGER,
    "p95LatencyMs" INTEGER,
    "maxLatencyMs" INTEGER,
    "latestBlock" DECIMAL(78,0),
    "referenceBlock" DECIMAL(78,0),
    "blockLagKnown" BOOLEAN NOT NULL DEFAULT false,
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "inputs" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricAggregate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentCandidate" (
    "id" BIGSERIAL NOT NULL,
    "targetId" INTEGER NOT NULL,
    "serviceId" INTEGER,
    "state" TEXT NOT NULL,
    "reason" TEXT,
    "firstObservedAt" TIMESTAMP(3),
    "lastObservedAt" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "signal" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidentCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceArtifact" (
    "id" BIGSERIAL NOT NULL,
    "sha256" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "serviceId" DECIMAL(78,0),
    "region" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3),
    "windowEnd" TIMESTAMP(3),
    "bytes" BYTEA NOT NULL,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceSubmissionAttempt" (
    "id" BIGSERIAL NOT NULL,
    "targetId" INTEGER,
    "artifactId" BIGINT NOT NULL,
    "incidentId" DECIMAL(78,0),
    "reporter" TEXT,
    "txHash" TEXT,
    "status" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvidenceSubmissionAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "id" SERIAL NOT NULL,
    "workerId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "lastProbeAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastEvidenceAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "details" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationRecord" (
    "id" BIGSERIAL NOT NULL,
    "entityKind" TEXT NOT NULL,
    "entityId" DECIMAL(78,0) NOT NULL,
    "dbStatus" TEXT,
    "chainStatus" TEXT,
    "action" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Deployment_chainId_idx" ON "Deployment"("chainId");

-- CreateIndex
CREATE UNIQUE INDEX "Deployment_chainId_contractAddress_key" ON "Deployment"("chainId", "contractAddress");

-- CreateIndex
CREATE UNIQUE INDEX "ProtocolSnapshot_deploymentId_key" ON "ProtocolSnapshot"("deploymentId");

-- CreateIndex
CREATE INDEX "Provider_deploymentId_address_idx" ON "Provider"("deploymentId", "address");

-- CreateIndex
CREATE UNIQUE INDEX "Provider_deploymentId_onchainId_key" ON "Provider"("deploymentId", "onchainId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderVault_providerId_key" ON "ProviderVault"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderStats_providerId_key" ON "ProviderStats"("providerId");

-- CreateIndex
CREATE INDEX "Service_deploymentId_status_idx" ON "Service"("deploymentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Service_deploymentId_onchainId_key" ON "Service"("deploymentId", "onchainId");

-- CreateIndex
CREATE INDEX "Pact_serviceId_status_idx" ON "Pact"("serviceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Pact_deploymentId_onchainId_key" ON "Pact"("deploymentId", "onchainId");

-- CreateIndex
CREATE UNIQUE INDEX "PactTerms_pactId_key" ON "PactTerms"("pactId");

-- CreateIndex
CREATE UNIQUE INDEX "PactCapacity_pactId_key" ON "PactCapacity"("pactId");

-- CreateIndex
CREATE INDEX "Coverage_buyerAddress_status_idx" ON "Coverage"("buyerAddress", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Coverage_deploymentId_onchainId_key" ON "Coverage"("deploymentId", "onchainId");

-- CreateIndex
CREATE INDEX "Incident_serviceId_status_idx" ON "Incident"("serviceId", "status");

-- CreateIndex
CREATE INDEX "Incident_observedStart_observedEnd_idx" ON "Incident"("observedStart", "observedEnd");

-- CreateIndex
CREATE UNIQUE INDEX "Incident_deploymentId_onchainId_key" ON "Incident"("deploymentId", "onchainId");

-- CreateIndex
CREATE UNIQUE INDEX "IncidentResolution_incidentId_key" ON "IncidentResolution"("incidentId");

-- CreateIndex
CREATE INDEX "Evidence_incidentId_authoritative_usable_idx" ON "Evidence"("incidentId", "authoritative", "usable");

-- CreateIndex
CREATE INDEX "Evidence_contentHash_idx" ON "Evidence"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "Evidence_deploymentId_onchainId_key" ON "Evidence"("deploymentId", "onchainId");

-- CreateIndex
CREATE UNIQUE INDEX "Challenge_incidentId_key" ON "Challenge"("incidentId");

-- CreateIndex
CREATE INDEX "Claim_claimant_status_idx" ON "Claim"("claimant", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_deploymentId_onchainId_key" ON "Claim"("deploymentId", "onchainId");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_coverageId_incidentId_key" ON "Claim"("coverageId", "incidentId");

-- CreateIndex
CREATE UNIQUE INDEX "ReporterSnapshot_deploymentId_address_key" ON "ReporterSnapshot"("deploymentId", "address");

-- CreateIndex
CREATE UNIQUE INDEX "SyncCursor_deploymentId_entityKind_key" ON "SyncCursor"("deploymentId", "entityKind");

-- CreateIndex
CREATE INDEX "ContractSnapshot_deploymentId_capturedAt_idx" ON "ContractSnapshot"("deploymentId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionRecord_txHash_key" ON "TransactionRecord"("txHash");

-- CreateIndex
CREATE INDEX "TransactionRecord_deploymentId_status_idx" ON "TransactionRecord"("deploymentId", "status");

-- CreateIndex
CREATE INDEX "MonitorTarget_enabled_region_idx" ON "MonitorTarget"("enabled", "region");

-- CreateIndex
CREATE UNIQUE INDEX "ProbeSample_probeId_key" ON "ProbeSample"("probeId");

-- CreateIndex
CREATE INDEX "ProbeSample_targetId_observedAt_idx" ON "ProbeSample"("targetId", "observedAt");

-- CreateIndex
CREATE INDEX "MetricAggregate_targetId_windowEnd_idx" ON "MetricAggregate"("targetId", "windowEnd");

-- CreateIndex
CREATE UNIQUE INDEX "MetricAggregate_targetId_windowSeconds_windowStart_key" ON "MetricAggregate"("targetId", "windowSeconds", "windowStart");

-- CreateIndex
CREATE INDEX "IncidentCandidate_targetId_state_idx" ON "IncidentCandidate"("targetId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceArtifact_sha256_key" ON "EvidenceArtifact"("sha256");

-- CreateIndex
CREATE INDEX "EvidenceArtifact_serviceId_region_idx" ON "EvidenceArtifact"("serviceId", "region");

-- CreateIndex
CREATE INDEX "EvidenceSubmissionAttempt_incidentId_status_idx" ON "EvidenceSubmissionAttempt"("incidentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceSubmissionAttempt_artifactId_attemptNo_key" ON "EvidenceSubmissionAttempt"("artifactId", "attemptNo");

-- CreateIndex
CREATE UNIQUE INDEX "WorkerHeartbeat_workerId_key" ON "WorkerHeartbeat"("workerId");

-- CreateIndex
CREATE INDEX "ReconciliationRecord_entityKind_entityId_createdAt_idx" ON "ReconciliationRecord"("entityKind", "entityId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProtocolSnapshot" ADD CONSTRAINT "ProtocolSnapshot_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Provider" ADD CONSTRAINT "Provider_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderVault" ADD CONSTRAINT "ProviderVault_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderStats" ADD CONSTRAINT "ProviderStats_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pact" ADD CONSTRAINT "Pact_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pact" ADD CONSTRAINT "Pact_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pact" ADD CONSTRAINT "Pact_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PactTerms" ADD CONSTRAINT "PactTerms_pactId_fkey" FOREIGN KEY ("pactId") REFERENCES "Pact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PactCapacity" ADD CONSTRAINT "PactCapacity_pactId_fkey" FOREIGN KEY ("pactId") REFERENCES "Pact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coverage" ADD CONSTRAINT "Coverage_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coverage" ADD CONSTRAINT "Coverage_pactId_fkey" FOREIGN KEY ("pactId") REFERENCES "Pact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentResolution" ADD CONSTRAINT "IncidentResolution_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_coverageId_fkey" FOREIGN KEY ("coverageId") REFERENCES "Coverage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReporterSnapshot" ADD CONSTRAINT "ReporterSnapshot_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncCursor" ADD CONSTRAINT "SyncCursor_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractSnapshot" ADD CONSTRAINT "ContractSnapshot_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionRecord" ADD CONSTRAINT "TransactionRecord_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitorTarget" ADD CONSTRAINT "MonitorTarget_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProbeSample" ADD CONSTRAINT "ProbeSample_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "MonitorTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricAggregate" ADD CONSTRAINT "MetricAggregate_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "MonitorTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentCandidate" ADD CONSTRAINT "IncidentCandidate_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "MonitorTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceSubmissionAttempt" ADD CONSTRAINT "EvidenceSubmissionAttempt_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "MonitorTarget"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceSubmissionAttempt" ADD CONSTRAINT "EvidenceSubmissionAttempt_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "EvidenceArtifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

