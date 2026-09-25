import snapshot from "./generated/studio-dev-schema.json" with { type: "json" };

export type MethodDefinition = { params: Array<[string, string]>; readonly: boolean; payable?: boolean };
const methods = snapshot.methods as unknown as Record<string, MethodDefinition>;

export function getMethodDefinition(name: string): MethodDefinition | undefined {
  return methods[name];
}
