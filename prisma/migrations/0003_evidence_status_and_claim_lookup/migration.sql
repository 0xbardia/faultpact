ALTER TABLE "Evidence" ALTER COLUMN "usable" DROP NOT NULL;
ALTER TABLE "Evidence" ALTER COLUMN "usable" DROP DEFAULT;

UPDATE "Evidence"
SET "fetchStatus" = 'NOT_CHECKED',
    "hashStatus" = 'NOT_CHECKED',
    "schemaStatus" = 'NOT_CHECKED',
    "usable" = NULL,
    "artifactSha256" = NULL;

CREATE INDEX "Claim_incidentId_idx" ON "Claim"("incidentId");
