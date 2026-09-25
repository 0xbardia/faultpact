-- Signer-backed reporter evidence attempts.
--
-- Extends the existing EvidenceSubmissionAttempt model with everything needed to
-- reconcile a reporter write across restarts: which contract method was called,
-- the exact artifact URL and SHA-256 that were submitted, the reporter public
-- address, the transaction hash and lifecycle state, the resulting onchain
-- evidence id, the finalized timestamp and a failure category.
--
-- The reporter private key is never stored here.

ALTER TABLE "EvidenceSubmissionAttempt" ADD COLUMN "method" TEXT;
ALTER TABLE "EvidenceSubmissionAttempt" ADD COLUMN "artifactUrl" TEXT;
ALTER TABLE "EvidenceSubmissionAttempt" ADD COLUMN "artifactSha256" TEXT;
ALTER TABLE "EvidenceSubmissionAttempt" ADD COLUMN "evidenceId" DECIMAL(78,0);
ALTER TABLE "EvidenceSubmissionAttempt" ADD COLUMN "txState" TEXT;
ALTER TABLE "EvidenceSubmissionAttempt" ADD COLUMN "finalizedAt" TIMESTAMP(3);
ALTER TABLE "EvidenceSubmissionAttempt" ADD COLUMN "failureCategory" TEXT;

CREATE INDEX "EvidenceSubmissionAttempt_incidentId_artifactSha256_idx" ON "EvidenceSubmissionAttempt"("incidentId", "artifactSha256");
CREATE INDEX "EvidenceSubmissionAttempt_txHash_idx" ON "EvidenceSubmissionAttempt"("txHash");

-- At most one unresolved attempt per artifact and contract method. A retried
-- worker therefore cannot silently duplicate evidence for the same artifact.
CREATE UNIQUE INDEX "EvidenceSubmissionAttempt_unresolved_method_key"
ON "EvidenceSubmissionAttempt"("artifactId", "method")
WHERE "status" IN ('SUBMITTED', 'PENDING', 'FINALIZING', 'RECONCILING');
