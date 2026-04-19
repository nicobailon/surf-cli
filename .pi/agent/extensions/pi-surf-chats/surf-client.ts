/**
 * surf-client.ts — Shell out to `surf chatgpt.chats` and parse results
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { ConversationItem, ConversationSummary, DetailRecord, ListResult, SurfChatsError } from "./types.ts";

// Formatter reuse: resolve relative to surf-cli repo root
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

let formatter: {
  normalizeConversationItems: (raw: unknown) => ConversationItem[];
  summarizeConversation: (conv: unknown, opts?: { messageLimit?: number }) => ConversationSummary;
  formatConversationMarkdown: (opts: { conversation: unknown; messageLimit?: number }) => string;
} | null = null;
let resolvedFormatterPath: string | null = null;

function getRepoRootFromExtension(): string {
  const extensionDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(extensionDir, "../../../..");
}

function resolveLocalCliPath(): string | null {
  const require = createRequire(import.meta.url);
  const repoRoot = getRepoRootFromExtension();
  const repoCli = path.join(repoRoot, "native/cli.cjs");
  if (fs.existsSync(repoCli)) return repoCli;

  try {
    return require.resolve("surf-cli/native/cli.cjs");
  } catch {
    return null;
  }
}

function loadFormatter(): typeof formatter {
  if (formatter) return formatter;
  const require = createRequire(import.meta.url);

  try {
    resolvedFormatterPath = require.resolve("surf-cli/native/chatgpt-chats-formatter.cjs");
    formatter = require(resolvedFormatterPath);
    return formatter;
  } catch {
    try {
      const repoRoot = getRepoRootFromExtension();
      const formatterPath = path.join(repoRoot, "native/chatgpt-chats-formatter.cjs");
      resolvedFormatterPath = formatterPath;
      formatter = require(formatterPath);
      return formatter;
    } catch {
      resolvedFormatterPath = null;
      return null;
    }
  }
}

/** Fallback normalization when formatter unavailable */
function fallbackNormalize(raw: unknown): ConversationItem[] {
  const source = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as Record<string, unknown>)?.items)
      ? (raw as Record<string, unknown>).items as unknown[]
      : [];

  return (source as Record<string, unknown>[])
    .filter(Boolean)
    .map((item) => ({
      id: String(item.id ?? item.conversation_id ?? ""),
      title: String(item.title || "(untitled)"),
      create_time: (item.create_time ?? item.createTime ?? null) as string | number | null,
      update_time: (item.update_time ?? item.updateTime ?? item.create_time ?? null) as string | number | null,
    }))
    .filter((item) => item.id);
}

const DEFAULT_TIMEOUT = 120_000; // 120s
const DEFAULT_CHATGPT_PROFILE = process.platform === "darwin" ? "dsebban883@gmail.com" : null;
const DEBUG_DIR = path.join(os.tmpdir(), "pi-surf-chats-debug");

// ── Disk cache for conversation details ──────────────────────────────────────
const DISK_CACHE_DIR = path.join(os.homedir(), ".surf", "cache", "chatgpt-md");

function diskCachePathFor(conversationId: string): { md: string; meta: string } {
  return {
    md: path.join(DISK_CACHE_DIR, `${conversationId}.md`),
    meta: path.join(DISK_CACHE_DIR, `${conversationId}.meta.json`),
  };
}

function readDiskCache(conversationId: string, knownUpdateTime?: string | number | null): DetailRecord | null {
  const paths = diskCachePathFor(conversationId);
  try {
    if (!fs.existsSync(paths.md) || !fs.existsSync(paths.meta)) return null;
    const meta = JSON.parse(fs.readFileSync(paths.meta, "utf8"));

    // Staleness check: if the list item's update_time is newer than cached, skip cache
    if (knownUpdateTime != null && meta.updateTime != null) {
      const cachedMs = typeof meta.updateTime === "number"
        ? (meta.updateTime > 1e12 ? meta.updateTime : meta.updateTime * 1000)
        : Date.parse(String(meta.updateTime)) || 0;
      const knownMs = typeof knownUpdateTime === "number"
        ? (knownUpdateTime > 1e12 ? knownUpdateTime : knownUpdateTime * 1000)
        : Date.parse(String(knownUpdateTime)) || 0;
      if (knownMs > cachedMs) return null; // conversation updated since cache
    }

    const markdown = fs.readFileSync(paths.md, "utf8");
    return {
      conversationId,
      summary: meta.summary,
      markdown,
      loadedAt: meta.loadedAt ?? Date.now(),
    };
  } catch {
    return null;
  }
}

function writeDiskCache(record: DetailRecord): void {
  try {
    fs.mkdirSync(DISK_CACHE_DIR, { recursive: true });
    const paths = diskCachePathFor(record.conversationId);
    // Atomic writes
    const tmpMd = paths.md + `.${process.pid}.tmp`;
    const tmpMeta = paths.meta + `.${process.pid}.tmp`;
    fs.writeFileSync(tmpMd, record.markdown, "utf8");
    fs.writeFileSync(tmpMeta, JSON.stringify({
      summary: record.summary,
      loadedAt: record.loadedAt,
      updateTime: record.updateTime ?? record.summary.create_time,
    }, null, 2), "utf8");
    fs.renameSync(tmpMd, paths.md);
    fs.renameSync(tmpMeta, paths.meta);
  } catch {
    // non-fatal — in-memory cache still works
  }
}

function deleteDiskCache(conversationId: string): void {
  const paths = diskCachePathFor(conversationId);
  try { fs.unlinkSync(paths.md); } catch {}
  try { fs.unlinkSync(paths.meta); } catch {}
}

function classifyError(code: number, stdout: string, stderr: string): SurfChatsError {
  const combined = `${stderr}\n${stdout}`.toLowerCase();

  if (combined.includes("command not found") || combined.includes("not found: surf") || combined.includes("enoent")) {
    return { code: "surf_missing", message: "surf CLI not found. Install: npm i -g surf-cli" };
  }
  if (combined.includes("login_required") || combined.includes("log in") || combined.includes("401")) {
    return { code: "auth", message: "ChatGPT login required. Run: surf chatgpt.chats --continue" };
  }
  if (combined.includes("timeout") || combined.includes("timed out")) {
    return { code: "timeout", message: "Request timed out" };
  }
  if (combined.includes("cloakbrowser not installed") || combined.includes("npm install -g cloakbrowser")) {
    return { code: "setup", message: "CloakBrowser not installed. Run: npm install -g cloakbrowser" };
  }
  if (combined.includes("processsingleton") || combined.includes("profile directory") || combined.includes("singletonlock")) {
    return { code: "setup", message: "CloakBrowser profile locked. Close other surf instances or remove ~/.surf/cloak-profile/SingletonLock" };
  }
  if (combined.includes("worker exited") && combined.includes("without result")) {
    return { code: "crash", message: "CloakBrowser worker crashed. Retry or check ~/.surf/sessions/ for details" };
  }
  if (combined.includes("unknown tool: chatgpt.chats")) {
    return { code: "setup", message: "Installed surf CLI is too old for chatgpt.chats. Upgrade/reinstall surf-cli." };
  }
  if (combined.includes("requires cloakbrowser mode")) {
    return { code: "setup", message: "Cloak mode required. Set SURF_USE_CLOAK_CHATGPT=1" };
  }

  return { code: "command_failed", message: `surf exited with code ${code}`, stderr: stderr.slice(0, 500) };
}

function compactSnippet(text: string, max = 240): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "(empty)";
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max - 1)}…`;
}

function extractJsonCandidate(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;

  const starts = [trimmed.indexOf("{"), trimmed.indexOf("[")].filter((idx) => idx >= 0).sort((a, b) => a - b);
  for (const start of starts) {
    const chunk = trimmed.slice(start);
    const endObject = chunk.lastIndexOf("}");
    const endArray = chunk.lastIndexOf("]");
    const end = Math.max(endObject, endArray);
    if (end >= 0) return chunk.slice(0, end + 1).trim();
  }
  return null;
}

function tryParseJsonOutput(stdout: string, stderr: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  const candidates = [stdout, `${stdout}\n${stderr}`, stderr]
    .map((text) => extractJsonCandidate(text))
    .filter((text): text is string => !!text);

  let lastError = "No JSON candidate found";
  for (const candidate of candidates) {
    try {
      return { ok: true, value: JSON.parse(candidate) };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return { ok: false, reason: lastError };
}

function writeDebugDump(kind: string, stdout: string, stderr: string): string | null {
  try {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const base = path.join(DEBUG_DIR, `${kind}-${stamp}`);
    fs.writeFileSync(`${base}.stdout.log`, stdout, "utf8");
    fs.writeFileSync(`${base}.stderr.log`, stderr, "utf8");
    return base;
  } catch {
    return null;
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildParseError(kind: string, stdout: string, stderr: string, reason: string): SurfChatsError {
  const dumpBase = writeDebugDump(kind, stdout, stderr);
  const debugHint = dumpBase ? ` Debug: ${dumpBase}.{stdout,stderr}.log` : "";
  return {
    code: "parse",
    message: `Failed to parse surf output as JSON.${debugHint}`,
    stderr: [
      `parse: ${reason}`,
      `stdout: ${compactSnippet(stdout)}`,
      `stderr: ${compactSnippet(stderr)}`,
    ].join("\n"),
  };
}

export class SurfChatsClient {
  private execFn: ExtensionAPI["exec"];
  private cliPath: string | null;
  private profile: string | null;

  constructor(pi: ExtensionAPI, _cwd: string) {
    this.execFn = pi.exec.bind(pi);
    this.cliPath = resolveLocalCliPath();
    this.profile = DEFAULT_CHATGPT_PROFILE;
    loadFormatter();
  }

  private withProfile(args: string[]): string[] {
    return this.profile ? [...args, "--profile", this.profile] : args;
  }

  private async runSurf(args: string[], signal?: AbortSignal): Promise<{ stdout: string; stderr: string }> {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const stdoutPath = path.join(DEBUG_DIR, `${stamp}.stdout.tmp`);
    const stderrPath = path.join(DEBUG_DIR, `${stamp}.stderr.tmp`);

    const commandParts = this.cliPath
      ? ["node", this.cliPath, ...this.withProfile(args)]
      : ["surf", ...this.withProfile(args)];
    const script = `export SURF_USE_CLOAK_CHATGPT=1; ${commandParts.map(shellQuote).join(" ")} > ${shellQuote(stdoutPath)} 2> ${shellQuote(stderrPath)}`;

    try {
      const result = await this.execFn("bash", ["-lc", script], {
        timeout: DEFAULT_TIMEOUT,
        signal,
      });
      const stdout = fs.existsSync(stdoutPath) ? fs.readFileSync(stdoutPath, "utf8") : (result.stdout ?? "");
      const stderr = fs.existsSync(stderrPath) ? fs.readFileSync(stderrPath, "utf8") : (result.stderr ?? "");

      if (signal?.aborted || result.killed) {
        throw { code: "aborted", message: "Request cancelled" } as SurfChatsError;
      }
      if (result.code !== 0) throw classifyError(result.code, stdout, stderr);
      return { stdout, stderr };
    } finally {
      try {
        if (fs.existsSync(stdoutPath)) fs.unlinkSync(stdoutPath);
        if (fs.existsSync(stderrPath)) fs.unlinkSync(stderrPath);
      } catch {
        // ignore temp cleanup failure
      }
    }
  }

  private async runSurfJson(args: string[], kind: string, signal?: AbortSignal): Promise<{ parsed: unknown; stdout: string; stderr: string; attempts: number }> {
    let lastStdout = "";
    let lastStderr = "";
    let lastReason = "No JSON candidate found";

    for (let attempt = 1; attempt <= 2; attempt++) {
      const { stdout, stderr } = await this.runSurf(args, signal);
      lastStdout = stdout;
      lastStderr = stderr;

      const parsed = tryParseJsonOutput(stdout, stderr);
      if (parsed.ok) {
        return { parsed: parsed.value, stdout, stderr, attempts: attempt };
      }

      lastReason = parsed.reason;
      if (signal?.aborted || attempt === 2) break;
    }

    throw buildParseError(kind, lastStdout, lastStderr, lastReason);
  }

  getResolvedPaths(): { cliPath: string | null; formatterPath: string | null; profile: string | null } {
    return {
      cliPath: this.cliPath,
      formatterPath: resolvedFormatterPath,
      profile: this.profile,
    };
  }

  async listRecent(opts?: { limit?: number; signal?: AbortSignal }): Promise<ListResult> {
    const limit = opts?.limit ?? 30;
    const { parsed } = await this.runSurfJson(["chatgpt.chats", "--json", "--limit", String(limit)], "list", opts?.signal);
    return this.parseListResult(parsed);
  }

  async search(opts: { query: string; limit?: number; signal?: AbortSignal }): Promise<ListResult> {
    const limit = opts.limit ?? 30;
    const { parsed } = await this.runSurfJson(["chatgpt.chats", "--json", "--search", opts.query, "--limit", String(limit)], "search", opts.signal);
    return this.parseListResult(parsed, "search");
  }

  async getConversation(conversationId: string, signal?: AbortSignal, knownUpdateTime?: string | number | null): Promise<DetailRecord> {
    // 1. Check disk cache first (instant) — skipped if conversation updated since cache
    const diskCached = readDiskCache(conversationId, knownUpdateTime);
    if (diskCached) {
      diskCached.loadedAt = Date.now();
      return diskCached;
    }

    // 2. Fetch from network
    const { parsed } = await this.runSurfJson(["chatgpt.chats", conversationId, "--json"], `get-${conversationId}`, signal);
    const detail = this.parseGetResult(conversationId, parsed);

    if (!formatter && !signal?.aborted) {
      const tempPath = path.join(os.tmpdir(), `pi-surf-chat-${conversationId}-${Date.now()}.md`);
      try {
        await this.exportConversation(conversationId, tempPath, signal);
        detail.markdown = fs.readFileSync(tempPath, "utf8");
      } catch {
        // keep synthetic fallback markdown
      } finally {
        try {
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        } catch {
          // ignore temp cleanup failure
        }
      }
    }

    // 3. Write to disk cache for next time
    writeDiskCache(detail);

    return detail;
  }

  async exportConversation(conversationId: string, exportPath: string, signal?: AbortSignal): Promise<string> {
    await this.runSurf(["chatgpt.chats", conversationId, "--export", exportPath, "--format", "markdown"], signal);
    return exportPath;
  }

  async deleteConversation(conversationId: string, signal?: AbortSignal): Promise<void> {
    await this.runSurfJson(["chatgpt.chats", conversationId, "--delete", "--json"], `delete-${conversationId}`, signal);
    deleteDiskCache(conversationId);
  }

  async bulkDeleteConversations(conversationIds: string[], signal?: AbortSignal): Promise<void> {
    if (conversationIds.length === 0) return;
    if (conversationIds.length === 1) return this.deleteConversation(conversationIds[0]!, signal);
    await this.runSurfJson(
      ["chatgpt.chats", "--delete-ids", conversationIds.join(","), "--json"],
      `bulk-delete-${conversationIds.length}`,
      signal,
    );
    for (const id of conversationIds) deleteDiskCache(id);
  }

  private parseListResult(parsed: unknown, action: "list" | "search" = "list"): ListResult {
    const record = typeof parsed === "object" && parsed ? parsed as Record<string, unknown> : {};

    const items = formatter
      ? formatter.normalizeConversationItems(record.items ?? record)
      : fallbackNormalize(record.items ?? record);

    return {
      action,
      items,
      total: typeof record.total === "number" ? record.total : items.length,
      partial: record.partial === true,
      fallbackScanned: typeof record.fallbackScanned === "number" ? record.fallbackScanned : undefined,
      fallbackTotal: typeof record.fallbackTotal === "number" ? record.fallbackTotal : undefined,
    };
  }

  private parseGetResult(conversationId: string, parsed: unknown): DetailRecord {
    const conversation = typeof parsed === "object" && parsed ? parsed as Record<string, unknown> : {};

    let summary: ConversationSummary;
    let markdown: string;

    if (formatter) {
      summary = formatter.summarizeConversation(conversation);
      markdown = formatter.formatConversationMarkdown({ conversation });
    } else {
      summary = {
        title: String(conversation.title || "(untitled)"),
        create_time: (conversation.create_time as number) ?? null,
        current_node: (conversation.current_node as string) ?? null,
        messages: [],
        totalMessages: typeof conversation.mapping === "object" && conversation.mapping ? Object.keys(conversation.mapping as Record<string, unknown>).length : 0,
        model: null,
      };
      markdown = `# ${summary.title}\n\n_Formatter unavailable. Showing exported markdown fallback when possible._\n`;
    }

    return {
      conversationId,
      summary,
      markdown,
      loadedAt: Date.now(),
      updateTime: (conversation.update_time as string | number) ?? (conversation.create_time as string | number) ?? null,
    };
  }
}
