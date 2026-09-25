import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { canonicalJson, normalizeAddress, jsonSafe, asBigInt, FROZEN_CHAIN_ID, FROZEN_RPC_URL, FROZEN_CONTRACT_ADDRESS, FROZEN_SOURCE_SHA256, type JsonValue } from "@faultpact/shared";
import schemaSnapshot from "./generated/studio-dev-schema.json" with { type: "json" };
import { CalldataAddress, calldataAddress, StudioRpcTransport, type RpcMetrics, type RpcRequestOptions, type RpcTransport, type RpcTransportOptions } from "./rpc.js";

export type { RpcMetrics, RpcRequestOptions, RpcTransportOptions } from "./rpc.js";
export { StudioRpcTransport, CalldataAddress, calldataAddress, buildLegacyCalldata, buildLegacyReadData, decodeLegacyReturn } from "./rpc.js";
export type { RpcTransport } from "./rpc.js";
export * from "./bridge.js";
export * from "./transactions.js";
export * from "./reporter.js";

export { FROZEN_CHAIN_ID, FROZEN_RPC_URL, FROZEN_CONTRACT_ADDRESS, FROZEN_SOURCE_SHA256 } from "@faultpact/shared";

export type SchemaMethod = {
  params: Array<[string, string]>;
  kwparams: Record<string, string>;
  readonly: boolean;
  ret: string;
  payable?: boolean;
};

export type ContractSchema = {
  ctor: { params: Array<[string, string]>; kwparams: Record<string, string> };
  methods: Record<string, SchemaMethod>;
};

export type DeploymentManifest = {
  network: string;
  chainId: number;
  rpc: string;
  contractAddress: string;
  sourceSha256: string;
  sourceByteLength?: number;
  dependencyPin?: string;
  deploymentTransaction?: string;
  schemaFingerprint?: string;
  verifiedAt?: string;
  schemaSnapshot?: string;
};

export type ContractVerification = {
  chainId: number;
  sourceSha256: string;
  sourceByteLength: number;
  sourceMatches: boolean;
  schemaFingerprint: string;
  schemaMatchesSnapshot: boolean;
  schemaChecked: boolean;
  address: string;
};

export type DeploymentVerificationOptions = {
  /**
   * Schema discovery is an explicit certification/operations check. Runtime
   * processes use the frozen local schema snapshot so a rate-limited RPC cannot
   * create a startup request storm.
   */
  checkSchema?: boolean;
};

const localSchema = schemaSnapshot as unknown as ContractSchema;

export function getFrozenSchema(): ContractSchema {
  return localSchema;
}

export function schemaFingerprint(schema: ContractSchema): string {
  return createHash("sha256").update(canonicalJson(schema)).digest("hex");
}

export function countSchemaMethods(schema: ContractSchema): { methods: number; views: number; writes: number; payables: number } {
  const methods = Object.values(schema.methods);
  return {
    methods: methods.length,
    views: methods.filter((method) => method.readonly).length,
    writes: methods.filter((method) => !method.readonly).length,
    payables: methods.filter((method) => method.payable === true).length,
  };
}

export function methodNames(schema: ContractSchema, kind: "view" | "write"): string[] {
  return Object.entries(schema.methods)
    .filter(([, method]) => (kind === "view" ? method.readonly : !method.readonly))
    .map(([name]) => name)
    .sort();
}

export function assertFrozenManifest(manifest: DeploymentManifest): void {
  if (manifest.chainId !== FROZEN_CHAIN_ID) throw new Error(`Unsupported chain ${manifest.chainId}`);
  if (manifest.rpc !== FROZEN_RPC_URL) throw new Error(`Unsupported GenLayer RPC ${manifest.rpc}`);
  if (normalizeAddress(manifest.contractAddress) !== normalizeAddress(FROZEN_CONTRACT_ADDRESS)) {
    throw new Error("Deployment address is not the frozen FaultPact address");
  }
  if (manifest.sourceSha256 !== FROZEN_SOURCE_SHA256) throw new Error("Deployment source fingerprint is not frozen");
}

export async function loadGenLayerRuntime(options: RpcTransportOptions = {}): Promise<{
  client: RpcTransport;
  account?: { address: string };
}> {
  return { client: new StudioRpcTransport(FROZEN_RPC_URL, options) };
}

/**
 * Address-typed contract parameters are 20-byte values, not strings. The
 * adapter maps them from the frozen schema so a caller can pass a plain
 * `0x…` address and still produce the encoding GenLayer expects.
 */
export function encodeSchemaArgs(definition: SchemaMethod, args: readonly unknown[]): unknown[] {
  return args.map((value, index) => {
    const type = definition.params[index]?.[1];
    if (type === "address") {
      if (value instanceof CalldataAddress) return value;
      if (typeof value === "string") return calldataAddress(value);
      throw new Error(`${definition.params[index]?.[0] ?? "argument"} must be a 20-byte address`);
    }
    return value;
  });
}

export class FaultPactContractAdapter {
  readonly address: string;
  readonly chainId = FROZEN_CHAIN_ID;
  readonly schema: ContractSchema;
  private cachedRpcChain?: { value: number; checkedAt: number };

  constructor(
    private readonly client: RpcTransport,
    manifest: DeploymentManifest = {
      network: "GenLayer Studio Development Preview",
      chainId: FROZEN_CHAIN_ID,
      rpc: FROZEN_RPC_URL,
      contractAddress: FROZEN_CONTRACT_ADDRESS,
      sourceSha256: FROZEN_SOURCE_SHA256,
    },
  ) {
    assertFrozenManifest(manifest);
    // Preserve the deployment's checksum spelling for GenLayer Studio. The
    // Studio RPC currently treats the contract lookup string case-sensitively;
    // comparisons remain case-insensitive in assertFrozenManifest.
    this.address = manifest.contractAddress;
    this.schema = localSchema;
  }

  get methodCount() {
    return countSchemaMethods(this.schema);
  }

  /** The shared Studio transport. Signer-backed writes reuse it so rate limits, budget and cooldown apply. */
  get transport(): RpcTransport {
    return this.client;
  }

  get viewMethods() {
    return methodNames(this.schema, "view");
  }

  get writeMethods() {
    return methodNames(this.schema, "write");
  }

  get payableMethods() {
    return Object.entries(this.schema.methods).filter(([, method]) => method.payable === true).map(([name]) => name).sort();
  }

  async rpcRequest(method: string, params: readonly unknown[] = [], options: RpcRequestOptions = {}): Promise<unknown> {
    const allowedMethods = new Set(["eth_chainId", "eth_blockNumber", "eth_getBlockByNumber"]);
    if (!allowedMethods.has(method)) throw new Error(`Raw RPC method is not allowlisted: ${method}`);
    return await this.client.request(method, params, options);
  }

  rpcCooldownUntil(): number {
    const client = this.client as RpcTransport & { cooldownUntil?: () => number };
    return client.cooldownUntil?.() ?? 0;
  }

  async refreshRpcCooldown(): Promise<number> {
    const client = this.client as RpcTransport & { refreshSchedulerState?: () => Promise<RpcMetrics> };
    await client.refreshSchedulerState?.();
    return this.rpcCooldownUntil();
  }

  rpcMetrics(): RpcMetrics | undefined {
    const client = this.client as RpcTransport & { metricsSnapshot?: () => RpcMetrics };
    return client.metricsSnapshot?.();
  }

  async rpcSchedulerSnapshot(): Promise<RpcMetrics | undefined> {
    const client = this.client as RpcTransport & { refreshSchedulerState?: () => Promise<RpcMetrics>; metricsSnapshot?: () => RpcMetrics };
    return await client.refreshSchedulerState?.() ?? client.metricsSnapshot?.();
  }

  async chainIdFromRpc(options: { maxAgeMs?: number; request?: RpcRequestOptions } = {}): Promise<number> {
    const maxAgeMs = options.maxAgeMs ?? 0;
    if (maxAgeMs > 0 && this.cachedRpcChain && Date.now() - this.cachedRpcChain.checkedAt < maxAgeMs) return this.cachedRpcChain.value;
    const value = await this.client.request("eth_chainId", [], { subsystem: "api_health", ...options.request });
    const chainId = typeof value === "string" ? Number.parseInt(value, 16) : Number(value);
    if (!Number.isInteger(chainId)) throw new Error("RPC returned invalid chain ID");
    this.cachedRpcChain = { value: chainId, checkedAt: Date.now() };
    return chainId;
  }

  async read<T = unknown>(method: string, args: readonly unknown[] = [], request: RpcRequestOptions = {}): Promise<T> {
    const definition = this.schema.methods[method];
    if (!definition) throw new Error(`Unknown contract method ${method}`);
    if (!definition.readonly) throw new Error(`Refusing write method through read adapter: ${method}`);
    if (definition.params.length !== args.length) throw new Error(`${method} expects ${definition.params.length} arguments`);
    return await this.client.readContract(this.address, method, encodeSchemaArgs(definition, args), undefined, request) as T;
  }

  async write(method: string, args: readonly unknown[] = [], value?: bigint): Promise<unknown> {
    const definition = this.schema.methods[method];
    if (!definition) throw new Error(`Unknown contract method ${method}`);
    if (definition.readonly) throw new Error(`Refusing view method through write adapter: ${method}`);
    if (definition.params.length !== args.length) throw new Error(`${method} expects ${definition.params.length} arguments`);
    void value;
    throw new Error(`Reporter write transport is signer-gated: use createReporterWriter() from @faultpact/contract to sign ${method}, not the read adapter`);
  }

  async getCounters(request: RpcRequestOptions = {}): Promise<Record<string, unknown>> { return await this.read("get_counters", [], request); }
  async getProtocolConfig(request: RpcRequestOptions = {}): Promise<Record<string, unknown>> { return await this.read("get_protocol_config", [], request); }
  async isAuthorizedReporter(address: string, request: RpcRequestOptions = {}): Promise<boolean> { return await this.read<boolean>("is_authorized_reporter", [normalizeAddress(address)], request); }
  async getIncidentEvidenceIds(incidentId: bigint, request: RpcRequestOptions = {}): Promise<bigint[]> {
    const value = await this.read<unknown>("get_incident_evidence_ids", [incidentId], request);
    if (!Array.isArray(value)) throw new Error("get_incident_evidence_ids did not return a list");
    return value.map((item) => asBigInt(item, "evidence id"));
  }
  async getEvidence(evidenceId: bigint, request: RpcRequestOptions = {}): Promise<Record<string, unknown>> {
    const value = await this.read<unknown>("get_evidence", [evidenceId], request);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("get_evidence did not return a record");
    return value as Record<string, unknown>;
  }
  async getIncident(incidentId: bigint, request: RpcRequestOptions = {}): Promise<Record<string, unknown>> {
    const value = await this.read<unknown>("get_incident", [incidentId], request);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("get_incident did not return a record");
    return value as Record<string, unknown>;
  }
  /** Fails closed unless the live chain, deployed source and address are the frozen FaultPact deployment. */
  async verifyFrozenTarget(options: DeploymentVerificationOptions = {}): Promise<ContractVerification> {
    return await this.verifyDeployment(undefined, options);
  }
  async getEntity(kind: "provider" | "service" | "pact" | "coverage" | "incident" | "evidence" | "challenge" | "claim", id: bigint, request: RpcRequestOptions = {}): Promise<unknown> {
    const method = kind === "challenge" ? "get_challenge" : kind === "coverage" ? "get_coverage" : `get_${kind}`;
    return await this.read(method, [id], request);
  }

  async verifyDeployment(expectedSourceBytes?: Uint8Array, options: DeploymentVerificationOptions = {}): Promise<ContractVerification> {
    const checkSchema = options.checkSchema ?? true;
    const chainId = await this.chainIdFromRpc({ request: { subsystem: "deployment_verification" } });
    if (chainId !== FROZEN_CHAIN_ID) throw new Error(`Connected to chain ${chainId}, expected ${FROZEN_CHAIN_ID}`);
    const deployedSource = await this.client.getContractCode(this.address, { subsystem: "deployment_verification" });
    const deployedBytes = Buffer.from(deployedSource, "utf8");
    const sourceSha256 = createHash("sha256").update(deployedBytes).digest("hex");
    const expectedBytes = expectedSourceBytes ?? await readFile(fileURLToPath(new URL("../../../contracts/FaultPact.py", import.meta.url)));
    const sourceMatches = Buffer.compare(deployedBytes, expectedBytes) === 0;
    let schemaMatchesSnapshot = false;
    let deployedSchemaFingerprint = schemaFingerprint(this.schema);
    if (checkSchema) {
      const deployedSchema = await this.client.getContractSchema(this.address, { subsystem: "deployment_verification" }) as ContractSchema;
      schemaMatchesSnapshot = canonicalJson(deployedSchema) === canonicalJson(this.schema);
      deployedSchemaFingerprint = schemaFingerprint(deployedSchema);
    }
    if (!sourceMatches || sourceSha256 !== FROZEN_SOURCE_SHA256 || (checkSchema && !schemaMatchesSnapshot)) {
      throw new Error("Frozen deployment verification failed");
    }
    return {
      chainId,
      sourceSha256,
      sourceByteLength: deployedBytes.byteLength,
      sourceMatches,
      schemaFingerprint: deployedSchemaFingerprint,
      schemaMatchesSnapshot,
      schemaChecked: checkSchema,
      address: this.address,
    };
  }

  async getAllViews(): Promise<Array<{ name: string; args: readonly unknown[]; result: JsonValue }>> {
    const results: Array<{ name: string; args: readonly unknown[]; result: JsonValue }> = [];
    for (const name of this.viewMethods) {
      const definition = this.schema.methods[name];
      if (!definition) continue;
      const args = definition.params.map(() => 0n);
      if (args.length > 0) continue;
      results.push({ name, args, result: jsonSafe(await this.read(name, args)) });
    }
    return results;
  }
}

export async function createLiveAdapter(options: RpcTransportOptions = {}): Promise<FaultPactContractAdapter> {
  const { client } = await loadGenLayerRuntime(options);
  return new FaultPactContractAdapter(client);
}
