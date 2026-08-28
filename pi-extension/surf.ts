import { createRequire } from "node:module";
import { Type } from "typebox";

const require = createRequire(import.meta.url);
const { openClientTransport } = require("../native/client-transport.cjs") as {
  openClientTransport(endpoint: SurfEndpoint, options?: { requestTimeoutMs?: number }): Promise<{
    request(message: Record<string, unknown>, timeoutMs?: number, transferPlan?: Record<string, unknown>): Promise<Record<string, unknown>>;
    close(): Promise<void>;
  }>;
};
const { selectEndpoint } = require("../native/endpoint.cjs") as {
  selectEndpoint(args: string[], env?: Record<string, string | undefined>): { endpoint: SurfEndpoint };
};
const { resolveRequestDeadlineMs } = require("../native/host-sessions.cjs") as {
  resolveRequestDeadlineMs(tool: string, args: Record<string, unknown>): number;
};
const { prepareRemoteTool, validateLocalToolPaths } = require("../native/file-transfer.cjs") as {
  prepareRemoteTool(tool: string, args: Record<string, unknown>): { args: Record<string, unknown>; uploads?: unknown[]; downloads?: unknown[]; pathRefs?: unknown[] };
  validateLocalToolPaths(tool: string, args: Record<string, unknown>): Record<string, unknown>;
};

const MAX_OUTPUT_CHARS = 20_000;
const ORACLE_ACTIVE_STATES = new Set(["created", "dispatched", "awaiting"]);
const ORACLE_TERMINAL_STATES = new Set(["captured", "failed"]);
const ORACLE_FINISHED_CHANNEL = "surf-oracle:finished";
const BACKGROUND_WORK_PROTOCOL_VERSION = 1;
const BACKGROUND_WORK_REGISTRY_KEY = "pi-subagents.background-work.v1";
const BACKGROUND_WORK_MODULE_SPECIFIER = "pi-subagents/background-work";
const EXTERNAL_JOB_PROVIDER_PROTOCOL_VERSION = 1;
const EXTERNAL_JOB_PROVIDER_REGISTRY_KEY = "pi-subagents.external-job-providers.v1";
const EXTERNAL_JOB_PROVIDER_MODULE_SPECIFIER = "pi-subagents/external-job-provider";

type Pi = {
  registerTool(tool: Record<string, unknown>): void;
  on(event: "session_start" | "session_shutdown", handler: (event: unknown, ctx: unknown) => void | Promise<void>): void;
  events?: { emit(event: string, data: unknown): void };
};

type SurfEndpoint = { kind?: string };

type ToolResult = { content: Array<{ type: "text" | "image"; text?: string; data?: string; mimeType?: string }>; details?: unknown; isError?: boolean };

type OracleJob = {
  id: string;
  state: string;
  conversationUrl: string | null;
  follow: string | null;
  response?: string;
  error: { code?: string; message?: string } | null;
};

type BackgroundWorkProvider = {
  name: string;
  wakeChannels: string[];
  listActiveWork(): Array<{ id: string; sessionId: string }>;
};

type RegisterBackgroundWorkProvider = (provider: BackgroundWorkProvider) => () => void;

type BackgroundWorkModule = {
  registerBackgroundWorkProvider?: unknown;
};

type BackgroundWorkRegistry = {
  version: typeof BACKGROUND_WORK_PROTOCOL_VERSION;
  providers: Map<string, BackgroundWorkProvider>;
};

type OracleExternalJob = {
  id: string;
  state: string;
  conversationUrl: string | null;
  follow?: string;
  resultText?: string;
  failure?: { code: string; message: string };
};

type PiExternalJobState = "queued" | "running" | "completed" | "failed";

type PiExternalJobHandle = {
  providerJobId: string;
  state: PiExternalJobState;
  conversationUrl?: string;
  failureCode?: string;
  failureMessage?: string;
};

type PiExternalJobResult = PiExternalJobHandle & { output?: string };

type OracleExternalJobProvider = {
  name: "surf-oracle";
  start(input: Record<string, unknown>): Promise<PiExternalJobHandle>;
  status(id: string): Promise<PiExternalJobHandle>;
  result(id: string): Promise<PiExternalJobResult>;
  reattach(id: string): Promise<PiExternalJobHandle>;
  followUp?(input: Record<string, unknown>): Promise<PiExternalJobHandle>;
};

type RegisterExternalJobProvider = (provider: OracleExternalJobProvider) => () => void;

type ExternalJobProviderModule = {
  registerExternalJobProvider?: unknown;
};

type ExternalJobProviderRegistry = {
  version: typeof EXTERNAL_JOB_PROVIDER_PROTOCOL_VERSION;
  providers: Map<string, OracleExternalJobProvider>;
};

type RememberOracleJob = (jobId: string) => boolean;
type EmitOracleJob = (job: Pick<OracleExternalJob, "id" | "state">) => boolean;

function textResult(value: unknown, isError = false): ToolResult {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const bounded = text.length > MAX_OUTPUT_CHARS
    ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n\n[Surf output truncated at ${MAX_OUTPUT_CHARS} characters]`
    : text;
  return { content: [{ type: "text", text: bounded }], ...(isError ? { isError: true } : {}) };
}

export function resultFromHost(response: Record<string, unknown>): ToolResult {
  const error = response.error as { content?: Array<{ text?: string }> } | undefined;
  if (error) {
    return {
      ...textResult(error.content?.map((item) => item.text ?? "").join("\n") || "Surf request failed", true),
      details: error,
    };
  }
  const result = response.result as { content?: ToolResult["content"] } | undefined;
  if (!result?.content) return textResult(result ?? "OK");
  const text = result.content.find((item) => item.type === "text")?.text;
  let details: unknown;
  try {
    details = text ? JSON.parse(text) : undefined;
  } catch {
    details = undefined;
  }
  const content = result.content.map((item) => item.type === "text" && item.text && item.text.length > MAX_OUTPUT_CHARS
    ? { ...item, text: `${item.text.slice(0, MAX_OUTPUT_CHARS)}\n\n[Surf output truncated at ${MAX_OUTPUT_CHARS} characters]` }
    : item);
  return { content, details };
}

export function createToolRequest(tool: string, args: Record<string, unknown>, tabId?: number) {
  return {
    type: "tool_request",
    method: "execute_tool",
    params: { tool, args, ...(tabId === undefined ? {} : { tabId }) },
    id: `pi-surf-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  };
}

function prepareRequest(endpoint: SurfEndpoint, tool: string, args: Record<string, unknown>) {
  if (endpoint.kind === "remote") return prepareRemoteTool(tool, args);
  return { args: validateLocalToolPaths(tool, args), uploads: [], downloads: [], pathRefs: [] };
}

export async function requestSurf(tool: string, args: Record<string, unknown>, tabId?: number): Promise<ToolResult> {
  const { endpoint } = selectEndpoint([], process.env);
  const timeoutMs = resolveRequestDeadlineMs(tool, args);
  const transport = await openClientTransport(endpoint, { requestTimeoutMs: timeoutMs });
  try {
    const prepared = prepareRequest(endpoint, tool, args);
    const response = await transport.request(createToolRequest(tool, prepared.args, tabId), timeoutMs, prepared);
    return resultFromHost(response);
  } finally {
    await transport.close();
  }
}

export function surfRequest(tool: string, args: Record<string, unknown>, tabId?: number) {
  return requestSurf(tool, args, tabId);
}

export function registerGlobalBackgroundProvider(provider: BackgroundWorkProvider): () => void {
  const key = Symbol.for(BACKGROUND_WORK_REGISTRY_KEY);
  const globalObject = globalThis as Record<PropertyKey, unknown>;
  const existing = globalObject[key];
  let registry: BackgroundWorkRegistry;

  if (existing === undefined) {
    registry = { version: BACKGROUND_WORK_PROTOCOL_VERSION, providers: new Map() };
    globalObject[key] = registry;
  } else if (
    existing &&
    typeof existing === "object" &&
    !Array.isArray(existing) &&
    (existing as Partial<BackgroundWorkRegistry>).version === BACKGROUND_WORK_PROTOCOL_VERSION &&
    (existing as Partial<BackgroundWorkRegistry>).providers instanceof Map
  ) {
    registry = existing as BackgroundWorkRegistry;
  } else {
    throw new Error(`Unsupported background-work registry at Symbol.for("${BACKGROUND_WORK_REGISTRY_KEY}").`);
  }

  registry.providers.set(provider.name, provider);
  return () => {
    if (registry.providers.get(provider.name) === provider) registry.providers.delete(provider.name);
  };
}

export function registerGlobalExternalJobProvider(provider: OracleExternalJobProvider): () => void {
  const key = Symbol.for(EXTERNAL_JOB_PROVIDER_REGISTRY_KEY);
  const globalObject = globalThis as Record<PropertyKey, unknown>;
  const existing = globalObject[key];
  let registry: ExternalJobProviderRegistry;

  if (existing === undefined) {
    registry = { version: EXTERNAL_JOB_PROVIDER_PROTOCOL_VERSION, providers: new Map() };
    globalObject[key] = registry;
  } else if (
    existing &&
    typeof existing === "object" &&
    !Array.isArray(existing) &&
    (existing as Partial<ExternalJobProviderRegistry>).version === EXTERNAL_JOB_PROVIDER_PROTOCOL_VERSION &&
    (existing as Partial<ExternalJobProviderRegistry>).providers instanceof Map
  ) {
    registry = existing as ExternalJobProviderRegistry;
  } else {
    throw new Error(`Unsupported external-job provider registry at Symbol.for("${EXTERNAL_JOB_PROVIDER_REGISTRY_KEY}").`);
  }

  registry.providers.set(provider.name, provider);
  return () => {
    if (registry.providers.get(provider.name) === provider) registry.providers.delete(provider.name);
  };
}

export async function resolveBackgroundWorkRegister(
  loadModule: () => Promise<BackgroundWorkModule> = () => import(BACKGROUND_WORK_MODULE_SPECIFIER) as Promise<BackgroundWorkModule>,
): Promise<RegisterBackgroundWorkProvider> {
  try {
    const module = await loadModule();
    if (typeof module.registerBackgroundWorkProvider === "function") {
      return module.registerBackgroundWorkProvider as RegisterBackgroundWorkProvider;
    }
  } catch {
    // The Pi bridge is optional. Surf also runs in other coding-agent harnesses and as a direct CLI.
  }
  return registerGlobalBackgroundProvider;
}

export async function resolveExternalJobProviderRegister(
  loadModule: () => Promise<ExternalJobProviderModule> = () => import(EXTERNAL_JOB_PROVIDER_MODULE_SPECIFIER) as Promise<ExternalJobProviderModule>,
): Promise<RegisterExternalJobProvider> {
  try {
    const module = await loadModule();
    if (typeof module.registerExternalJobProvider === "function") {
      return module.registerExternalJobProvider as RegisterExternalJobProvider;
    }
  } catch {
    // The Pi bridge is optional. Surf also runs in other coding-agent harnesses and as a direct CLI.
  }
  return registerGlobalExternalJobProvider;
}

function optionalOracleString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`Surf oracle response included an invalid ${field}`);
  return value;
}

function oracleFailure(value: unknown): OracleJob["error"] {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Surf oracle response included invalid failure details");
  }
  const details = value as Record<string, unknown>;
  const code = optionalOracleString(details.code, "failure code");
  const message = optionalOracleString(details.message, "failure message");
  return { ...(code === undefined ? {} : { code }), ...(message === undefined ? {} : { message }) };
}

function asOracleJob(value: unknown): OracleJob {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Surf oracle response did not include job metadata");
  const job = value as Record<string, unknown>;
  if (typeof job.id !== "string" || !job.id || job.id.trim() !== job.id || typeof job.state !== "string") {
    throw new Error("Surf oracle response did not include a valid job id and state");
  }
  const conversationUrl = optionalOracleString(job.conversationUrl, "conversation URL");
  const follow = optionalOracleString(job.follow, "follow job id");
  const response = optionalOracleString(job.response, "result text");
  return {
    id: job.id,
    state: job.state,
    conversationUrl: conversationUrl ?? null,
    follow: follow ?? null,
    error: oracleFailure(job.error),
    ...(response === undefined ? {} : { response }),
  };
}

function oracleExternalJob(job: OracleJob): OracleExternalJob {
  const resultText = typeof job.response === "string" ? job.response : undefined;
  const failure = job.error
    ? { code: job.error.code || "failed", message: job.error.message || "Surf oracle job failed" }
    : undefined;
  return {
    id: job.id,
    state: job.state,
    conversationUrl: job.conversationUrl ?? null,
    ...(typeof job.follow === "string" ? { follow: job.follow } : {}),
    ...(resultText === undefined ? {} : { resultText }),
    ...(failure ? { failure } : {}),
  };
}

// pi-subagents' external-job contract rejects unknown fields, null values,
// untrimmed strings, and non-contract states, so map oracle payloads at this
// boundary instead of passing them through.
const PI_STATE_BY_ORACLE_STATE: Record<string, PiExternalJobState> = {
  created: "queued",
  dispatched: "running",
  awaiting: "running",
  captured: "completed",
  failed: "failed",
};
const PI_MAX_FAILURE_CODE_CHARS = 128;
const PI_MAX_FAILURE_MESSAGE_CHARS = 4_096;
const PI_MAX_OUTPUT_CHARS = 1024 * 1024;

function piBounded(value: string, maxChars: number): string {
  return value.slice(0, maxChars).trim();
}

export function piExternalJobHandle(job: OracleExternalJob): PiExternalJobHandle {
  const state = PI_STATE_BY_ORACLE_STATE[job.state];
  if (!state) throw new Error(`Surf oracle job ${job.id} reported unknown state '${job.state}'`);
  const conversationUrl = job.conversationUrl ?? undefined;
  const failureCode = job.failure ? piBounded(job.failure.code, PI_MAX_FAILURE_CODE_CHARS) : "";
  const failureMessage = job.failure ? piBounded(job.failure.message, PI_MAX_FAILURE_MESSAGE_CHARS) : "";
  return {
    providerJobId: job.id,
    state,
    ...(conversationUrl ? { conversationUrl } : {}),
    ...(failureCode ? { failureCode } : {}),
    ...(failureMessage ? { failureMessage } : {}),
  };
}

export function piExternalJobResult(job: OracleExternalJob): PiExternalJobResult {
  const output = job.resultText === undefined ? "" : piBounded(job.resultText, PI_MAX_OUTPUT_CHARS);
  return { ...piExternalJobHandle(job), ...(output ? { output } : {}) };
}

async function requestOracleJob(request: typeof requestSurf, tool: string, args: Record<string, unknown>) {
  const result = await request(tool, args);
  if (result.isError) {
    const details = result.details as { code?: unknown; jobId?: unknown; message?: unknown } | undefined;
    const message = typeof details?.message === "string"
      ? details.message
      : result.content.map((item) => item.text ?? "").join("\n") || "Surf oracle request failed";
    const error = new Error(message);
    if (typeof details?.code === "string") Object.assign(error, { code: details.code });
    if (typeof details?.jobId === "string") Object.assign(error, { jobId: details.jobId });
    if (details?.code === "capacity" && typeof details?.jobId === "string") Object.assign(error, { blockingJobId: details.jobId });
    throw error;
  }
  return oracleExternalJob(asOracleJob(result.details));
}

function emitFailedOracleJob(error: unknown, emitTerminal: EmitOracleJob) {
  if (error && typeof error === "object" && "code" in error && error.code === "SURF_REQUEST_ABORTED") return;
  if (!error || typeof error !== "object" || !("jobId" in error) || typeof error.jobId !== "string") return;
  emitTerminal({ id: error.jobId, state: "failed" });
}

function oracleOption(input: Record<string, unknown>, key: "model" | "effort"): string | undefined {
  const options = input.options;
  if (options && typeof options === "object" && !Array.isArray(options)) {
    const value = (options as Record<string, unknown>)[key];
    if (typeof value === "string") return value;
  }
  const direct = input[key];
  return typeof direct === "string" ? direct : undefined;
}

function oracleAttachmentOption(input: Record<string, unknown>): string | string[] | undefined {
  const options = input.options;
  const optionRecord = options && typeof options === "object" && !Array.isArray(options)
    ? options as Record<string, unknown>
    : undefined;
  const optionValue = optionRecord?.file;
  const value = optionValue === undefined ? input.file : optionValue;
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) return value as string[];
  return undefined;
}

function oracleBooleanOption(input: Record<string, unknown>, key: string): boolean {
  const options = input.options;
  const optionValue = options && typeof options === "object" && !Array.isArray(options)
    ? (options as Record<string, unknown>)[key]
    : undefined;
  const value = optionValue === undefined ? input[key] : optionValue;
  return value === true;
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function parentProviderJobId(input: Record<string, unknown>): string {
  const id = optionalString(input, "parentProviderJobId") ?? optionalString(input, "providerJobId");
  if (!id) throw new Error("parentProviderJobId required");
  return id;
}

function assertFollowJob(job: OracleExternalJob, parentId: string) {
  if (job.id === parentId) throw new Error(`Surf oracle follow-up reused parent job '${parentId}'`);
  if (job.follow !== parentId) throw new Error(`Surf oracle follow-up job '${job.id}' is not linked to parent '${parentId}'`);
}

const ORACLE_STATUS_HARVEST_TIMEOUT_SECONDS = 5;

async function requestOracleJobStatus(request: typeof requestSurf, id: string) {
  try {
    return await requestOracleJob(request, "oracle.result", {
      id,
      timeout: ORACLE_STATUS_HARVEST_TIMEOUT_SECONDS,
    });
  } catch (error) {
    if (!error || typeof error !== "object") throw error;
    if ("code" in error && error.code === "SURF_REQUEST_ABORTED") throw error;
    if ("jobId" in error && error.jobId === id) {
      return requestOracleJob(request, "oracle.status", { id });
    }
    throw error;
  }
}

export function createOracleExternalJobProvider(
  jobIds: Set<string>,
  request: typeof requestSurf = requestSurf,
  rememberJob: RememberOracleJob = (jobId) => {
    jobIds.add(jobId);
    return true;
  },
  emitTerminal: EmitOracleJob = () => false,
  options: { followUp?: boolean } = {},
): OracleExternalJobProvider {
  const provider: OracleExternalJobProvider = {
    name: "surf-oracle",
    async start(input) {
      const prompt = typeof input.prompt === "string" ? input.prompt : "";
      if (!prompt.trim()) throw new Error("prompt required");
      const model = oracleOption(input, "model");
      const effort = oracleOption(input, "effort");
      const file = oracleAttachmentOption(input);
      const github = oracleBooleanOption(input, "github");
      const job = await requestOracleJob(request, "oracle.ask", {
        prompt,
        ...(model !== undefined ? { model } : {}),
        ...(effort !== undefined ? { effort } : {}),
        ...(file !== undefined ? { file } : {}),
        ...(github ? { github: true } : {}),
      });
      rememberJob(job.id);
      return piExternalJobHandle(job);
    },
    async status(id) {
      const job = await requestOracleJobStatus(request, id);
      emitTerminal({ id: job.id, state: job.state });
      return piExternalJobHandle(job);
    },
    result(id) {
      return requestOracleJob(request, "oracle.result", { id })
        .then((job) => {
          emitTerminal({ id: job.id, state: job.state });
          return piExternalJobResult(job);
        })
        .catch((error) => {
          emitFailedOracleJob(error, emitTerminal);
          throw error;
        });
    },
    reattach(id) {
      return requestOracleJobStatus(request, id)
        .then((job) => {
          rememberJob(job.id);
          emitTerminal({ id: job.id, state: job.state });
          return piExternalJobHandle(job);
        })
        .catch((error) => {
          emitFailedOracleJob(error, emitTerminal);
          throw error;
        });
    },
  };
  if (options.followUp) {
    provider.followUp = async (input) => {
      const prompt = typeof input.prompt === "string" ? input.prompt : "";
      if (!prompt.trim()) throw new Error("prompt required");
      const parentId = parentProviderJobId(input);
      const model = oracleOption(input, "model");
      const effort = oracleOption(input, "effort");
      const file = oracleAttachmentOption(input);
      const github = oracleBooleanOption(input, "github");
      const requestId = optionalString(input, "requestId");
      const job = await requestOracleJob(request, "oracle.ask", {
        prompt,
        follow: parentId,
        ...(model !== undefined ? { model } : {}),
        ...(effort !== undefined ? { effort } : {}),
        ...(file !== undefined ? { file } : {}),
        ...(github ? { github: true } : {}),
        ...(requestId !== undefined ? { requestId } : {}),
      });
      assertFollowJob(job, parentId);
      rememberJob(job.id);
      return piExternalJobHandle(job);
    };
  }
  return provider;
}

export function registerOptionalBackgroundProvider(sessionId: string, jobIds: Set<string>, listJobs: () => Array<{ id: string; state: string }>, register: RegisterBackgroundWorkProvider) {
  return register({
    name: "surf-oracle",
    wakeChannels: [ORACLE_FINISHED_CHANNEL],
    listActiveWork: () => listJobs()
      .filter((job) => jobIds.has(job.id) && ORACLE_ACTIVE_STATES.has(job.state))
      .map((job) => ({ id: job.id, sessionId })),
  });
}

export function registerOptionalExternalJobProvider(
  jobIds: Set<string>,
  register: RegisterExternalJobProvider,
  request: typeof requestSurf = requestSurf,
  rememberJob?: RememberOracleJob,
  emitTerminal?: EmitOracleJob,
) {
  const provider = createOracleExternalJobProvider(jobIds, request, rememberJob, emitTerminal, { followUp: true });
  try {
    return register(provider);
  } catch (error) {
    if (String(error instanceof Error ? error.message : error).includes("followUp")) {
      return register(createOracleExternalJobProvider(jobIds, request, rememberJob, emitTerminal));
    }
    throw error;
  }
}

export function rememberOracleJobForSession(jobIds: Set<string>, jobId: unknown, requestGeneration: number, currentGeneration: number, sessionActive: boolean): boolean {
  if (typeof jobId !== "string" || !sessionActive || requestGeneration !== currentGeneration) return false;
  jobIds.add(jobId);
  return true;
}

export function emitOracleFinished(pi: Pi, job: unknown): boolean {
  if (!job || typeof job !== "object" || Array.isArray(job)) return false;
  const { id, state } = job as { id?: unknown; state?: unknown };
  if (typeof id !== "string" || typeof state !== "string" || !ORACLE_TERMINAL_STATES.has(state)) return false;
  if (!pi.events) return false;
  pi.events.emit(ORACLE_FINISHED_CHANNEL, { id, state });
  return true;
}

function registerTool(pi: Pi, name: string, description: string, parameters: unknown, map: (args: Record<string, unknown>) => [string, Record<string, unknown>, number | undefined]) {
  pi.registerTool({
    name,
    label: name,
    description,
    parameters,
    async execute(_id: string, args: Record<string, unknown>) {
      try {
        const [tool, toolArgs, tabId] = map(args);
        return await requestSurf(tool, toolArgs, tabId);
      } catch (error) {
        return textResult(error instanceof Error ? error.message : String(error), true);
      }
    },
  });
}

export default function surfExtension(pi: Pi) {
  registerTool(pi, "surf_read", "Read the current Surf browser page. Read tools are safer for parallel scouts than browser actions.", Type.Object({
    tabId: Type.Optional(Type.Number()), filter: Type.Optional(Type.String()), depth: Type.Optional(Type.Number()), ref: Type.Optional(Type.String()), compact: Type.Optional(Type.Boolean()), maxBytes: Type.Optional(Type.Number()),
  }), (args) => ["page.read", { filter: args.filter, depth: args.depth, ref: args.ref, compact: args.compact, "max-bytes": args.maxBytes }, args.tabId as number | undefined]);
  registerTool(pi, "surf_screenshot", "Capture a bounded Surf browser screenshot.", Type.Object({
    tabId: Type.Optional(Type.Number()), output: Type.Optional(Type.String()), fullpage: Type.Optional(Type.Boolean()), annotate: Type.Optional(Type.Boolean()), maxSize: Type.Optional(Type.Number()),
  }), (args) => ["screenshot", { output: args.output, fullpage: args.fullpage, annotate: args.annotate, "max-size": args.maxSize }, args.tabId as number | undefined]);
  registerTool(pi, "surf_click", "Click a Surf browser element by ref, selector, or coordinates. This can interfere with other agents in the shared browser session.", Type.Object({
    tabId: Type.Optional(Type.Number()), ref: Type.Optional(Type.String()), selector: Type.Optional(Type.String()), x: Type.Optional(Type.Number()), y: Type.Optional(Type.Number()), button: Type.Optional(Type.String({ description: "left, right, or double" })),
  }), (args) => [args.button === "right" ? "right_click" : args.button === "double" ? "double_click" : "click", args, args.tabId as number | undefined]);
  registerTool(pi, "surf_type", "Type text in the Surf browser. This can interfere with other agents in the shared browser session.", Type.Object({
    tabId: Type.Optional(Type.Number()), text: Type.String(), ref: Type.Optional(Type.String()), selector: Type.Optional(Type.String()), clear: Type.Optional(Type.Boolean()), submit: Type.Optional(Type.Boolean()),
  }), (args) => ["type", args, args.tabId as number | undefined]);
  registerTool(pi, "surf_tool", "Run one existing Surf browser tool through the native host. Prefer the dedicated read, screenshot, click, and type tools when they fit.", Type.Object({
    tool: Type.String(), args: Type.Optional(Type.Record(Type.String(), Type.Unknown())), tabId: Type.Optional(Type.Number()),
  }), (args) => [args.tool as string, (args.args as Record<string, unknown>) ?? {}, args.tabId as number | undefined]);
  registerTool(pi, "surf_oracle_status", "Get the status of a Surf oracle job, or the newest job.", Type.Object({ id: Type.Optional(Type.String()) }), (args) => ["oracle.status", args, undefined]);
  pi.registerTool({
    name: "surf_oracle_result",
    label: "surf_oracle_result",
    description: "Capture the result of a Surf oracle job.",
    parameters: Type.Object({ id: Type.String(), timeout: Type.Optional(Type.Number()) }),
    async execute(_id: string, args: Record<string, unknown>) {
      try {
        const result = await requestSurf("oracle.result", args);
        const errorDetails = result.details as { jobId?: unknown } | undefined;
        if (result.isError) {
          if (typeof errorDetails?.jobId === "string") emitOracleFinished(pi, { id: errorDetails.jobId, state: "failed" });
        } else {
          emitOracleFinished(pi, result.details);
        }
        return result;
      } catch (error) {
        return textResult(error instanceof Error ? error.message : String(error), true);
      }
    },
  });

  const oracleJobIds = new Set<string>();
  let sessionGeneration = 0;
  let sessionActive = false;
  pi.registerTool({
    name: "surf_oracle_ask",
    label: "surf_oracle_ask",
    description: "Start a durable local Surf ChatGPT oracle job, optionally with one local file and GitHub context.",
    parameters: Type.Object({ prompt: Type.String(), model: Type.Optional(Type.String()), effort: Type.Optional(Type.String()), file: Type.Optional(Type.String()), github: Type.Optional(Type.Boolean()), follow: Type.Optional(Type.String()) }),
    async execute(_id: string, args: Record<string, unknown>) {
      const requestGeneration = sessionGeneration;
      try {
        const result = await requestSurf("oracle.ask", args);
        const job = result.details as { id?: string } | undefined;
        rememberOracleJobForSession(oracleJobIds, job?.id, requestGeneration, sessionGeneration, sessionActive);
        return result;
      } catch (error) {
        return textResult(error instanceof Error ? error.message : String(error), true);
      }
    },
  });

  let dispose: (() => void) | undefined;
  let disposeExternal: (() => void) | undefined;
  pi.on("session_start", (_event, ctx) => {
    sessionGeneration++;
    const generation = sessionGeneration;
    sessionActive = false;
    dispose?.();
    disposeExternal?.();
    dispose = undefined;
    disposeExternal = undefined;
    oracleJobIds.clear();

    const session = ctx as { sessionManager?: { getSessionId?: () => string }; sessionId?: string };
    const sessionId = session.sessionId ?? session.sessionManager?.getSessionId?.();
    if (!sessionId) return;
    try {
      const jobs = require("../native/oracle-jobs.cjs") as { listJobs(): Array<{ id: string; state: string }> };
      const rememberForGeneration = (jobId: string) => rememberOracleJobForSession(oracleJobIds, jobId, generation, sessionGeneration, sessionActive);
      const emitFinished = (job: Pick<OracleExternalJob, "id" | "state">) => emitOracleFinished(pi, job);
      dispose = registerOptionalBackgroundProvider(sessionId, oracleJobIds, jobs.listJobs, registerGlobalBackgroundProvider);
      disposeExternal = registerOptionalExternalJobProvider(oracleJobIds, registerGlobalExternalJobProvider, requestSurf, rememberForGeneration, emitFinished);
      sessionActive = true;
      void resolveBackgroundWorkRegister().then((register) => {
        try {
          if (register === registerGlobalBackgroundProvider || generation !== sessionGeneration) return;
          const nextDispose = registerOptionalBackgroundProvider(sessionId, oracleJobIds, jobs.listJobs, register);
          if (generation !== sessionGeneration) {
            nextDispose();
            return;
          }
          dispose?.();
          dispose = nextDispose;
        } catch {
          // Keep the already-registered fallback provider.
        }
      });
      void resolveExternalJobProviderRegister().then((register) => {
        try {
          if (register === registerGlobalExternalJobProvider || generation !== sessionGeneration) return;
          const nextDispose = registerOptionalExternalJobProvider(oracleJobIds, register, requestSurf, rememberForGeneration, emitFinished);
          if (generation !== sessionGeneration) {
            nextDispose();
            return;
          }
          disposeExternal?.();
          disposeExternal = nextDispose;
        } catch {
          // Keep the already-registered fallback provider.
        }
      });
    } catch {
      // The Pi bridge is optional. Browser tools work without pi-subagents.
    }
  });
  pi.on("session_shutdown", () => {
    sessionGeneration++;
    sessionActive = false;
    dispose?.();
    disposeExternal?.();
    dispose = undefined;
    disposeExternal = undefined;
    oracleJobIds.clear();
  });
}
