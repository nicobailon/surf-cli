/**
 * surf-cli session reconciler
 *
 * Detects orphaned / stale sessions whose worker died without calling
 * session.finish() or session.fail(), and optionally polls the ChatGPT API
 * to recover completed conversations.
 *
 * Public API:
 *   defaultPidIsAlive(pid)           — liveness check for a stored pid
 *   isChatGptCloakSession(meta)      — true when session used cloak
 *   resolveConversationId(meta)      — extract conversationId from meta/args
 *   inspectConversation(conv, meta)  — determine outcome from GET response
 *   reconcileSessions(opts)          — main reconcile pass (local + optional network)
 */

"use strict";

const { listSessions, updateSession, appendSessionLog, persistSessionResponse } = require("./session-store.cjs");
const { classifyConversationProgress, extractCompletedAssistantPayload } = require("./chatgpt-conversation-state.cjs");
const { resolveAssistantWaitSeconds } = require("./chatgpt-cloak-timeout.cjs");

// ============================================================================
// Constants
// ============================================================================

/** Sessions still "running" beyond this age are considered orphaned. */
const MAX_RUNNING_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours

// ============================================================================
// Helpers
// ============================================================================

/**
 * Check whether a PID is still alive using signal 0.
 * Returns false for invalid / missing PIDs.
 */
function defaultPidIsAlive(pid) {
  if (!pid || typeof pid !== "number" || !Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** True when the session was run via CloakBrowser. ChatGPT is always Cloak in headless-only mode. */
function isChatGptCloakSession(meta) {
  return meta.tool === "chatgpt" || meta.tool === "chatgpt.reply";
}

/** Pull the ChatGPT conversation ID out of wherever it may be stored. */
function resolveConversationId(meta) {
  return (
    meta.conversationId ||
    (meta.args && meta.args.conversationId) ||
    null
  );
}

function hasSentCheckpoint(meta) {
  const hasCheckpointFields =
    meta &&
    (Object.prototype.hasOwnProperty.call(meta, "lastCheckpoint") ||
      Object.prototype.hasOwnProperty.call(meta, "sentAt"));

  if (!hasCheckpointFields) {
    return true;
  }

  return (
    meta.lastCheckpoint === "sent" ||
    (meta.lastCheckpoint === "send_attempted" && !!resolveConversationId(meta)) ||
    (typeof meta.sentAt === "string" && meta.sentAt.trim() !== "")
  );
}

// ============================================================================
// inspectConversation
// ============================================================================

/**
 * Analyse a GET /backend-api/conversation/{id} response to determine whether
 * the conversation completed, is still in progress, or is ambiguous.
 *
 * @param {object}  conversation  Raw conversation object from the API.
 * @param {object}  meta          Session meta (for baseline comparison).
 * @returns {{ outcome: string, nodeId: string|null }}
 *   outcome: 'completed' | 'no_new_assistant' | 'in_progress' | 'ambiguous'
 */
function inspectConversation(conversation, meta = {}) {
  const classified = classifyConversationProgress(conversation, {
    baselineAssistantMessageId: meta.baselineAssistantMessageId || null,
  });
  switch (classified.state) {
    case "assistant_complete":
      return { outcome: "completed", nodeId: classified.nodeId || null };
    case "assistant_complete_baseline":
      return { outcome: "no_new_assistant", nodeId: classified.nodeId || null };
    case "assistant_in_progress":
    case "awaiting_assistant":
      return { outcome: "in_progress", nodeId: classified.nodeId || null };
    default:
      return { outcome: "ambiguous", nodeId: classified.nodeId || null };
  }
}

// ============================================================================
// reconcileSessions
// ============================================================================

/**
 * Main reconcile pass.
 *
 * Local-only (fast, no network):
 *   - Checks stored pid liveness
 *   - Marks orphaned sessions as status "error" with code "session_orphaned"
 *
 * Network-enhanced (pollNetwork: true):
 *   - For sessions with a known conversationId, calls manageChats({ action:'get' })
 *   - Recovered sessions become status "completed"
 *   - Unresolved (in_progress) sessions stay "running" with reconcile.state = 'unresolved'
 *
 * @param {object}  opts
 * @param {number}  [opts.hours=72]        Look back window for listSessions.
 * @param {boolean} [opts.all=false]       Pass through to listSessions.
 * @param {number}  [opts.limit=200]       Pass through to listSessions.
 * @param {boolean} [opts.pollNetwork]     Enable network polling.
 * @param {Function}[opts.manageChats]     manageChatsWithCloakBrowser function ref.
 *
 * Network polling gate:
 *   - New sessions poll only after the worker persisted a sent checkpoint.
 *   - Legacy sessions (pre-checkpoint metadata) still poll when conversationId exists.
 *
 * @returns {{ reconciled: number, sessions: Array }}
 */
async function reconcileSessions(opts = {}) {
  const {
    hours        = 72,
    all          = false,
    limit        = 200,
    pollNetwork  = false,
    manageChats  = null,
  } = opts;

  const sessions = listSessions({ hours, all, limit });
  const running  = sessions.filter(s => s.status === "running");

  if (running.length === 0) return { reconciled: 0, sessions: [] };

  const results = [];
  const now     = Date.now();

  for (const meta of running) {
    const createdMs = new Date(meta.createdAt).getTime();
    const age       = now - createdMs;
    const pidAlive  = defaultPidIsAlive(meta.pid);
    const tooOld    = age > MAX_RUNNING_AGE_MS;

    // ── PID still alive → annotate but never mutate status ──────────────────
    // (even if very old — could be a legitimate long-running session)
    if (pidAlive) {
      if (tooOld) {
        // Annotate as "stale" but keep running — active worker may still complete
        const reconcile = {
          reconciledAt: new Date().toISOString(),
          pidAlive:     true,
          ageSec:       Math.round(age / 1000),
          state:        "stale",
          remote:       null,
        };
        updateSession(meta.id, { reconcile });
        results.push({ meta, action: "stale", reason: "old_but_pid_alive" });
      } else {
        results.push({ meta, action: "none", reason: "pid_alive" });
      }
      continue;
    }

    // PID is dead — proceed to orphan / network recovery
    // Build reconcile record (will be written regardless of network result)
    const reconcile = {
      reconciledAt: new Date().toISOString(),
      pidAlive:     false,
      ageSec:       Math.round(age / 1000),
      state:        "orphaned",
      remote:       null,
    };

    const conversationId = resolveConversationId(meta);
    let   recovered      = false;

    // ── Optional network poll ──────────────────────────────────────────────
    if (pollNetwork && hasSentCheckpoint(meta) && conversationId && typeof manageChats === "function") {
      try {
        const chatResult = await manageChats({
          action:         "get",
          conversationId,
          profile:        meta.args && meta.args.profile,
          timeout:        resolveAssistantWaitSeconds(undefined),
          waitForAssistant: true,
          waitForAssistantTimeoutSec: resolveAssistantWaitSeconds(undefined),
          baselineAssistantMessageId: meta.baselineAssistantMessageId || null,
        });

        // manageChatsWithCloakBrowser wraps the result — unwrap conversation
        const convo = (
          chatResult &&
          (chatResult.conversation ||
            (chatResult.data && chatResult.data.conversation))
        ) || null;

        const inspection = inspectConversation(convo, meta);
        reconcile.remote = {
          conversationId,
          outcome: inspection.outcome,
          nodeId:  inspection.nodeId || null,
        };

        if (inspection.outcome === "completed") {
          const recoveredPayload = extractCompletedAssistantPayload(convo, { nodeId: inspection.nodeId });
          const recoveredResponse = recoveredPayload?.responseText || "";
          const responsePreview = recoveredResponse ? recoveredResponse.slice(0, 160) : null;
          const responseArtifact = persistSessionResponse(meta.id, recoveredResponse);
          const result = {
            ok:            true,
            reconciled:    true,
            recovered:     true,
            conversationId,
            nodeId:        inspection.nodeId,
            model:         recoveredPayload?.model || null,
            responsePreview,
            responsePath: responseArtifact?.responsePath || null,
            responseChars: responseArtifact?.responseChars || 0,
          };
          if (!responseArtifact?.responsePath && recoveredResponse) {
            result.inlineResponse = recoveredResponse;
            result.inlineResponseTruncated = false;
            result.inlineResponseChars = recoveredResponse.length;
          }
          reconcile.state = "recovered";
          updateSession(meta.id, {
            status:      "completed",
            completedAt: new Date().toISOString(),
            elapsedMs:   age,
            reconcile,
            result,
          });
          appendSessionLog(meta.id, `[session] ✓ recovered remote reply from conversation ${conversationId}`);
          if (responseArtifact?.responsePath) {
            appendSessionLog(meta.id, `[session] response saved: ${responseArtifact.responsePath}`);
          } else if (recoveredResponse) {
            appendSessionLog(meta.id, `[session] recovered assistant reply stored in inline fallback (${recoveredResponse.length} chars)`);
          }
          results.push({ meta, action: "recovered", reason: "conversation_completed", conversationId });
          recovered = true;

        } else if (inspection.outcome === "in_progress") {
          // Still generating on ChatGPT side — leave running but annotate
          reconcile.state = "unresolved";
          updateSession(meta.id, { reconcile });
          results.push({ meta, action: "unresolved", reason: "conversation_in_progress", conversationId });
          recovered = true; // don't mark error

        } else {
          // no_new_assistant / ambiguous → fall through to orphan
          reconcile.state = "orphaned";
          if (inspection.outcome === "no_new_assistant") {
            reconcile.remote = { ...reconcile.remote, reason: "no_new_assistant" };
          }
        }
      } catch (e) {
        reconcile.remote = {
          conversationId,
          outcome: "poll_failed",
          error:   e.message,
        };
        reconcile.state = "orphaned";
      }
    }

    // ── Mark orphaned ──────────────────────────────────────────────────────
    if (!recovered) {
      updateSession(meta.id, {
        status:      "error",
        completedAt: new Date().toISOString(),
        elapsedMs:   age,
        reconcile,
        error: {
          message: "Session orphaned — process exited without completing",
          code:    "session_orphaned",
        },
      });
      results.push({ meta, action: "orphaned", reason: pollNetwork ? "network_poll_failed_or_no_convo" : "pid_dead" });
    }
  }

  return {
    reconciled: results.filter(r => r.action !== "none").length,
    sessions:   results,
  };
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  defaultPidIsAlive,
  isChatGptCloakSession,
  resolveConversationId,
  inspectConversation,
  reconcileSessions,
  MAX_RUNNING_AGE_MS,
};
