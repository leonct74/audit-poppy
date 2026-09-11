/**
 * Test doubles for the AWS seam: a FakeApi answers by command CLASS NAME, so
 * flows are tested against the exact typed commands they send (finding 2's
 * discipline extends to the tests — no string-matched payloads).
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AwsApi, Clients } from "./clients";

type Responder = (input: Record<string, unknown>) => unknown;

export class FakeApi implements AwsApi {
  /** Every command sent, in order: { name, input }. */
  readonly calls: { name: string; input: Record<string, unknown> }[] = [];
  private readonly responders = new Map<string, Responder>();

  on(commandName: string, responder: Responder | unknown): this {
    this.responders.set(commandName, typeof responder === "function" ? (responder as Responder) : () => responder);
    return this;
  }

  sent(commandName: string): { name: string; input: Record<string, unknown> }[] {
    return this.calls.filter((c) => c.name === commandName);
  }

  async send(command: unknown): Promise<unknown> {
    const name = (command as { constructor: { name: string } }).constructor.name;
    const input = ((command as { input?: Record<string, unknown> }).input ?? {}) as Record<string, unknown>;
    this.calls.push({ name, input });
    const responder = this.responders.get(name);
    if (!responder) throw new Error(`FakeApi: no responder for ${name}`);
    const result = responder(input);
    if (result instanceof Error) throw result;
    return result;
  }
}

export function awsError(name: string, message = name): Error {
  return Object.assign(new Error(message), { name });
}

type FakeSet = { [K in keyof Omit<Clients, "region">]: FakeApi };

export function fakeClients(overrides: Partial<FakeSet> = {}): Clients & { fakes: FakeSet } {
  const make = (): FakeApi => new FakeApi();
  const fakes = {
    config: overrides.config ?? make(),
    securityhub: overrides.securityhub ?? make(),
    cloudformation: overrides.cloudformation ?? make(),
    s3: overrides.s3 ?? make(),
    iam: overrides.iam ?? make(),
    sts: overrides.sts ?? make(),
    ec2: overrides.ec2 ?? make(),
    rds: overrides.rds ?? make(),
    lambda: overrides.lambda ?? make(),
    cloudtrail: overrides.cloudtrail ?? make(),
    dynamodb: overrides.dynamodb ?? make(),
    pricing: overrides.pricing ?? make(),
  };
  return { ...fakes, region: "eu-west-1", fakes };
}

export function tempDataDir(): string {
  return mkdtempSync(join(tmpdir(), "auditpoppy-test-"));
}
