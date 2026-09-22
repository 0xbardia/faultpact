export type SubmissionResult = "SUBMITTED" | "ALREADY_ONCHAIN" | "DISABLED" | "UNAUTHORIZED";

export class ReporterSubmissionGate {
  constructor(private readonly input: { enabled: boolean; reporterAddress?: string; authorized: boolean; hasPrivateKey: boolean }) {}

  async submit(input: { existsOnchain: () => Promise<boolean>; send: () => Promise<unknown> }): Promise<{ result: SubmissionResult; transaction?: unknown }> {
    if (!this.input.enabled || !this.input.hasPrivateKey) return { result: "DISABLED" };
    if (!this.input.reporterAddress || !this.input.authorized) return { result: "UNAUTHORIZED" };
    if (await input.existsOnchain()) return { result: "ALREADY_ONCHAIN" };
    return { result: "SUBMITTED", transaction: await input.send() };
  }
}
