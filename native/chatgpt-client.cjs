const path = require("path");
const { raceAbort, throwIfAborted } = require("./abort.cjs");
const {
  checkLoginStatus,
  clickSend,
  delay,
  evaluate,
  isCloudflareBlocked,
  normalizeChatGPTEffortChoice,
  normalizeChatGPTModelChoice,
  resolveChatGPTEffortMenuOption,
  resolveChatGPTModelMenuOption,
  selectEffort,
  selectModel,
  typePrompt,
  verifyChatGPTEffortSelection,
  verifyChatGPTModelSelection,
  waitForPageLoad,
  waitForPromptReady,
} = require("./chatgpt-client-ui.cjs");
const {
  cleanChatGPTResponseText,
  extractLatestAssistantSnapshot,
  isChatGPTResponseComplete,
  isNewAssistantContent,
  matchesPromptEcho,
  normalizePromptEcho,
  normalizeResponseSnapshot,
  readChatGPTResponseSnapshot,
  waitForResponse,
} = require("./chatgpt-client-response.cjs");

const CHATGPT_URL = "https://chatgpt.com/";
const RESPONSE_STARTED_AT = Symbol("responseStartedAt");

function hasRequiredCookies(cookies) {
  if (!cookies || !Array.isArray(cookies)) return false;
  return cookies.some(
    (cookie) =>
      typeof cookie?.name === "string" &&
      Boolean(cookie.value) &&
      (cookie.name === "__Secure-next-auth.session-token" ||
        /^__Secure-next-auth\.session-token\.\d+$/.test(cookie.name)),
  );
}

function extractConversationUrl(value) {
  try {
    const url = new URL(String(value));
    const match = url.pathname.match(/^\/c\/([^/]+)\/?$/);
    if (url.protocol !== "https:" || url.hostname !== "chatgpt.com" || !match) return null;
    return `${url.origin}/c/${match[1]}`;
  } catch {
    return null;
  }
}

function codedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function classifyError(error, fallbackCode, preservedCodes = []) {
  const classified = error instanceof Error ? error : new Error(String(error));
  if (
    classified.code !== "SURF_REQUEST_ABORTED" &&
    !preservedCodes.includes(classified.code)
  ) {
    classified.code = fallbackCode;
  }
  return classified;
}

async function waitForConversationUrl(cdp, timeoutMs = 30000, signal) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const conversationUrl = extractConversationUrl(await evaluate(cdp, "location.href", signal));
    if (conversationUrl) return conversationUrl;
    await delay(200, signal);
  }
  return null;
}

async function dispatch(options) {
  const {
    prompt,
    model,
    effort,
    file,
    getCookies,
    createTab,
    cdpEvaluate,
    cdpCommand,
    uploadFile,
    beforeSubmit,
    afterSubmit,
    startUrl,
    log = () => {},
    signal,
  } = options;

  try {
    throwIfAborted(signal);
    const guardedUploadFile = uploadFile
      ? (...args) => raceAbort(() => uploadFile(...args), signal)
      : uploadFile;
    log("Starting ChatGPT query");
    const { cookies } = await raceAbort(getCookies, signal);
    if (!hasRequiredCookies(cookies)) {
      throw codedError("ChatGPT login required", "auth");
    }
    log(`Got ${cookies.length} cookies`);
    const tabInfo = await raceAbort(createTab, signal);
    const { tabId } = tabInfo;
    if (!tabId) {
      throw new Error("Failed to create ChatGPT tab");
    }
    log(`Created tab ${tabId}`);

    const cdp = (expression) => raceAbort(() => cdpEvaluate(tabId, expression), signal);
    const inputCdp = (method, params) =>
      raceAbort(() => cdpCommand(tabId, method, params), signal);

    if (startUrl) await inputCdp("Page.navigate", { url: startUrl });
    await waitForPageLoad(cdp, 45000, signal);
    log("Page loaded");
    if (await isCloudflareBlocked(cdp)) {
      throw codedError("Cloudflare challenge detected - complete in browser", "cloudflare");
    }
    const loginStatus = await checkLoginStatus(cdp);
    if (loginStatus.status === 0) {
      throw codedError(
        loginStatus.error
          ? `ChatGPT login check failed: ${loginStatus.error}`
          : "ChatGPT login check failed",
        "auth",
      );
    }
    if (loginStatus.status !== 200 || loginStatus.hasLoginCta) {
      throw codedError("ChatGPT login required", "auth");
    }
    log("Login verified");
    const promptReady = await waitForPromptReady(cdp, 30000, signal);
    if (!promptReady) {
      throw new Error("Prompt textarea not ready");
    }
    log("Prompt ready");
    let modelVerified = null;
    let effortVerified = null;
    if (model) {
      modelVerified = await selectModel(cdp, model, 8000, signal);
      log(`Verified model: ${modelVerified}`);
    }
    if (effort) {
      effortVerified = await selectEffort(cdp, effort, 8000, signal);
      log(`Verified effort: ${effortVerified}`);
    }
    if (file) {
      if (!uploadFile) {
        throw new Error(
          "ChatGPT file upload unavailable: native host did not provide upload callback",
        );
      }
      const files = Array.isArray(file) ? file : [file];
      const absFiles = files.map((filePath) => path.resolve(process.cwd(), filePath));
      log(`Uploading ${absFiles.length} file(s) to ChatGPT...`);
      const uploadResult = await guardedUploadFile(tabId, absFiles);
      if (uploadResult?.error) {
        throw new Error(`ChatGPT file upload failed: ${uploadResult.error}`);
      }
      if (!uploadResult?.success) {
        throw new Error("ChatGPT file upload failed: upload did not report success");
      }
      log("File uploaded, waiting for ChatGPT attachment processing...");
      await delay(1500, signal);
    }
    await typePrompt(cdp, inputCdp, prompt, signal);
    log("Prompt typed");
    const baseline = normalizeResponseSnapshot(await readChatGPTResponseSnapshot(cdp));
    if (beforeSubmit) await raceAbort(beforeSubmit, signal);
    await clickSend(cdp, inputCdp, signal);
    baseline[RESPONSE_STARTED_AT] = Date.now();
    const promptEcho = normalizePromptEcho(prompt);
    if (afterSubmit) {
      await afterSubmit({ tabId, promptEcho, modelVerified, effortVerified });
    }
    log("Prompt sent, waiting for response...");
    const conversationUrl = await waitForConversationUrl(cdp, 30000, signal);

    return {
      tabId,
      conversationUrl,
      promptEcho,
      model: model || "current",
      modelVerified,
      effortVerified,
      baseline,
    };
  } catch (error) {
    throw classifyError(error, "dispatch_failed", [
      "auth",
      "cloudflare",
      "model_verification_failed",
    ]);
  }
}

async function harvest(options) {
  const {
    tabId: liveTabId,
    conversationUrl,
    promptEcho,
    baseline,
    timeout = 2700000,
    createTab,
    closeTab,
    cdpEvaluate,
    cdpCommand,
    keepCreatedTabOpen = false,
    log = () => {},
    signal,
  } = options;
  const startTime = Date.now();
  let tabId = liveTabId;
  let ownsTab = false;

  try {
    throwIfAborted(signal);
    if (!tabId) {
      if (!conversationUrl) {
        throw new Error("ChatGPT conversation URL required for fresh-tab harvest");
      }
      const tabInfo = await raceAbort(createTab, signal);
      tabId = tabInfo?.tabId;
      if (!tabId) {
        throw new Error("Failed to create ChatGPT tab");
      }
      ownsTab = true;
    }

    const cdp = (expression) => raceAbort(() => cdpEvaluate(tabId, expression), signal);
    const inputCdp = (method, params) =>
      raceAbort(() => cdpCommand(tabId, method, params), signal);

    if (ownsTab) {
      await inputCdp("Page.navigate", { url: conversationUrl });
      await waitForPageLoad(cdp, 45000, signal);
      if (await isCloudflareBlocked(cdp)) {
        throw codedError("Cloudflare challenge detected - complete in browser", "cloudflare");
      }
      const loginStatus = await checkLoginStatus(cdp);
      if (loginStatus.status === 0) {
        throw codedError(
          loginStatus.error
            ? `ChatGPT login check failed: ${loginStatus.error}`
            : "ChatGPT login check failed",
          "auth",
        );
      }
      if (loginStatus.status !== 200 || loginStatus.hasLoginCta) {
        throw codedError("ChatGPT login required", "auth");
      }
    }

    const elapsedSinceSend = baseline?.[RESPONSE_STARTED_AT]
      ? Date.now() - baseline[RESPONSE_STARTED_AT]
      : 0;
    const response = await waitForResponse(
      cdp,
      Math.max(0, timeout - elapsedSinceSend),
      baseline?.latestAssistant,
      baseline?.assistantCount,
      signal,
      baseline ? undefined : promptEcho,
    );
    log(`Response received (${response.text.length} chars)`);
    return {
      response: response.text,
      messageId: response.messageId,
      tookMs: Date.now() - startTime,
    };
  } catch (error) {
    const fallbackCode = error?.message === "Response timeout" ? "timeout" : "harvest_failed";
    throw classifyError(error, fallbackCode, ["auth", "cloudflare", "timeout"]);
  } finally {
    if (ownsTab && !keepCreatedTabOpen) {
      try {
        await closeTab(tabId);
      } catch (error) {
        log(`Failed to close ChatGPT tab ${tabId}: ${error?.message || error}`);
      }
    }
  }
}

async function query(options) {
  const { closeTab, createTab, log = () => {}, signal, timeout = 2700000 } = options;
  throwIfAborted(signal);
  const startTime = Date.now();
  let tabId = null;

  try {
    const dispatched = await dispatch({
      ...options,
      createTab: async () => {
        const tabInfo = await createTab();
        tabId = tabInfo?.tabId || null;
        return tabInfo;
      },
    });
    const result = await harvest({
      ...options,
      tabId: dispatched.tabId,
      conversationUrl: dispatched.conversationUrl,
      promptEcho: dispatched.promptEcho,
      baseline: dispatched.baseline,
      timeout,
    });
    return {
      response: result.response,
      model: dispatched.model,
      messageId: result.messageId,
      tookMs: Date.now() - startTime,
    };
  } finally {
    if (tabId) {
      try {
        await closeTab(tabId);
      } catch (error) {
        log(`Failed to close ChatGPT tab ${tabId}: ${error?.message || error}`);
      }
    }
  }
}

module.exports = {
  query,
  dispatch,
  harvest,
  hasRequiredCookies,
  cleanChatGPTResponseText,
  extractLatestAssistantSnapshot,
  normalizeChatGPTEffortChoice,
  normalizeChatGPTModelChoice,
  resolveChatGPTEffortMenuOption,
  resolveChatGPTModelMenuOption,
  isNewAssistantContent,
  isChatGPTResponseComplete,
  isCloudflareBlocked,
  normalizePromptEcho,
  matchesPromptEcho,
  extractConversationUrl,
  verifyChatGPTEffortSelection,
  verifyChatGPTModelSelection,
  CHATGPT_URL,
};
