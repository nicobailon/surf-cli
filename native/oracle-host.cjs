const chatgptClient = require("./chatgpt-client.cjs");
const oracleJobs = require("./oracle-jobs.cjs");

const TERMINAL_STATES = new Set(["captured", "failed"]);

function codedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function assertLocalOracleRequest(request) {
  if (request?.context?.isRemote) {
    throw codedError("remote_unsupported", "oracle tools are not supported for remote clients");
  }
}

function withJobId(error, jobId, fallbackCode) {
  const result = error instanceof Error ? error : new Error(String(error));
  if (!result.code) result.code = fallbackCode;
  result.jobId = jobId;
  return result;
}

function createOracleHost({ queueAiRequest, requestCallExtension, buildProviderUploadMessage, log }) {
  const closeTab = (request, tabId) => requestCallExtension(
    request,
    "close_tab",
    { type: "CHATGPT_CLOSE_TAB", tabId },
    45000,
    true,
  );

  const browserOptions = (request) => ({
    signal: request.signal,
    getCookies: () => requestCallExtension(
      request,
      "get_cookies",
      { type: "GET_CHATGPT_COOKIES" },
    ),
    createTab: () => requestCallExtension(
      request,
      "create_tab",
      { type: "CHATGPT_NEW_TAB" },
    ),
    closeTab: (tabId) => closeTab(request, tabId),
    cdpEvaluate: (tabId, expression) => requestCallExtension(
      request,
      "cdp_evaluate",
      { type: "CHATGPT_EVALUATE", tabId, expression },
    ),
    cdpCommand: (tabId, method, params) => requestCallExtension(
      request,
      "cdp_command",
      { type: "CHATGPT_CDP_COMMAND", tabId, method, params },
    ),
    uploadFile: (tabId, filePaths) => requestCallExtension(
      request,
      "upload_file",
      buildProviderUploadMessage("chatgpt", tabId, filePaths),
    ),
  });

  async function ask(request, args) {
    assertLocalOracleRequest(request);
    const model = args.model ? chatgptClient.normalizeChatGPTModelChoice(args.model) : null;
    const created = oracleJobs.createJob({
      prompt: args.prompt,
      contextManifest: args.contextManifest,
      model,
      effortRequested: args.effort ?? null,
      follow: args.follow ?? null,
      requestId: args.requestId ?? null,
    });
    if (created.requestDeduped) return oracleJobs.getJob(created.id);
    let createdTabId = null;

    try {
      let parent = null;
      if (args.follow) {
        parent = oracleJobs.getJob(args.follow);
        if (parent.state !== "captured" || !parent.conversationUrl) {
          throw codedError(
            "invalid_transition",
            `oracle follow parent ${parent.id} must be captured; current state: ${parent.state}`,
          );
        }
      }

      const dispatched = await queueAiRequest(() => chatgptClient.dispatch({
        ...browserOptions(request),
        prompt: args.prompt,
        model,
        effort: args.effort,
        file: args.bundlePath,
        startUrl: parent?.conversationUrl,
        createTab: async () => {
          const tabInfo = await browserOptions(request).createTab();
          createdTabId = tabInfo?.tabId || null;
          return tabInfo;
        },
        afterSubmit: ({ tabId, promptEcho, modelVerified, effortVerified }) => {
          const dispatchedJob = oracleJobs.markDispatched(created.id, {
            tabId,
            promptEcho,
            modelVerified,
            effortVerified,
          });
          if (parent) {
            oracleJobs.appendTurn(parent.id, {
              prompt: args.prompt,
              dispatchedAt: dispatchedJob.dispatchedAt,
              childJobId: created.id,
              requestId: args.requestId ?? null,
            });
          }
        },
        log: (message) => log(`[oracle:${created.id}:dispatch] ${message}`),
      }), request);

      if (dispatched.conversationUrl) {
        oracleJobs.markAwaiting(created.id, {
          conversationUrl: dispatched.conversationUrl,
          promptEcho: dispatched.promptEcho,
        });
      }
      return oracleJobs.getJob(created.id);
    } catch (error) {
      const current = oracleJobs.getJob(created.id);
      if (error?.code !== "SURF_REQUEST_ABORTED" && !TERMINAL_STATES.has(current.state)) {
        oracleJobs.markFailed(created.id, {
          code: error?.code || "dispatch_failed",
          message: error?.message || String(error),
        });
      }
      const keepForManualClearance = ["auth", "cloudflare"].includes(error?.code)
        && current.state === "created";
      if (
        createdTabId
        && !keepForManualClearance
        && (error?.code !== "SURF_REQUEST_ABORTED" || current.state === "created")
      ) {
        await closeTab(request, createdTabId).catch(() => {});
      }
      throw withJobId(error, created.id, "dispatch_failed");
    }
  }

  function status(request, args) {
    assertLocalOracleRequest(request);
    if (args.id) return oracleJobs.getJob(args.id);
    const newest = oracleJobs.listJobs({ limit: 1 })[0];
    if (!newest) throw codedError("not_found", "no oracle jobs found");
    return newest;
  }

  function list(request) {
    assertLocalOracleRequest(request);
    return oracleJobs.listJobs({});
  }

  async function result(request, args) {
    assertLocalOracleRequest(request);
    let job = oracleJobs.getJob(args.id);
    if (job.state === "captured") {
      return { ...job, response: oracleJobs.getResponse(job.id) };
    }
    if (job.state === "failed") {
      throw codedError(job.error?.code || "harvest_failed", job.error?.message || "oracle job failed", {
        jobId: job.id,
      });
    }

    const requestedTimeout = Number(args.timeout);
    const timeout = Number.isFinite(requestedTimeout) && requestedTimeout > 0
      ? requestedTimeout * 1000
      : 300000;

    try {
      const harvested = await queueAiRequest(async () => {
        job = oracleJobs.getJob(job.id);
        const tabsResult = await requestCallExtension(request, "list_tabs", { type: "LIST_TABS" });
        if (tabsResult?.error) throw new Error(tabsResult.error);
        const liveTab = Array.isArray(tabsResult?.tabs)
          && tabsResult.tabs.some((tab) => tab?.id === job.tabId);
        if (!liveTab && !job.conversationUrl) {
          throw codedError(
            "harvest_failed",
            `oracle job ${job.id} tab is no longer available; the response may still exist in ChatGPT web history but cannot be recovered without a conversation URL`,
          );
        }

        const options = browserOptions(request);
        const readConversationUrl = async (tabId) => {
          const href = await options.cdpEvaluate(tabId, "location.href");
          return chatgptClient.extractConversationUrl(href?.result?.value);
        };
        if (liveTab && !job.conversationUrl) {
          const conversationUrl = await readConversationUrl(job.tabId);
          if (conversationUrl) {
            job = oracleJobs.markAwaiting(job.id, {
              conversationUrl,
              promptEcho: job.promptEcho,
            });
          }
        }
        const harvestOptions = {
          ...options,
          conversationUrl: job.conversationUrl,
          promptEcho: job.promptEcho,
          timeout,
          keepCreatedTabOpen: true,
          createTab: async () => {
            const tabInfo = await options.createTab();
            if (tabInfo?.tabId) oracleJobs.updateTabId(job.id, tabInfo.tabId);
            return tabInfo;
          },
          log: (message) => log(`[oracle:${job.id}:harvest] ${message}`),
        };
        let harvestResult;
        if (liveTab) {
          try {
            harvestResult = await chatgptClient.harvest({
              ...harvestOptions,
              tabId: job.tabId,
            });
          } catch (error) {
            if (error?.code === "timeout" || error?.code === "SURF_REQUEST_ABORTED") throw error;
            job = oracleJobs.getJob(job.id);
            if (!job.conversationUrl) throw error;
            log(`[oracle:${job.id}:harvest] Live-tab harvest failed; retrying via conversation URL`);
            harvestResult = await chatgptClient.harvest({
              ...harvestOptions,
              tabId: null,
              conversationUrl: job.conversationUrl,
            });
          }
        } else {
          harvestResult = await chatgptClient.harvest({
            ...harvestOptions,
            tabId: null,
          });
        }

        job = oracleJobs.getJob(job.id);
        if (job.state === "dispatched" && job.tabId) {
          const conversationUrl = await readConversationUrl(job.tabId);
          if (!conversationUrl) {
            throw codedError("harvest_failed", `oracle job ${job.id} conversation URL is unavailable`);
          }
          oracleJobs.markAwaiting(job.id, {
            conversationUrl,
            promptEcho: job.promptEcho,
          });
        }
        return harvestResult;
      }, request);

      job = oracleJobs.getJob(job.id);
      const captured = oracleJobs.markCaptured(job.id, harvested);
      if (captured.follow) {
        oracleJobs.markTurnCaptured(captured.follow, {
          dispatchedAt: captured.dispatchedAt,
          capturedAt: captured.capturedAt,
          childJobId: captured.id,
          requestId: captured.requestId ?? null,
        });
      }
      if (captured.tabId) {
        await closeTab(request, captured.tabId).catch((error) => {
          log(`[oracle:${captured.id}] Failed to close tab ${captured.tabId}: ${error?.message || error}`);
        });
      }
      return { ...captured, response: harvested.response };
    } catch (error) {
      if (error?.code === "timeout") return oracleJobs.getJob(job.id);
      if (error?.code === "SURF_REQUEST_ABORTED") {
        throw withJobId(error, job.id, "harvest_failed");
      }
      const current = oracleJobs.getJob(job.id);
      if (!TERMINAL_STATES.has(current.state)) {
        oracleJobs.markFailed(current.id, {
          code: error?.code || "harvest_failed",
          message: error?.message || String(error),
        });
      }
      if (current.tabId) await closeTab(request, current.tabId).catch(() => {});
      throw withJobId(error, current.id, "harvest_failed");
    }
  }

  return {
    adoptOrphans: oracleJobs.adoptOrphans,
    ask,
    assertLocal: assertLocalOracleRequest,
    handle(request, message) {
      if (message.type === "ORACLE_ASK") return ask(request, message);
      if (message.type === "ORACLE_STATUS") return status(request, message);
      if (message.type === "ORACLE_RESULT") return result(request, message);
      if (message.type === "ORACLE_LIST") return list(request);
      throw new Error(`Unknown oracle request: ${message.type}`);
    },
  };
}

module.exports = { assertLocalOracleRequest, createOracleHost };
