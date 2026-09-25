import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { RpcTransport } from "./rpc.js";

export type BridgeOptions = {
  transport: RpcTransport;
  subsystem?: string;
  maxBodyBytes?: number;
};

type JsonRpcRequest = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };

/**
 * Loopback JSON-RPC bridge.
 *
 * The GenLayer SDK issues its own `fetch()` calls for signing, nonce, gas and
 * receipt work. Those calls must obey the same Studio rate limit policy as
 * contract reads, so they are proxied through the shared `RpcTransport`
 * (minimum interval, daily budget, shared cooldown state, Retry-After aware
 * backoff) instead of a second, unmanaged request path.
 *
 * The listener is bound to 127.0.0.1 on an ephemeral port and only forwards
 * JSON-RPC payloads; it never accepts upstream connections.
 */
export class StudioRpcBridge {
  private server: Server | undefined;
  private bound: Promise<{ url: string }> | undefined;

  constructor(private readonly options: BridgeOptions) {}

  async start(): Promise<{ url: string }> {
    if (this.bound) return await this.bound;
    this.bound = new Promise<{ url: string }>((resolve, reject) => {
      const server = createServer((request, response) => {
        void this.handle(
          { method: request.method, on: (event, listener) => { request.on(event, listener); }, onError: (listener) => { request.on("error", listener); request.on("aborted", () => { listener(new Error("JSON-RPC request was aborted")); }); } },
          response,
        );
      });
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address() as AddressInfo | null;
        if (!address?.port) { reject(new Error("Studio RPC bridge did not bind a port")); return; }
        this.server = server;
        resolve({ url: `http://127.0.0.1:${address.port}/` });
      });
    });
    return await this.bound;
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.bound = undefined;
    if (!server) return;
    await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
    server.closeAllConnections?.();
  }

  private async handle(request: { method?: string; on: (event: "data" | "end", listener: (chunk: Buffer) => void) => void; onError: (listener: (error: Error) => void) => void }, response: { writeHead: (status: number, headers: Record<string, string>) => unknown; end: (body?: string) => unknown }): Promise<void> {
    if (request.method !== "POST") { response.writeHead(405, { "content-type": "application/json" }); response.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Studio RPC bridge only accepts JSON-RPC POST requests" } })); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      await new Promise<void>((resolve, reject) => {
        request.on("data", (chunk: Buffer) => {
          size += chunk.byteLength;
          if (size > (this.options.maxBodyBytes ?? 4_194_304)) { reject(new Error("JSON-RPC request body exceeds the bridge limit")); return; }
          chunks.push(chunk);
        });
        request.onError((error: Error) => { reject(error); });
        request.on("end", () => { resolve(); });
      });
    } catch (error) {
      response.writeHead(413, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: error instanceof Error ? error.message : "invalid request body" } }));
      return;
    }
    let payload: JsonRpcRequest;
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as JsonRpcRequest;
    } catch {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "invalid JSON-RPC request" } }));
      return;
    }
    const id = typeof payload.id === "string" || typeof payload.id === "number" ? payload.id : null;
    if (typeof payload.method !== "string" || payload.method.length === 0 || payload.method.length > 128) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32600, message: "JSON-RPC method is missing or invalid" } }));
      return;
    }
    const params = Array.isArray(payload.params) ? payload.params : [];
    try {
      const result = await this.options.transport.request(payload.method, params, { subsystem: this.options.subsystem ?? "reporter_write" });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id, result: result === undefined ? null : result }, (_key, value) => (typeof value === "bigint" ? value.toString() : value)));
    } catch (error) {
      // Transport-level failures (HTTP 429, cooldown, exhausted daily budget,
      // transport errors) are surfaced as JSON-RPC errors so the SDK never sees
      // a silent success, and the reporter layer maps them to a bounded retry
      // or a precise operational failure.
      const message = error instanceof Error ? error.message : "Studio RPC request failed";
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message } }));
    }
  }
}
