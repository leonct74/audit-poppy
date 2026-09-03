#!/usr/bin/env node
/**
 * A stateful mock AWS for the smoke harness (run-smoke.mjs): ONE endpoint the
 * sidecar reaches via AWS_ENDPOINT_URL, speaking each service's real wire
 * protocol — query-XML (STS, CloudFormation, IAM, EC2, RDS), JSON-1.1
 * (Config, CloudTrail, DynamoDB, Pricing), rest-json (Security Hub, Lambda)
 * and rest-xml (S3, virtual-host style via /etc/hosts). The sidecar itself is
 * UNTOUCHED: its typed SDK clients serialize real requests; this answers them.
 *
 * State is a small model of an account, so the loop is real: enabling Config
 * makes the recorder describable, the stack "creates" the bucket, findings
 * exist only after standards enable, teardown leaves the model empty.
 *
 * Introspection for the runner: GET /__state, POST /__reset {preEnabled}.
 */
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_AWS_PORT ?? 9911);
const ACCOUNT = "111122223333";
const REGION = "eu-west-1";
const BUCKET = `auditpoppy-evidence-${ACCOUNT}`;

const CIS_ARN = "arn:aws:securityhub:::ruleset/cis-aws-foundations-benchmark/v/1.2.0";
const FSBP_ARN = `arn:aws:securityhub:${REGION}::standards/aws-foundational-security-best-practices/v/1.0.0`;
const CIS_SUB = `arn:aws:securityhub:${REGION}:${ACCOUNT}:subscription/cis-aws-foundations-benchmark/v/1.2.0`;
const FSBP_SUB = `arn:aws:securityhub:${REGION}:${ACCOUNT}:subscription/aws-foundational-security-best-practices/v/1.0.0`;

const controlArn = (std, id) => `arn:aws:securityhub:${REGION}:${ACCOUNT}:control/${std}/${id}`;

/** The account's check inventory: [subscription, ControlId, status, severity, compliance]. */
const CONTROLS = [
  [CIS_SUB, "CIS.1.13", "ENABLED", "CRITICAL", "FAILED", ["arn:aws:iam::111122223333:root"]],
  [CIS_SUB, "CIS.1.2", "ENABLED", "HIGH", "FAILED", ["arn:aws:iam::111122223333:user/bob"]],
  [CIS_SUB, "CIS.2.1", "ENABLED", "HIGH", "PASSED", []],
  [CIS_SUB, "CIS.2.5", "ENABLED", "MEDIUM", "PASSED", []],
  [CIS_SUB, "CIS.4.1", "ENABLED", "HIGH", "FAILED", ["sg-0a1b2c3d"]],
  [CIS_SUB, "CIS.3.1", "ENABLED", "LOW", null, []], // no finding yet → NO_DATA
  [CIS_SUB, "CIS.2.9", "DISABLED", "MEDIUM", null, []],
  [FSBP_SUB, "IAM.5", "ENABLED", "HIGH", "FAILED", ["arn:aws:iam::111122223333:user/bob"]],
  [FSBP_SUB, "S3.1", "ENABLED", "MEDIUM", "PASSED", []],
  [FSBP_SUB, "EC2.8", "ENABLED", "HIGH", "WARNING", ["i-0123456789abcdef0"]],
  [FSBP_SUB, "RDS.2", "ENABLED", "CRITICAL", "PASSED", []],
  [FSBP_SUB, "GuardDuty.1", "ENABLED", "HIGH", "FAILED", [`arn:aws:guardduty:${REGION}:${ACCOUNT}:detector`]],
  [FSBP_SUB, "FOO.1", "ENABLED", "LOW", "PASSED", []], // deliberately unmapped
];

function freshState(preEnabled = false) {
  return {
    calls: [],
    config: preEnabled
      ? { recorder: { name: "default", roleARN: "arn:pre" }, recording: true, deliveryChannel: { name: "default" } }
      : { recorder: null, recording: false, deliveryChannel: null },
    slrExists: preEnabled,
    securityhub: { enabled: preEnabled, subscriptions: preEnabled ? [CIS_SUB, FSBP_SUB] : [] },
    /** When standards were enabled; 0 = long ago (pre-enabled accounts are READY). */
    standardsEnabledAt: preEnabled ? 0 : null,
    stack: null, // { status, pollsLeft, codeKey }
    s3: { buckets: preEnabled ? { [BUCKET]: {} } : {}, nextVersion: 1 },
    dynamo: [],
  };
}
let state = freshState();

const log = (entry) => state.calls.push(entry);

// ---------- protocol helpers ----------
const xmlEscape = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]);

function sendXml(res, status, body) {
  res.writeHead(status, { "content-type": "text/xml" });
  res.end(`<?xml version="1.0"?>\n${body}`);
}
function queryResult(action, xmlns, inner) {
  return `<${action}Response xmlns="${xmlns}"><${action}Result>${inner}</${action}Result><ResponseMetadata><RequestId>mock</RequestId></ResponseMetadata></${action}Response>`;
}
function queryError(res, code, message) {
  sendXml(res, 400, `<ErrorResponse><Error><Type>Sender</Type><Code>${code}</Code><Message>${xmlEscape(message)}</Message></Error><RequestId>mock</RequestId></ErrorResponse>`);
}
function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/x-amz-json-1.1", ...headers });
  res.end(JSON.stringify(body));
}
function restJsonError(res, status, type, message) {
  res.writeHead(status, { "content-type": "application/json", "x-amzn-errortype": type });
  res.end(JSON.stringify({ message }));
}

// ---------- query-protocol services (form-encoded Action) ----------
function handleQuery(params, res) {
  const action = params.get("Action");
  log({ proto: "query", action });
  switch (action) {
    // --- STS ---
    case "GetCallerIdentity":
      return sendXml(res, 200, queryResult(action, "https://sts.amazonaws.com/doc/2011-06-15/",
        `<Arn>arn:aws:iam::${ACCOUNT}:user/smoke</Arn><UserId>AIDAMOCK</UserId><Account>${ACCOUNT}</Account>`));

    // --- CloudFormation ---
    case "DescribeStacks": {
      const s = state.stack;
      if (!s) return queryError(res, "ValidationError", "Stack with id AuditPoppyStack does not exist");
      if (s.pollsLeft > 0) s.pollsLeft -= 1;
      else if (s.status.endsWith("_IN_PROGRESS")) {
        if (s.status === "DELETE_IN_PROGRESS") {
          state.stack = null;
          return queryError(res, "ValidationError", "Stack with id AuditPoppyStack does not exist");
        }
        s.status = s.status.startsWith("CREATE") ? "CREATE_COMPLETE" : "UPDATE_COMPLETE";
        state.s3.buckets[BUCKET] ??= {}; // the stack owns the bucket
      }
      return sendXml(res, 200, queryResult(action, "http://cloudformation.amazonaws.com/doc/2010-05-15/",
        `<Stacks><member><StackName>AuditPoppyStack</StackName><CreationTime>2026-09-03T00:00:00Z</CreationTime><StackStatus>${s.status}</StackStatus>` +
        `<Parameters><member><ParameterKey>LambdaCodeKey</ParameterKey><ParameterValue>${xmlEscape(s.codeKey)}</ParameterValue></member></Parameters>` +
        `<Outputs><member><OutputKey>EvidenceBucket</OutputKey><OutputValue>${BUCKET}</OutputValue></member><member><OutputKey>AssessmentsTable</OutputKey><OutputValue>AuditPoppyStack-assessments</OutputValue></member></Outputs>` +
        `</member></Stacks>`));
    }
    case "CreateStack":
      state.stack = { status: "CREATE_IN_PROGRESS", pollsLeft: 1, codeKey: params.get("Parameters.member.2.ParameterValue") ?? "" };
      // Find the LambdaCodeKey parameter wherever it landed in the list.
      for (let i = 1; i <= 6; i++) {
        if (params.get(`Parameters.member.${i}.ParameterKey`) === "LambdaCodeKey") {
          state.stack.codeKey = params.get(`Parameters.member.${i}.ParameterValue`) ?? "";
        }
      }
      return sendXml(res, 200, queryResult(action, "http://cloudformation.amazonaws.com/doc/2010-05-15/",
        `<StackId>arn:aws:cloudformation:${REGION}:${ACCOUNT}:stack/AuditPoppyStack/mock</StackId>`));
    case "UpdateStack": {
      state.stack.status = "UPDATE_IN_PROGRESS";
      state.stack.pollsLeft = 1;
      for (let i = 1; i <= 6; i++) {
        if (params.get(`Parameters.member.${i}.ParameterKey`) === "LambdaCodeKey") {
          state.stack.codeKey = params.get(`Parameters.member.${i}.ParameterValue`) ?? "";
        }
      }
      return sendXml(res, 200, queryResult(action, "http://cloudformation.amazonaws.com/doc/2010-05-15/",
        `<StackId>arn:aws:cloudformation:${REGION}:${ACCOUNT}:stack/AuditPoppyStack/mock</StackId>`));
    }
    case "DeleteStack":
      if (state.stack) {
        state.stack.status = "DELETE_IN_PROGRESS";
        state.stack.pollsLeft = 1;
        delete state.s3.buckets[BUCKET];
      }
      return sendXml(res, 200, `<DeleteStackResponse xmlns="http://cloudformation.amazonaws.com/doc/2010-05-15/"><ResponseMetadata><RequestId>mock</RequestId></ResponseMetadata></DeleteStackResponse>`);

    // --- IAM ---
    case "CreateServiceLinkedRole":
      if (state.slrExists) return queryError(res, "InvalidInput", "Service role name AWSServiceRoleForConfig has been taken");
      state.slrExists = true;
      return sendXml(res, 200, queryResult(action, "https://iam.amazonaws.com/doc/2010-05-08/",
        `<Role><Path>/aws-service-role/config.amazonaws.com/</Path><RoleName>AWSServiceRoleForConfig</RoleName><RoleId>AROAMOCK</RoleId><Arn>arn:aws:iam::${ACCOUNT}:role/aws-service-role/config.amazonaws.com/AWSServiceRoleForConfig</Arn><CreateDate>2026-09-03T00:00:00Z</CreateDate></Role>`));
    case "DeleteServiceLinkedRole":
      if (!state.slrExists) return queryError(res, "NoSuchEntity", "Role not found");
      state.slrExists = false;
      return sendXml(res, 200, queryResult(action, "https://iam.amazonaws.com/doc/2010-05-08/", `<DeletionTaskId>task/mock</DeletionTaskId>`));
    case "ListUsers":
      return sendXml(res, 200, queryResult(action, "https://iam.amazonaws.com/doc/2010-05-08/",
        `<Users>${["alice", "bob", "carol"].map((u) => `<member><Path>/</Path><UserName>${u}</UserName><UserId>AIDA${u}</UserId><Arn>arn:aws:iam::${ACCOUNT}:user/${u}</Arn><CreateDate>2026-01-01T00:00:00Z</CreateDate></member>`).join("")}</Users><IsTruncated>false</IsTruncated>`));
    case "ListMFADevices": {
      const user = params.get("UserName");
      const has = user !== "bob"; // bob skipped the security training
      return sendXml(res, 200, queryResult(action, "https://iam.amazonaws.com/doc/2010-05-08/",
        `<MFADevices>${has ? `<member><UserName>${user}</UserName><SerialNumber>arn:aws:iam::${ACCOUNT}:mfa/${user}</SerialNumber><EnableDate>2026-01-02T00:00:00Z</EnableDate></member>` : ""}</MFADevices><IsTruncated>false</IsTruncated>`));
    }
    case "GetAccountPasswordPolicy":
      return sendXml(res, 200, queryResult(action, "https://iam.amazonaws.com/doc/2010-05-08/",
        `<PasswordPolicy><MinimumPasswordLength>14</MinimumPasswordLength><RequireSymbols>true</RequireSymbols><MaxPasswordAge>90</MaxPasswordAge></PasswordPolicy>`));

    // --- RDS ---
    case "DescribeDBInstances":
      return sendXml(res, 200, queryResult(action, "http://rds.amazonaws.com/doc/2014-10-31/",
        `<DBInstances><DBInstance><DBInstanceIdentifier>appdb</DBInstanceIdentifier><Engine>postgres</Engine></DBInstance></DBInstances>`));

    // --- EC2 (its own xml dialect) ---
    case "DescribeInstances":
      return sendXml(res, 200,
        `<DescribeInstancesResponse xmlns="http://ec2.amazonaws.com/doc/2016-11-15/"><requestId>mock</requestId><reservationSet><item><reservationId>r-1</reservationId><instancesSet><item><instanceId>i-0123456789abcdef0</instanceId></item><item><instanceId>i-0aaaabbbbccccdddd</instanceId></item></instancesSet></item></reservationSet></DescribeInstancesResponse>`);
    case "DescribeSecurityGroups":
      return sendXml(res, 200,
        `<DescribeSecurityGroupsResponse xmlns="http://ec2.amazonaws.com/doc/2016-11-15/"><requestId>mock</requestId><securityGroupInfo>${["sg-0a1b2c3d", "sg-1", "sg-2"].map((g) => `<item><groupId>${g}</groupId><groupName>${g}</groupName></item>`).join("")}</securityGroupInfo></DescribeSecurityGroupsResponse>`);
    case "DescribeVpcs":
      return sendXml(res, 200,
        `<DescribeVpcsResponse xmlns="http://ec2.amazonaws.com/doc/2016-11-15/"><requestId>mock</requestId><vpcSet><item><vpcId>vpc-1</vpcId></item></vpcSet></DescribeVpcsResponse>`);

    default:
      console.error(`[mock] UNHANDLED query action: ${action}`);
      return queryError(res, "InvalidAction", `mock does not implement ${action}`);
  }
}

// ---------- JSON-1.1 services (X-Amz-Target) ----------
function handleJsonTarget(target, body, res) {
  const op = target.split(".").pop();
  log({ proto: "json", op });
  // --- Config ---
  if (target.startsWith("StarlingDoveService")) {
    switch (op) {
      case "DescribeConfigurationRecorders":
        return sendJson(res, 200, { ConfigurationRecorders: state.config.recorder ? [state.config.recorder] : [] });
      case "DescribeConfigurationRecorderStatus":
        return sendJson(res, 200, {
          ConfigurationRecordersStatus: state.config.recorder ? [{ name: "default", recording: state.config.recording }] : [],
        });
      case "PutConfigurationRecorder": {
        const rec = body.ConfigurationRecorder ?? {};
        if (!/^arn:aws:iam::\d{12}:role\/aws-service-role\/config\.amazonaws\.com\//.test(rec.roleARN ?? "")) {
          return sendJson(res, 400, { __type: "InvalidRoleException", message: `The role arn '${rec.roleARN}' passed is not valid` });
        }
        state.config.recorder = { name: rec.name, roleARN: rec.roleARN };
        return sendJson(res, 200, {});
      }
      case "PutDeliveryChannel": {
        const ch = body.DeliveryChannel ?? {};
        if (!state.s3.buckets[ch.s3BucketName]) {
          return sendJson(res, 400, { __type: "NoSuchBucketException", message: `Cannot find bucket ${ch.s3BucketName}` });
        }
        state.config.deliveryChannel = { name: ch.name, bucket: ch.s3BucketName, prefix: ch.s3KeyPrefix };
        return sendJson(res, 200, {});
      }
      case "StartConfigurationRecorder":
        if (!state.config.recorder) return sendJson(res, 400, { __type: "NoSuchConfigurationRecorderException", message: "no recorder" });
        state.config.recording = true;
        return sendJson(res, 200, {});
      case "StopConfigurationRecorder":
        if (!state.config.recorder) return sendJson(res, 400, { __type: "NoSuchConfigurationRecorderException", message: "no recorder" });
        state.config.recording = false;
        return sendJson(res, 200, {});
      case "DeleteDeliveryChannel":
        if (!state.config.deliveryChannel) return sendJson(res, 400, { __type: "NoSuchDeliveryChannelException", message: "no channel" });
        state.config.deliveryChannel = null;
        return sendJson(res, 200, {});
      case "DeleteConfigurationRecorder":
        if (!state.config.recorder) return sendJson(res, 400, { __type: "NoSuchConfigurationRecorderException", message: "no recorder" });
        state.config.recorder = null;
        state.config.recording = false;
        return sendJson(res, 200, {});
      case "GetDiscoveredResourceCounts":
        return sendJson(res, 200, { totalDiscoveredResources: state.config.recording ? 57 : 0 });
    }
  }
  // --- CloudTrail ---
  if (op === "DescribeTrails")
    return sendJson(res, 200, { trailList: [{ Name: "main", TrailARN: `arn:aws:cloudtrail:${REGION}:${ACCOUNT}:trail/main`, IsMultiRegionTrail: true }] });
  if (op === "GetTrailStatus") return sendJson(res, 200, { IsLogging: true });
  // --- DynamoDB ---
  if (op === "PutItem") {
    state.dynamo.push(body);
    return sendJson(res, 200, {});
  }
  // --- Pricing ---
  if (op === "GetProducts") {
    const svc = body.ServiceCode;
    const item = (dims) => JSON.stringify({ product: { productFamily: "mock" }, terms: { OnDemand: { T: { priceDimensions: dims } } } });
    if (svc === "AWSConfig") {
      return sendJson(res, 200, {
        PriceList: [
          item({
            A: { description: "0.003 per Configuration Item recorded", beginRange: "0", pricePerUnit: { USD: "0.0030000000" } },
            B: { description: "0.001 per Config Rule evaluation", beginRange: "0", pricePerUnit: { USD: "0.0010000000" } },
          }),
        ],
      });
    }
    if (svc === "AWSSecurityHub") {
      return sendJson(res, 200, {
        PriceList: [item({ A: { description: "0.0010 per security check", beginRange: "0", pricePerUnit: { USD: "0.0010000000" } } })],
      });
    }
    return sendJson(res, 200, { PriceList: [] });
  }
  console.error(`[mock] UNHANDLED json target: ${target}`);
  return sendJson(res, 400, { __type: "UnknownOperationException", message: target });
}

// ---------- Security Hub (rest-json) ----------
function handleSecurityHub(method, path, body, res) {
  log({ proto: "securityhub", method, path });
  const notEnabled = () =>
    restJsonError(res, 401, "InvalidAccessException", `Account ${ACCOUNT} is not subscribed to AWS Security Hub`);

  // DescribeHub's real REST mapping is GET /accounts.
  if (method === "GET" && (path === "/accounts" || path === "/hub")) {
    if (!state.securityhub.enabled) return notEnabled();
    return sendJson(res, 200, { HubArn: `arn:aws:securityhub:${REGION}:${ACCOUNT}:hub/default`, SubscribedAt: "2026-09-03T00:00:00Z" });
  }
  if (method === "POST" && path === "/accounts") {
    if (state.securityhub.enabled) return restJsonError(res, 409, "ResourceConflictException", "Account is already subscribed");
    state.securityhub.enabled = true;
    return sendJson(res, 200, {});
  }
  if (method === "DELETE" && path === "/accounts") {
    if (!state.securityhub.enabled) return notEnabled();
    state.securityhub.enabled = false;
    state.securityhub.subscriptions = [];
    return sendJson(res, 200, {});
  }
  if (method === "GET" && path === "/standards") {
    return sendJson(res, 200, { Standards: [{ StandardsArn: CIS_ARN, Name: "CIS" }, { StandardsArn: FSBP_ARN, Name: "FSBP" }] });
  }
  if (method === "POST" && path === "/standards/get") {
    if (!state.securityhub.enabled) return notEnabled();
    // Standards warm up for a few seconds after enable (time-based, so the
    // sidecar's own polling cadence can't race the transition).
    const settled = state.standardsEnabledAt !== null && Date.now() - state.standardsEnabledAt > 4000;
    const status = settled ? "READY" : "PENDING";
    return sendJson(res, 200, {
      StandardsSubscriptions: state.securityhub.subscriptions.map((sub) => ({
        StandardsSubscriptionArn: sub,
        StandardsArn: sub === CIS_SUB ? CIS_ARN : FSBP_ARN,
        StandardsInput: {},
        StandardsStatus: status,
      })),
    });
  }
  if (method === "POST" && path === "/standards/register") {
    if (!state.securityhub.enabled) return notEnabled();
    for (const req of body.StandardsSubscriptionRequests ?? []) {
      const sub = req.StandardsArn === CIS_ARN ? CIS_SUB : FSBP_SUB;
      if (!state.securityhub.subscriptions.includes(sub)) state.securityhub.subscriptions.push(sub);
    }
    state.standardsEnabledAt ??= Date.now();
    return sendJson(res, 200, { StandardsSubscriptions: [] });
  }
  if (method === "POST" && path === "/standards/deregister") {
    state.securityhub.subscriptions = state.securityhub.subscriptions.filter(
      (s) => !(body.StandardsSubscriptionArns ?? []).includes(s),
    );
    return sendJson(res, 200, { StandardsSubscriptions: [] });
  }
  if (method === "GET" && path.startsWith("/standards/controls/")) {
    const sub = decodeURIComponent(path.slice("/standards/controls/".length));
    const controls = CONTROLS.filter(([s]) => s === sub).map(([s, id, status, severity]) => ({
      StandardsControlArn: controlArn(s.includes("cis") ? "cis-aws-foundations-benchmark/v/1.2.0" : "aws-foundational-security-best-practices/v/1.0.0", id),
      ControlId: id,
      Title: `Mock title for ${id}`,
      ControlStatus: status,
      SeverityRating: severity,
    }));
    return sendJson(res, 200, { Controls: controls });
  }
  if (method === "POST" && path === "/findings") {
    if (!state.securityhub.enabled) return notEnabled();
    const ready = state.standardsEnabledAt !== null && Date.now() - state.standardsEnabledAt > 4000; // findings arrive once standards settle
    const findings = !ready
      ? []
      : CONTROLS.filter(([, , status, , compliance]) => status === "ENABLED" && compliance).map(
          ([sub, id, , severity, compliance, resources]) => ({
            SchemaVersion: "2018-10-08",
            Id: `finding/${id}`,
            ProductArn: `arn:aws:securityhub:${REGION}::product/aws/securityhub`,
            GeneratorId: id,
            AwsAccountId: ACCOUNT,
            Title: `Mock title for ${id}`,
            CreatedAt: "2026-09-03T00:00:00Z",
            UpdatedAt: "2026-09-03T00:00:00Z",
            Severity: { Label: severity },
            Compliance: { Status: compliance },
            ProductFields: {
              StandardsControlArn: controlArn(
                sub.includes("cis") ? "cis-aws-foundations-benchmark/v/1.2.0" : "aws-foundational-security-best-practices/v/1.0.0",
                id,
              ),
            },
            Resources: resources.map((r) => ({ Type: "Mock", Id: r })),
            RecordState: "ACTIVE",
            Workflow: { Status: "NEW" },
          }),
        );
    return sendJson(res, 200, { Findings: findings });
  }
  console.error(`[mock] UNHANDLED securityhub: ${method} ${path}`);
  return restJsonError(res, 400, "InternalException", `mock does not implement ${method} ${path}`);
}

// ---------- S3 (rest-xml, virtual-host style) ----------
function handleS3(bucket, method, path, query, bodyBuf, res) {
  log({ proto: "s3", method, bucket, path: path || "/" });
  const store = state.s3.buckets[bucket];
  const notFound = () => sendXml(res, 404, `<Error><Code>NoSuchBucket</Code><Message>The specified bucket does not exist</Message><BucketName>${bucket}</BucketName></Error>`);
  if (!store) return notFound();
  const key = path.replace(/^\//, "");

  if (method === "PUT" && key) {
    const version = `v${state.s3.nextVersion++}`;
    store[key] = { body: bodyBuf, versions: [...(store[key]?.versions ?? []), version] };
    res.writeHead(200, { etag: '"mock"' });
    return res.end();
  }
  if (method === "GET" && key) {
    const obj = store[key];
    if (!obj) return sendXml(res, 404, `<Error><Code>NoSuchKey</Code><Message>Not found</Message></Error>`);
    res.writeHead(200, { "content-type": "application/octet-stream", "content-length": obj.body.length });
    return res.end(obj.body);
  }
  if (method === "GET" && query.has("versions")) {
    const versions = Object.entries(store).flatMap(([k, o]) =>
      o.versions.map((v, i) => `<Version><Key>${xmlEscape(k)}</Key><VersionId>${v}</VersionId><IsLatest>${i === o.versions.length - 1}</IsLatest><Size>${o.body.length}</Size><LastModified>2026-09-03T00:00:00.000Z</LastModified></Version>`),
    );
    return sendXml(res, 200, `<ListVersionsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${bucket}</Name><IsTruncated>false</IsTruncated>${versions.join("")}</ListVersionsResult>`);
  }
  if (method === "GET" && query.get("list-type") === "2") {
    const prefix = query.get("prefix") ?? "";
    const keys = Object.entries(store).filter(([k]) => k.startsWith(prefix));
    return sendXml(res, 200,
      `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${bucket}</Name><IsTruncated>false</IsTruncated><KeyCount>${keys.length}</KeyCount>${keys
        .map(([k, o]) => `<Contents><Key>${xmlEscape(k)}</Key><Size>${o.body.length}</Size><LastModified>2026-09-03T00:00:00.000Z</LastModified><ETag>"mock"</ETag></Contents>`)
        .join("")}</ListBucketResult>`);
  }
  if (method === "POST" && query.has("delete")) {
    const xml = bodyBuf.toString("utf8");
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) delete store[m[1]];
    return sendXml(res, 200, `<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"></DeleteResult>`);
  }
  console.error(`[mock] UNHANDLED s3: ${method} ${path}?${query}`);
  return sendXml(res, 400, `<Error><Code>NotImplemented</Code><Message>mock</Message></Error>`);
}

// ---------- server ----------
const server = createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const bodyBuf = Buffer.concat(chunks);
    const url = new URL(req.url ?? "/", "http://mock");
    const hostHeader = (req.headers.host ?? "").split(":")[0];

    try {
      // Introspection for the runner.
      if (url.pathname === "/__state") {
        return sendJson(res, 200, {
          config: state.config,
          slrExists: state.slrExists,
          securityhub: state.securityhub,
          stack: state.stack,
          s3: Object.fromEntries(
            Object.entries(state.s3.buckets).map(([b, objs]) => [b, Object.fromEntries(Object.entries(objs).map(([k, o]) => [k, o.body.length]))]),
          ),
          dynamoWrites: state.dynamo.length,
          callCount: state.calls.length,
          calls: state.calls.slice(-40),
        });
      }
      if (url.pathname === "/__reset") {
        const opts = bodyBuf.length ? JSON.parse(bodyBuf.toString("utf8")) : {};
        state = freshState(opts.preEnabled === true);
        return sendJson(res, 200, { ok: true, preEnabled: opts.preEnabled === true });
      }

      // S3 virtual-host style: bucket in the Host header.
      if (hostHeader.endsWith(".aws.local") && hostHeader !== "aws.local") {
        const bucket = hostHeader.slice(0, -".aws.local".length);
        return handleS3(bucket, req.method ?? "GET", url.pathname, url.searchParams, bodyBuf, res);
      }
      // S3 ListBuckets: GET / on the base host (the SDK adds ?x-id=ListBuckets).
      if (
        req.method === "GET" &&
        url.pathname === "/" &&
        (url.searchParams.get("x-id") === "ListBuckets" || ![...url.searchParams.keys()].length)
      ) {
        log({ proto: "s3", method: "GET", op: "ListBuckets" });
        return sendXml(res, 200,
          `<ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Owner><ID>mock</ID></Owner><Buckets>${Object.keys(state.s3.buckets)
            .concat(["app-assets", "logs-archive"])
            .map((b) => `<Bucket><Name>${b}</Name><CreationDate>2026-01-01T00:00:00.000Z</CreationDate></Bucket>`)
            .join("")}</Buckets></ListAllMyBucketsResult>`);
      }

      const target = req.headers["x-amz-target"];
      if (typeof target === "string") return handleJsonTarget(target, bodyBuf.length ? JSON.parse(bodyBuf.toString("utf8")) : {}, res);

      const contentType = req.headers["content-type"] ?? "";
      if (req.method === "POST" && contentType.includes("x-www-form-urlencoded")) {
        return handleQuery(new URLSearchParams(bodyBuf.toString("utf8")), res);
      }

      // Lambda rest-json.
      if (url.pathname.startsWith("/2015-03-31/functions")) {
        log({ proto: "lambda", op: "ListFunctions" });
        return sendJson(res, 200, { Functions: [{ FunctionName: "api-fn" }, { FunctionName: "worker-fn" }] });
      }

      // Everything else on the base host is Security Hub's rest-json surface.
      return handleSecurityHub(req.method ?? "GET", url.pathname, bodyBuf.length ? JSON.parse(bodyBuf.toString("utf8")) : {}, res);
    } catch (err) {
      console.error("[mock] handler crashed:", err);
      return sendJson(res, 500, { __type: "InternalFailure", message: String(err) });
    }
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`[mock-aws] listening on 127.0.0.1:${PORT} — account ${ACCOUNT} (${REGION})`));
