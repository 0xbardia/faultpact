import { buildProbeEvidence, evidenceUrl, type ProbeEvidenceV1 } from "./index.js";

export type ImmutableArtifact = {
  sha256: string;
  bytes: Buffer;
  contentType: "application/json";
  sizeBytes: number;
  schemaVersion: string;
  metadata: Record<string, unknown>;
};

export type ImmutableArtifactRepository = {
  findBySha256(sha256: string): Promise<{ sha256: string; bytes: Uint8Array } | null>;
  create(artifact: ImmutableArtifact): Promise<void>;
};

export async function persistImmutableArtifact(repository: ImmutableArtifactRepository, value: ProbeEvidenceV1, metadata: Record<string, unknown>): Promise<ImmutableArtifact> {
  const built = buildProbeEvidence(value);
  const existing = await repository.findBySha256(built.sha256);
  if (existing) {
    if (Buffer.compare(Buffer.from(existing.bytes), built.bytes) !== 0) throw new Error("immutable evidence hash collision or storage mutation detected");
    return { sha256: built.sha256, bytes: built.bytes, contentType: "application/json", sizeBytes: built.bytes.byteLength, schemaVersion: value.schema, metadata };
  }
  const artifact = { sha256: built.sha256, bytes: built.bytes, contentType: "application/json" as const, sizeBytes: built.bytes.byteLength, schemaVersion: value.schema, metadata };
  await repository.create(artifact);
  return artifact;
}

export function assertArtifactSize(artifact: Pick<ImmutableArtifact, "sizeBytes">, maxBytes: number): void {
  if (!Number.isInteger(maxBytes) || maxBytes < 1) throw new Error("invalid evidence artifact size limit");
  if (artifact.sizeBytes > maxBytes) throw new Error("evidence artifact exceeds configured size limit");
}

export function artifactPublicUrl(baseUrl: string, artifact: Pick<ImmutableArtifact, "sha256">): string {
  return evidenceUrl(baseUrl, artifact.sha256);
}
