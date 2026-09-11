/**
 * The host bootstrap (AGENTS.md §7): AgentsPoppy spawns this backend with
 * AGENTSPOPPY_BOOTSTRAP in the environment — the exact connection id, a
 * loopback endpoint to mint THIS connection's scoped credentials, the port to
 * listen on, our private dataDir, and the resolved AWS account/region.
 *
 * Structural mirror of @agentspoppy/extension-sdk's BackendBootstrap (poppies
 * don't take a cross-repo build dependency — the MailPoppy pattern).
 *
 * Absent bootstrap → developer mode: the AWS SDK default chain (AWS_PROFILE)
 * resolves credentials, state lives in a local .dev-data folder. That mode is
 * for the phase-0-style sandbox loop only; in the container the host always
 * injects the bootstrap.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export interface BackendBootstrap {
  connectionId: string;
  credentialsUrl: string;
  credentialsToken?: string;
  port?: number;
  dataDir?: string;
  permissionsBoundaryArn?: string;
  account: { accountId: string; region: string };
}

function boundaryArnOrUndefined(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const arn = v.trim();
  return /^arn:aws[a-z-]*:iam::\d{12}:policy\/.+/.test(arn) ? arn : undefined;
}

export function readBootstrap(env: NodeJS.ProcessEnv = process.env): BackendBootstrap | null {
  const raw = env.AGENTSPOPPY_BOOTSTRAP;
  if (!raw) return null;
  try {
    const b = JSON.parse(raw) as Partial<BackendBootstrap>;
    if (
      b &&
      typeof b.connectionId === "string" &&
      typeof b.credentialsUrl === "string" &&
      b.account &&
      typeof b.account.accountId === "string" &&
      typeof b.account.region === "string"
    ) {
      return {
        connectionId: b.connectionId,
        credentialsUrl: b.credentialsUrl,
        credentialsToken: typeof b.credentialsToken === "string" ? b.credentialsToken : undefined,
        port: typeof b.port === "number" ? b.port : undefined,
        dataDir: typeof b.dataDir === "string" && b.dataDir ? b.dataDir : undefined,
        permissionsBoundaryArn: boundaryArnOrUndefined(b.permissionsBoundaryArn),
        account: { accountId: b.account.accountId, region: b.account.region },
      };
    }
  } catch {
    /* malformed bootstrap → developer mode */
  }
  return null;
}

/** The one place the rest of the sidecar asks about its environment. */
export interface SidecarEnv {
  bootstrap: BackendBootstrap | null;
  /** Where we may write (bootstrap.dataDir under confinement; .dev-data in dev). */
  dataDir: string;
  region: string;
  accountId: string | undefined;
  port: number;
}

export function resolveEnv(env: NodeJS.ProcessEnv = process.env): SidecarEnv {
  const bootstrap = readBootstrap(env);
  const dataDir = bootstrap?.dataDir ?? join(process.cwd(), ".dev-data");
  try {
    mkdirSync(dataDir, { recursive: true });
  } catch {
    /* confined: dataDir already exists and is ours; anything else surfaces on write */
  }
  return {
    bootstrap,
    dataDir,
    region: bootstrap?.account.region ?? env.AWS_REGION ?? "eu-west-1",
    accountId: bootstrap?.account.accountId,
    port: bootstrap?.port ?? (env.PORT ? Number(env.PORT) : 8788),
  };
}
