/**
 * pi-surf-chats — Pi extension for browsing ChatGPT conversations via surf-cli
 *
 * Architecture: lane-based operation model
 *   LIST lane   — load_list / search / load_more (mutually exclusive, last wins)
 *   BACKGROUND  — detail / export / delete runners (independent FIFO queues)
 *   SYNC        — toggle_mark / inject / delete prompt / cancel_delete (immediate)
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Key } from "@mariozechner/pi-tui";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { SurfChatsClient } from "./surf-client.ts";
import { SurfChatsOverlay, type OverlayAction } from "./overlay.ts";
import type {
  ControllerState, DeleteRequest, DetailRecord, ListCacheEntry,
  StatusBarState, SurfChatsError,
} from "./types.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Module-level persistent cache (survives overlay close/reopen within pi session)
// ─────────────────────────────────────────────────────────────────────────────

const persistentDetailCache = new Map<string, DetailRecord>();
let persistentListCache: ListCacheEntry | null = null;

const LIST_CACHE_TTL_MS = 5 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Export path helpers
// ─────────────────────────────────────────────────────────────────────────────

function slugify(text: string, maxLen = 48): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen) || "chatgpt-chat";
}

function buildExportPath(title: string, conversationId: string): string {
  const dir = path.join(os.homedir(), "Downloads", "surf-chatgpt");
  fs.mkdirSync(dir, { recursive: true });

  const now = new Date();
  const ts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");

  const slug = slugify(title);
  const shortId = conversationId.slice(0, 8);
  let candidate = path.join(dir, `${ts}-${slug}-${shortId}.md`);

  let i = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${ts}-${slug}-${shortId}-${i}.md`);
    i++;
  }
  return candidate;
}

// ─────────────────────────────────────────────────────────────────────────────
// State factory
// ─────────────────────────────────────────────────────────────────────────────

const INITIAL_LIMIT = 30;
const PAGE_SIZE = 30;

function createInitialState(): ControllerState {
  const cachedItems = persistentListCache?.mode === "recent" ? persistentListCache.items : [];
  const hasCache = cachedItems.length > 0;

  return {
    mode: "recent",
    searchDraft: "",
    activeQuery: "",
    items: cachedItems,
    selectedIndex: 0,
    searchEditActive: false,
    currentLimit: INITIAL_LIMIT,
    hasMore: cachedItems.length >= INITIAL_LIMIT,

    detailCache: persistentDetailCache,
    loadedConversationId: null,

    markedIds: new Set(),
    deletePrompt: null,
    statusBar: null,

    listLane: {
      activeAction: hasCache ? null : "load_list",
      isRunning: !hasCache,
      progressMessage: hasCache ? null : "Loading recent conversations…",
      error: null,
      infoMessage: null,
    },
    detailLane: {
      activeConversationId: null,
      queuedConversationIds: [],
      errorsByConversationId: new Map(),
    },
    exportLane: {
      activeConversationId: null,
      queuedConversationIds: [],
      error: null,
      lastExportPath: null,
    },
    deleteLane: {
      activeRequest: null,
      queuedRequests: [],
      error: null,
    },

    resolvedCliPath: null,
    resolvedFormatterPath: null,
    resolvedProfile: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Derived status bar
// ─────────────────────────────────────────────────────────────────────────────

function recomputeStatusBar(state: ControllerState): void {
  const segments: string[] = [];

  // 1. Active work
  if (state.listLane.isRunning && state.listLane.progressMessage) {
    segments.push(state.listLane.progressMessage);
  }
  const sel = state.items[state.selectedIndex];
  if (sel && state.detailLane.activeConversationId === sel.id) {
    segments.push("Loading conversation…");
  } else if (sel && state.detailLane.queuedConversationIds.includes(sel.id)) {
    segments.push("Queued…");
  }
  if (state.exportLane.activeConversationId) {
    segments.push("Exporting…");
  }
  if (state.deleteLane.activeRequest) {
    const n = state.deleteLane.activeRequest.conversationIds.length;
    const q = state.deleteLane.queuedRequests.length;
    const label = n > 1 ? `Deleting ${n} conversations…` : `Deleting "${state.deleteLane.activeRequest.titles[0]}"…`;
    segments.push(q > 0 ? `${label} (+${q} queued)` : label);
  }

  if (segments.length > 0) {
    state.statusBar = { level: "progress", message: segments.join(" • ") };
    return;
  }

  // 2. Errors
  const errors: SurfChatsError[] = [];
  if (state.listLane.error) errors.push(state.listLane.error);
  if (sel) {
    const detErr = state.detailLane.errorsByConversationId.get(sel.id);
    if (detErr) errors.push(detErr);
  }
  if (state.exportLane.error) errors.push(state.exportLane.error);
  if (state.deleteLane.error) errors.push(state.deleteLane.error);

  if (errors.length > 0) {
    state.statusBar = { level: "error", message: errors.map(e => e.message).join(" • ") };
    return;
  }

  // 3. Informational
  if (state.listLane.infoMessage) {
    state.statusBar = { level: "info", message: state.listLane.infoMessage };
    return;
  }

  state.statusBar = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Extension
// ─────────────────────────────────────────────────────────────────────────────

export default function piSurfChatsExtension(pi: ExtensionAPI): void {

  async function openOverlay(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI) return;

    const client = new SurfChatsClient(pi, ctx.cwd);
    const state = createInitialState();
    const resolved = client.getResolvedPaths();
    state.resolvedCliPath = resolved.cliPath;
    state.resolvedFormatterPath = resolved.formatterPath;
    state.resolvedProfile = resolved.profile;

    let overlay: SurfChatsOverlay | null = null;
    let closed = false;

    // ─── LIST lane ────────────────────────────────────────────────────
    let listAbort: AbortController | null = null;
    let listGeneration = 0;

    async function runListAction(
      kind: "load_list" | "search" | "load_more",
      setup: () => void,
      run: (signal: AbortSignal) => Promise<void>,
    ): Promise<void> {
      listAbort?.abort();
      const abort = new AbortController();
      listAbort = abort;
      const gen = ++listGeneration;

      setup();
      recomputeStatusBar(state);
      overlay?.updateState(state);

      try {
        await run(abort.signal);
      } catch (err) {
        if (closed || gen !== listGeneration || abort.signal.aborted) return;
        throw err;
      }
      // stale check
      if (closed || gen !== listGeneration || abort.signal.aborted) return;
    }

    // ─── BACKGROUND queued runner factory ─────────────────────────────

    type QueueRunner<T> = {
      enqueue: (item: T) => void;
      abort: () => void;
      clear: () => void;
    };

    function createQueueRunner<T>(
      process: (item: T, signal: AbortSignal) => Promise<void>,
    ): QueueRunner<T> {
      const pending: T[] = [];
      let running = false;
      let activeAbort: AbortController | null = null;

      async function drain(): Promise<void> {
        if (running || closed) return;
        running = true;
        while (pending.length > 0 && !closed) {
          const item = pending.shift()!;
          const abort = new AbortController();
          activeAbort = abort;
          try {
            await process(item, abort.signal);
          } catch {
            // errors handled inside process()
          }
          activeAbort = null;
        }
        running = false;
        if (!closed) {
          recomputeStatusBar(state);
          overlay?.updateState(state);
        }
      }

      return {
        enqueue(item: T) {
          pending.push(item);
          drain().catch(() => {});
        },
        abort() {
          activeAbort?.abort();
          activeAbort = null;
        },
        clear() {
          pending.length = 0;
          activeAbort?.abort();
          activeAbort = null;
        },
      };
    }

    // ─── Detail runner ────────────────────────────────────────────────

    const detailRunner = createQueueRunner<{ conversationId: string; updateTime?: string | number | null }>(
      async (item, signal) => {
        const { conversationId } = item;
        // Remove from queued tracking
        const qi = state.detailLane.queuedConversationIds.indexOf(conversationId);
        if (qi !== -1) state.detailLane.queuedConversationIds.splice(qi, 1);

        // dedupe: already cached or already active
        if (state.detailCache.has(conversationId)) return;
        if (state.detailLane.activeConversationId === conversationId) return;

        state.detailLane.activeConversationId = conversationId;
        state.detailLane.errorsByConversationId.delete(conversationId);
        state.loadedConversationId = conversationId;
        recomputeStatusBar(state);
        overlay?.updateState(state);

        try {
          const detail = await client.getConversation(conversationId, signal, item.updateTime);
          if (closed) return;
          state.detailCache.set(conversationId, detail);
        } catch (err) {
          if (closed || signal.aborted) return;
          state.detailLane.errorsByConversationId.set(conversationId, {
            code: (err as SurfChatsError).code ?? "command_failed",
            message: (err as SurfChatsError).message ?? "Failed to load conversation",
          });
        } finally {
          if (state.detailLane.activeConversationId === conversationId) {
            state.detailLane.activeConversationId = null;
          }
          if (!closed) {
            recomputeStatusBar(state);
            overlay?.updateState(state);
          }
        }
      },
    );

    // ─── Export runner ─────────────────────────────────────────────────

    const exportRunner = createQueueRunner<{ conversationId: string; title: string }>(
      async (item, signal) => {
        const { conversationId, title } = item;
        // dedupe
        if (state.exportLane.activeConversationId === conversationId) return;
        if (state.exportLane.queuedConversationIds.includes(conversationId)) return;

        // Remove from queued tracking
        const eqi = state.exportLane.queuedConversationIds.indexOf(conversationId);
        if (eqi !== -1) state.exportLane.queuedConversationIds.splice(eqi, 1);

        state.exportLane.activeConversationId = conversationId;
        state.exportLane.error = null;
        state.exportLane.lastExportPath = null;
        recomputeStatusBar(state);
        overlay?.updateState(state);

        try {
          const cached = state.detailCache.get(conversationId);
          const exportPath = buildExportPath(title, conversationId);

          if (cached) {
            fs.writeFileSync(exportPath, cached.markdown, "utf8");
            state.exportLane.lastExportPath = exportPath;
          } else {
            const result = await client.exportConversation(conversationId, exportPath, signal);
            if (closed) return;
            state.exportLane.lastExportPath = result;
          }
        } catch (err) {
          if (closed || signal.aborted) return;
          state.exportLane.error = {
            code: (err as SurfChatsError).code ?? "command_failed",
            message: (err as SurfChatsError).message ?? "Export failed",
          };
        } finally {
          if (state.exportLane.activeConversationId === conversationId) {
            state.exportLane.activeConversationId = null;
          }
          if (!closed) {
            recomputeStatusBar(state);
            overlay?.updateState(state);
          }
        }
      },
    );

    // ─── Delete runner ────────────────────────────────────────────────

    const deleteRunner = createQueueRunner<DeleteRequest>(
      async (request, signal) => {
        // Remove from queued tracking
        const dqi = state.deleteLane.queuedRequests.indexOf(request);
        if (dqi !== -1) state.deleteLane.queuedRequests.splice(dqi, 1);

        // Filter out ids already removed by earlier deletes
        const liveIds = request.conversationIds.filter(id =>
          state.items.some(it => it.id === id),
        );
        if (liveIds.length === 0) return;

        const titles = liveIds.map(id => {
          const idx = request.conversationIds.indexOf(id);
          return request.titles[idx] ?? "(untitled)";
        });

        state.deleteLane.activeRequest = { conversationIds: liveIds, titles };
        state.deleteLane.error = null;
        recomputeStatusBar(state);
        overlay?.updateState(state);

        try {
          await client.bulkDeleteConversations(liveIds, signal);
          if (closed) return;

          const deleteSet = new Set(liveIds);
          state.items = state.items.filter(it => !deleteSet.has(it.id));
          for (const id of liveIds) {
            state.detailCache.delete(id);
            state.markedIds.delete(id);
            state.detailLane.errorsByConversationId.delete(id);
          }
          if (persistentListCache) {
            persistentListCache.items = persistentListCache.items.filter(it => !deleteSet.has(it.id));
          }
          if (state.selectedIndex >= state.items.length) {
            state.selectedIndex = Math.max(0, state.items.length - 1);
          }

          if (ctx.hasUI) {
            const label = liveIds.length > 1
              ? `${liveIds.length} conversations`
              : titles[0] ?? "conversation";
            ctx.ui.notify(`Deleted: ${label}`, "info");
          }
        } catch (err) {
          if (closed || signal.aborted) return;
          state.deleteLane.error = {
            code: (err as SurfChatsError).code ?? "command_failed",
            message: (err as SurfChatsError).message ?? "Delete failed",
          };
          if (ctx.hasUI) {
            ctx.ui.notify(`Delete failed: ${(err as SurfChatsError).message ?? "unknown error"}`, "error");
          }
        } finally {
          state.deleteLane.activeRequest = null;
          if (!closed) {
            recomputeStatusBar(state);
            overlay?.updateState(state);
          }
        }
      },
    );

    // ─── Action handler ───────────────────────────────────────────────

    async function handleAction(action: OverlayAction, done: (result?: string) => void): Promise<void> {
      if (closed) return;

      switch (action.action) {

        // ── LIST lane (mutually exclusive, last wins) ──

        case "load_list": {
          const hasCachedItems = state.items.length > 0;
          const cacheAge = persistentListCache ? Date.now() - persistentListCache.loadedAt : Infinity;
          const silentRefresh = hasCachedItems && cacheAge < LIST_CACHE_TTL_MS;

          try {
            await runListAction("load_list", () => {
              state.listLane.activeAction = "load_list";
              state.listLane.isRunning = true;
              state.listLane.progressMessage = silentRefresh ? null : "Loading recent conversations…";
              state.listLane.error = null;
              state.listLane.infoMessage = null;
              state.searchEditActive = false;
              state.mode = "recent";
              state.activeQuery = "";
              state.currentLimit = INITIAL_LIMIT;
            }, async (signal) => {
              const result = await client.listRecent({ limit: INITIAL_LIMIT, signal });
              state.items = result.items;
              state.selectedIndex = 0;
              state.hasMore = result.items.length >= INITIAL_LIMIT;
              persistentListCache = { mode: "recent", query: "", items: result.items, loadedAt: Date.now() };
            });
          } catch (err) {
            if (closed) return;
            if (hasCachedItems) {
              // Keep visible items on silent-refresh failure
            } else {
              state.listLane.error = err as SurfChatsError;
            }
          } finally {
            if (!closed) {
              state.listLane.isRunning = false;
              state.listLane.activeAction = null;
              state.listLane.progressMessage = null;
              recomputeStatusBar(state);
              overlay?.updateState(state);
            }
          }
          break;
        }

        case "search": {
          try {
            await runListAction("search", () => {
              state.listLane.activeAction = "search";
              state.listLane.isRunning = true;
              state.listLane.progressMessage = `Searching "${action.query}"…`;
              state.listLane.error = null;
              state.listLane.infoMessage = null;
              state.searchEditActive = false;
              state.mode = "search";
              state.activeQuery = action.query;
              state.currentLimit = INITIAL_LIMIT;
            }, async (signal) => {
              const result = await client.search({ query: action.query, limit: INITIAL_LIMIT, signal });
              state.items = result.items;
              state.selectedIndex = 0;
              state.hasMore = result.items.length >= INITIAL_LIMIT;
              state.listLane.infoMessage = result.partial
                ? `Partial results (${result.fallbackScanned}/${result.fallbackTotal} scanned)`
                : null;
            });
          } catch (err) {
            if (closed) return;
            state.listLane.error = err as SurfChatsError;
          } finally {
            if (!closed) {
              state.listLane.isRunning = false;
              state.listLane.activeAction = null;
              state.listLane.progressMessage = null;
              recomputeStatusBar(state);
              overlay?.updateState(state);
            }
          }
          break;
        }

        case "load_more": {
          if (state.mode === "search") break;
          const prevItems = state.items;
          const newLimit = state.currentLimit + PAGE_SIZE;

          try {
            await runListAction("load_more", () => {
              state.listLane.activeAction = "load_more";
              state.listLane.isRunning = true;
              state.listLane.progressMessage = `Loading more… (${newLimit} total)`;
              state.listLane.error = null;
            }, async (signal) => {
              const result = await client.listRecent({ limit: newLimit, signal });
              const prevLen = prevItems.length;
              state.items = result.items;
              state.currentLimit = newLimit;
              state.hasMore = result.items.length >= newLimit;
              if (result.items.length > prevLen) {
                state.selectedIndex = prevLen;
              }
              persistentListCache = { mode: "recent", query: "", items: result.items, loadedAt: Date.now() };
            });
          } catch (err) {
            if (closed) return;
            state.items = prevItems;
            state.listLane.error = err as SurfChatsError;
          } finally {
            if (!closed) {
              state.listLane.isRunning = false;
              state.listLane.activeAction = null;
              state.listLane.progressMessage = null;
              recomputeStatusBar(state);
              overlay?.updateState(state);
            }
          }
          break;
        }

        // ── BACKGROUND: detail ──

        case "load_detail": {
          // Dedupe
          const id = action.conversationId;
          if (state.detailCache.has(id)) break;
          if (state.detailLane.activeConversationId === id) break;
          if (state.detailLane.queuedConversationIds.includes(id)) break;

          state.detailLane.queuedConversationIds.push(id);
          state.loadedConversationId = id;
          recomputeStatusBar(state);
          overlay?.updateState(state);
          const listItem = state.items.find(it => it.id === id);
          detailRunner.enqueue({ conversationId: id, updateTime: listItem?.update_time });
          break;
        }

        // ── BACKGROUND: export ──

        case "export": {
          const id = action.conversationId;
          if (state.exportLane.activeConversationId === id) break;
          if (state.exportLane.queuedConversationIds.includes(id)) break;

          state.exportLane.queuedConversationIds.push(id);
          recomputeStatusBar(state);
          overlay?.updateState(state);
          exportRunner.enqueue({ conversationId: id, title: action.title });
          break;
        }

        // ── SYNC: toggle mark ──

        case "toggle_mark": {
          if (state.markedIds.has(action.conversationId)) {
            state.markedIds.delete(action.conversationId);
          } else {
            state.markedIds.add(action.conversationId);
          }
          overlay?.updateState(state);
          break;
        }

        // ── SYNC: delete prompt ──

        case "delete": {
          state.deletePrompt = {
            conversationIds: action.conversationIds,
            titles: action.titles,
          };
          recomputeStatusBar(state);
          overlay?.updateState(state);
          break;
        }

        case "cancel_delete": {
          state.deletePrompt = null;
          recomputeStatusBar(state);
          overlay?.updateState(state);
          break;
        }

        // ── SYNC→BACKGROUND: confirm delete ──

        case "confirm_delete": {
          const request: DeleteRequest = {
            conversationIds: action.conversationIds,
            titles: action.titles,
          };
          state.deletePrompt = null;
          state.deleteLane.queuedRequests.push(request);
          recomputeStatusBar(state);
          overlay?.updateState(state);
          deleteRunner.enqueue(request);
          break;
        }

        // ── SYNC: inject ──

        case "inject": {
          const content = [
            `Imported ChatGPT conversation via surf-cli.`,
            "",
            `**Conversation ID:** ${action.conversationId}`,
            `**Title:** ${action.title}`,
            "",
            action.markdown,
          ].join("\n");

          pi.sendMessage({
            customType: "surf-chatgpt-import",
            content,
            display: true,
          }, { triggerTurn: false });

          if (ctx.hasUI) {
            ctx.ui.notify(`Injected: ${action.title}`, "info");
          }

          closeOverlay();
          done("injected");
          break;
        }
      }
    }

    // ─── Lifecycle ────────────────────────────────────────────────────

    function closeOverlay(): void {
      closed = true;
      listAbort?.abort();
      listAbort = null;
      detailRunner.clear();
      exportRunner.clear();
      deleteRunner.clear();
      overlay = null;
    }

    // ─── Open overlay ─────────────────────────────────────────────────

    await ctx.ui.custom<string | undefined>(
      (tui, theme, _keybindings, done) => {
        const handleError = (err: unknown) => {
          if (closed) return;
          state.listLane.error = {
            code: "command_failed",
            message: String((err as Error)?.message ?? err),
          };
          recomputeStatusBar(state);
          overlay?.updateState(state);
        };

        overlay = new SurfChatsOverlay({
          tui,
          theme,
          state,
          done,
          callbacks: {
            onAction: (action) => {
              handleAction(action, done).catch(handleError);
            },
            onClose: () => {
              closeOverlay();
            },
          },
        });

        // Trigger initial list load
        handleAction({ action: "load_list" }, done).catch(handleError);

        return overlay;
      },
      {
        overlay: true,
        overlayOptions: {
          width: "90%",
          maxHeight: "70%",
          anchor: "center",
          margin: 1,
        },
      },
    );
  }

  // ─── Registration ───────────────────────────────────────────────────────

  pi.registerCommand("surf-chats", {
    description: "Browse and search ChatGPT conversations via surf-cli",
    handler: async (_args, ctx) => {
      await openOverlay(ctx);
    },
  });

  pi.registerShortcut(Key.ctrlShift("g"), {
    description: "Open ChatGPT conversation browser (surf-chats)",
    handler: async (ctx) => {
      await openOverlay(ctx);
    },
  });
}
