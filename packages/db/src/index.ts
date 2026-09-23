import { PrismaClient, Prisma } from "@prisma/client";
import { normalizeAddress, jsonSafe, type JsonValue } from "@faultpact/shared";

export type DbClient = PrismaClient;

export function createDb(url = process.env.DATABASE_URL): PrismaClient {
  if (!url) throw new Error("DATABASE_URL is required");
  return new PrismaClient({ datasources: { db: { url } } });
}

export function decimal(value: bigint | number | string | Prisma.Decimal): Prisma.Decimal {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value.toString());
}

export function decimalString(value: Prisma.Decimal | bigint | number | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.toString();
}

function normalizeDbValue(value: unknown): unknown {
  if (value instanceof Prisma.Decimal) return value.toString();
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
  if (Array.isArray(value)) return value.map(normalizeDbValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeDbValue(item)]));
  return value;
}

export function serializeDb(value: unknown): JsonValue {
  return jsonSafe(normalizeDbValue(value));
}

export async function assertDbHealthy(db: PrismaClient): Promise<void> {
  await db.$queryRaw`SELECT 1`;
}

export async function ensureDeployment(db: PrismaClient, input: {
  network: string;
  chainId: number;
  contractAddress: string;
  sourceSha256: string;
  sourceByteLength?: number;
  schemaFingerprint?: string;
  schema?: unknown;
}): Promise<{ id: number }> {
  const address = normalizeAddress(input.contractAddress);
  const existing = await db.deployment.upsert({
    where: { chainId_contractAddress: { chainId: input.chainId, contractAddress: address } },
    create: {
      network: input.network,
      chainId: input.chainId,
      contractAddress: address,
      sourceSha256: input.sourceSha256,
      sourceByteLength: input.sourceByteLength,
      schemaFingerprint: input.schemaFingerprint,
      schema: input.schema as Prisma.InputJsonValue | undefined,
      verifiedAt: new Date(),
    },
    update: {
      network: input.network,
      sourceSha256: input.sourceSha256,
      sourceByteLength: input.sourceByteLength,
      schemaFingerprint: input.schemaFingerprint,
      schema: input.schema as Prisma.InputJsonValue | undefined,
      verifiedAt: new Date(),
    },
    select: { id: true },
  });
  return existing;
}

export const entityTables = ["providers", "services", "pacts", "coverages", "incidents", "evidence", "challenges", "claims"] as const;
export type EntityTable = typeof entityTables[number];

export function isEntityTable(value: string): value is EntityTable {
  return (entityTables as readonly string[]).includes(value);
}

export async function listIndexed(db: PrismaClient, table: EntityTable, input: {
  deploymentId: number;
  skip: number;
  take: number;
  search?: string;
  status?: string;
  serviceId?: string;
  providerId?: string;
  buyer?: string;
  claimant?: string;
  incidentId?: string;
  faultDomain?: string;
}): Promise<{ rows: unknown[]; total: number }> {
  const { deploymentId, skip, take, search, status, serviceId, providerId, buyer, claimant, incidentId, faultDomain } = input;
  switch (table) {
    case "providers": {
      const where: Prisma.ProviderWhereInput = {
        deploymentId,
        ...(status ? { status } : {}),
        ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { address: { contains: search, mode: "insensitive" } }] } : {}),
      };
      const [rows, total] = await Promise.all([db.provider.findMany({ where, skip, take, orderBy: { id: "asc" } }), db.provider.count({ where })]);
      return { rows, total };
    }
    case "services": {
      const where: Prisma.ServiceWhereInput = { deploymentId, ...(status ? { status } : {}), ...(search ? { name: { contains: search, mode: "insensitive" } } : {}), ...(providerId ? { provider: { onchainId: decimal(providerId) } } : {}) };
      const [rows, total] = await Promise.all([db.service.findMany({ where, skip, take, orderBy: { id: "asc" } }), db.service.count({ where })]);
      return { rows, total };
    }
    case "pacts": {
      const where: Prisma.PactWhereInput = { deploymentId, ...(status ? { status } : {}), ...(serviceId ? { service: { onchainId: decimal(serviceId) } } : {}), ...(providerId ? { provider: { onchainId: decimal(providerId) } } : {}) };
      const [rows, total] = await Promise.all([db.pact.findMany({ where, skip, take, orderBy: { id: "asc" } }), db.pact.count({ where })]);
      return { rows, total };
    }
    case "coverages": {
      const where: Prisma.CoverageWhereInput = { deploymentId, ...(status ? { status } : {}), ...(buyer ? { buyerAddress: normalizeAddress(buyer) } : {}) };
      const [rows, total] = await Promise.all([db.coverage.findMany({ where, skip, take, orderBy: { id: "asc" } }), db.coverage.count({ where })]);
      return { rows, total };
    }
    case "incidents": {
      const where: Prisma.IncidentWhereInput = { deploymentId, ...(status ? { status } : {}), ...(serviceId ? { service: { onchainId: decimal(serviceId) } } : {}), ...(faultDomain ? { resolution: { faultDomain } } : {}) };
      const [rows, total] = await Promise.all([db.incident.findMany({ where, skip, take, orderBy: { id: "asc" } }), db.incident.count({ where })]);
      return { rows, total };
    }
    case "claims": {
      const where: Prisma.ClaimWhereInput = { deploymentId, ...(status ? { status } : {}), ...(claimant ? { claimant: normalizeAddress(claimant) } : {}), ...(incidentId ? { incident: { onchainId: decimal(incidentId) } } : {}) };
      const [rows, total] = await Promise.all([db.claim.findMany({ where, skip, take, orderBy: { id: "asc" } }), db.claim.count({ where })]);
      return { rows, total };
    }
    case "evidence": {
      const where: Prisma.EvidenceWhereInput = { deploymentId, ...(status ? { fetchStatus: status } : {}) };
      const [rows, total] = await Promise.all([db.evidence.findMany({ where, skip, take, orderBy: { id: "asc" } }), db.evidence.count({ where })]);
      return { rows, total };
    }
    case "challenges": {
      const where: Prisma.ChallengeWhereInput = { deploymentId, ...(status ? { status } : {}) };
      const [rows, total] = await Promise.all([db.challenge.findMany({ where, skip, take, orderBy: { id: "asc" } }), db.challenge.count({ where })]);
      return { rows, total };
    }
  }
}

export function publicRow(value: unknown): JsonValue {
  return serializeDb(value);
}

export const trackedTransactionStates = ["CREATED", "SUBMITTED", "PROCESSING", "DECIDED", "FINALIZING", "FINALIZED", "FAILED"] as const;
export type TrackedTransactionState = typeof trackedTransactionStates[number];

export async function trackTransaction(db: PrismaClient, input: {
  deploymentId: number;
  txHash: string;
  method: string;
  status: TrackedTransactionState;
  initiator?: string;
  entityKind?: string;
  entityId?: bigint | string | number;
  decisionStatus?: string;
  finalizedAt?: Date;
  error?: string;
  raw?: unknown;
}): Promise<{ id: number }> {
  return await db.transactionRecord.upsert({
    where: { txHash: input.txHash },
    create: { deploymentId: input.deploymentId, txHash: input.txHash, method: input.method, initiator: input.initiator ? normalizeAddress(input.initiator) : undefined, status: input.status, entityKind: input.entityKind, entityId: input.entityId === undefined ? undefined : decimal(input.entityId), decisionStatus: input.decisionStatus, finalizedAt: input.finalizedAt, error: input.error, raw: input.raw === undefined ? undefined : jsonSafe(input.raw) as Prisma.InputJsonValue },
    update: { status: input.status, ...(input.initiator ? { initiator: normalizeAddress(input.initiator) } : {}), ...(input.entityKind ? { entityKind: input.entityKind } : {}), ...(input.entityId === undefined ? {} : { entityId: decimal(input.entityId) }), ...(input.decisionStatus ? { decisionStatus: input.decisionStatus } : {}), ...(input.finalizedAt ? { finalizedAt: input.finalizedAt } : {}), ...(input.error ? { error: input.error } : {}), ...(input.raw === undefined ? {} : { raw: jsonSafe(input.raw) as Prisma.InputJsonValue }) },
    select: { id: true },
  });
}
