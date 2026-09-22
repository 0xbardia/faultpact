import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { canonicalJson, normalizeAddress, jsonSafe, FROZEN_CHAIN_ID, FROZEN_RPC_URL, FROZEN_CONTRACT_ADDRESS, FROZEN_SOURCE_SHA256, type JsonValue } from "@faultpact/shared";
import schemaSnapshot from "./generated/studio-dev-schema.json" with { type: "json" };
import { StudioRpcTransport, type RpcTransport } from "./rpc.js";

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

export async function loadGenLayerRuntime(): Promise<{
  client: RpcTransport;
  account?: { address: string };
}> {
  return { client: new StudioRpcTransport(FROZEN_RPC_URL) };
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

  get viewMethods() {
    return methodNames(this.schema, "view");
  }

  get writeMethods() {
    return methodNames(this.schema, "write");
  }

  get payableMethods() {
    return Object.entries(this.schema.methods).filter(([, method]) => method.payable === true).map(([name]) => name).sort();
  }

  async chainIdFromRpc(options: { maxAgeMs?: number } = {}): Promise<number> {
    const maxAgeMs = options.maxAgeMs ?? 0;
    if (maxAgeMs > 0 && this.cachedRpcChain && Date.now() - this.cachedRpcChain.checkedAt < maxAgeMs) return this.cachedRpcChain.value;
    const value = await this.client.request("eth_chainId", []);
    const chainId = typeof value === "string" ? Number.parseInt(value, 16) : Number(value);
    if (!Number.isInteger(chainId)) throw new Error("RPC returned invalid chain ID");
    this.cachedRpcChain = { value: chainId, checkedAt: Date.now() };
    return chainId;
  }

  async read<T = unknown>(method: string, args: readonly unknown[] = []): Promise<T> {
    const definition = this.schema.methods[method];
    if (!definition) throw new Error(`Unknown contract method ${method}`);
    if (!definition.readonly) throw new Error(`Refusing write method through read adapter: ${method}`);
    if (definition.params.length !== args.length) throw new Error(`${method} expects ${definition.params.length} arguments`);
    return await this.client.readContract(this.address, method, args) as T;
  }

  async write(method: string, args: readonly unknown[] = [], value?: bigint): Promise<unknown> {
    const definition = this.schema.methods[method];
    if (!definition) throw new Error(`Unknown contract method ${method}`);
    if (definition.readonly) throw new Error(`Refusing view method through write adapter: ${method}`);
    if (definition.params.length !== args.length) throw new Error(`${method} expects ${definition.params.length} arguments`);
    void value;
    throw new Error(`Reporter write transport is intentionally signer-gated and not available through the read adapter: ${method}`);
  }

  async getCounters(): Promise<Record<string, unknown>> { return await this.read("get_counters"); }
  async getProtocolConfig(): Promise<Record<string, unknown>> { return await this.read("get_protocol_config"); }
  async isAuthorizedReporter(address: string): Promise<boolean> { return await this.read<boolean>("is_authorized_reporter", [normalizeAddress(address)]); }
  async getEntity(kind: "provider" | "service" | "pact" | "coverage" | "incident" | "evidence" | "challenge" | "claim", id: bigint): Promise<unknown> {
    const method = kind === "challenge" ? "get_challenge" : kind === "coverage" ? "get_coverage" : `get_${kind}`;
    return await this.read(method, [id]);
  }

  async verifyDeployment(expectedSourceBytes?: Uint8Array, options: DeploymentVerificationOptions = {}): Promise<ContractVerification> {
    const checkSchema = options.checkSchema ?? true;
    const chainId = await this.chainIdFromRpc();
    if (chainId !== FROZEN_CHAIN_ID) throw new Error(`Connected to chain ${chainId}, expected ${FROZEN_CHAIN_ID}`);
    const deployedSource = await this.client.getContractCode(this.address);
    const deployedBytes = Buffer.from(deployedSource, "utf8");
    const sourceSha256 = createHash("sha256").update(deployedBytes).digest("hex");
    const expectedBytes = expectedSourceBytes ?? await readFile(fileURLToPath(new URL("../../../contracts/FaultPact.py", import.meta.url)));
    const sourceMatches = Buffer.compare(deployedBytes, expectedBytes) === 0;
    let schemaMatchesSnapshot = false;
    let deployedSchemaFingerprint = schemaFingerprint(this.schema);
    if (checkSchema) {
      const deployedSchema = await this.client.getContractSchema(this.address) as ContractSchema;
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

export async function createLiveAdapter(): Promise<FaultPactContractAdapter> {
  const { client } = await loadGenLayerRuntime();
  return new FaultPactContractAdapter(client);
}
