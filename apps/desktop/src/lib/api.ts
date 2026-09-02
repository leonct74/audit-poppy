/**
 * Typed calls to our own sidecar (through host.invokeBackend). The response
 * shapes mirror the sidecar's routes; the heavyweight domain types come from
 * @auditpoppy/core so all three layers speak the same language.
 */
import type {
  CostEstimate,
  EvidenceBundleSummary,
  FreeTrialState,
  GapReport,
  Ledger,
  ObservedPosture,
  RecorderState,
  RenderedPolicy,
  PolicyTemplate,
  StandardState,
} from "@auditpoppy/core";
import { host } from "./host";

export interface ReadinessInfo {
  standards: StandardState[];
  controls: unknown[];
  recorder: RecorderState;
}

export interface StackInfo {
  status: "ABSENT" | "CREATING" | "STORAGE_READY" | "UPDATING" | "COMPLETE" | "DELETING" | "FAILED";
  rawStatus?: string;
  lambdaCodeKey?: string;
  evidenceBucket?: string;
  statusReason?: string;
}

export interface StatusResponse {
  account: string | null;
  region: string;
  containerMode: boolean;
  ledger: Ledger;
  readiness: ReadinessInfo | { error: string } | null;
  warmingUp: boolean;
  stack: StackInfo;
  enableOp: { startedAt: string; finishedAt?: string; error?: string } | null;
  securityHubEnabledAt: string | null;
  freeTrial: FreeTrialState | null;
  mappingVersion: string;
}

export interface CostsResponse {
  resourceCount: number;
  estimate: CostEstimate;
  approxFallback: boolean;
  freeTrial: FreeTrialState | null;
}

export interface PoliciesResponse {
  templates: PolicyTemplate[];
  rendered: RenderedPolicy[];
  answers: Record<string, Record<string, string>>;
}

export interface ExportResponse {
  generatedAt: string;
  watermarked: boolean;
  jsonToken: string;
  pdfToken: string;
}

export interface TeardownResponse {
  disabled: string[];
  leftAlone: string[];
  bucketEmptied: boolean;
  stackDeleted: boolean;
  problems: string[];
}

export const api = {
  status: () => host.invokeBackend<StatusResponse>({ method: "GET", path: "/status" }),
  baseline: () => host.invokeBackend<{ configOn: boolean; securityHubOn: boolean; ledger: Ledger }>({ method: "POST", path: "/baseline" }),
  costs: () => host.invokeBackend<CostsResponse>({ method: "GET", path: "/costs" }),
  enable: () => host.invokeBackend<{ started: boolean }>({ method: "POST", path: "/enable" }),
  report: () => host.invokeBackend<GapReport>({ method: "GET", path: "/report" }),
  posture: () => host.invokeBackend<ObservedPosture>({ method: "GET", path: "/posture" }),
  deploy: () => host.invokeBackend<StackInfo>({ method: "POST", path: "/deploy" }),
  evidence: () => host.invokeBackend<{ bundles: EvidenceBundleSummary[] }>({ method: "GET", path: "/evidence" }),
  snapshot: () => host.invokeBackend<{ ok: boolean; key: string }>({ method: "POST", path: "/snapshot" }),
  policies: () => host.invokeBackend<PoliciesResponse>({ method: "GET", path: "/policies" }),
  saveAnswers: (policyId: string, answers: Record<string, string>) =>
    host.invokeBackend<{ ok: boolean }>({ method: "POST", path: "/policies/answers", body: { policyId, answers } }),
  notes: () => host.invokeBackend<{ notes: string[] }>({ method: "GET", path: "/notes" }),
  saveNotes: (notes: string[]) => host.invokeBackend<{ ok: boolean }>({ method: "POST", path: "/notes", body: { notes } }),
  buildExport: (licensed: boolean) =>
    host.invokeBackend<ExportResponse>({ method: "POST", path: "/export", body: { licensed } }),
  disableChecks: () => host.invokeBackend<TeardownResponse>({ method: "POST", path: "/disable-checks" }),
};
