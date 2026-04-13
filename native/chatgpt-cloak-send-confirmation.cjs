"use strict";

async function inspectSendStartState({
  page,
  expectedPrompt,
  promptSelectors,
  stopSelector,
}) {
  return await page.evaluate(({ promptSelectors, stopSelector, expected }) => {
    const normalize = (value) => String(value || "").replace(/\r\n/g, "\n").trim();
    const isVisible = (el) => {
      if (!el || !(el instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(el);
      if (!style) return false;
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity || "1") === 0) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const isEnabled = (el) => {
      if (!el) return false;
      if (el.disabled) return false;
      const aria = (el.getAttribute("aria-disabled") || "").toLowerCase();
      return aria !== "true";
    };

    let stopVisible = false;
    const stopButtons = document.querySelectorAll(stopSelector);
    for (const button of stopButtons) {
      if (isVisible(button) && isEnabled(button)) {
        stopVisible = true;
        break;
      }
    }

    let composerText = "";
    for (const selector of promptSelectors) {
      const el = document.querySelector(selector);
      if (!el) continue;
      if ("value" in el && typeof el.value === "string") composerText = el.value;
      else composerText = el.innerText || el.textContent || "";
      break;
    }

    const normalizedComposer = normalize(composerText);
    const normalizedExpected = normalize(expected);
    return {
      stopVisible,
      composerCleared: normalizedComposer.length === 0,
      promptStillPresent: normalizedComposer.length > 0 && normalizedComposer === normalizedExpected,
      composerChars: normalizedComposer.length,
    };
  }, { promptSelectors, stopSelector, expected: expectedPrompt });
}

async function probeSendConfirmation({
  page,
  expectedPrompt,
  conversationId,
  baselineUserNodeId,
  timeoutMs = 5_000,
  promptSelectors,
  stopSelector,
  sleep,
  waitForPromptPersistenceValidation,
  extractConversationIdFromUrl,
}) {
  const deadline = Date.now() + timeoutMs;
  const hadConversationIdBeforeSend = !!conversationId;
  let lastDomState = null;

  while (Date.now() < deadline) {
    const detectedConversationId = conversationId || extractConversationIdFromUrl(page.url());
    if (detectedConversationId) {
      const validation = await waitForPromptPersistenceValidation({
        page,
        conversationId: detectedConversationId,
        expectedPrompt,
        baselineUserNodeId,
        timeoutMs: Math.max(1_500, Math.min(4_000, timeoutMs)),
        pollMs: 400,
      });
      if (validation.ok) {
        return {
          status: "confirmed",
          conversationId: detectedConversationId,
          validation,
          confirmationSource: "prompt_persisted",
          domState: null,
        };
      }

      lastDomState = await inspectSendStartState({
        page,
        expectedPrompt,
        promptSelectors,
        stopSelector,
      });

      const definitiveValidationFailure = ["file_map_placeholder", "big_paste_attachment"].includes(validation.failureReason || "");
      if (definitiveValidationFailure) {
        return {
          status: "confirmed",
          conversationId: detectedConversationId,
          validation,
          confirmationSource: "prompt_persisted_invalid",
          domState: lastDomState,
        };
      }

      const positiveNoSendProof = !lastDomState.stopVisible && !lastDomState.composerCleared && lastDomState.promptStillPresent;
      const independentSendSignal = !hadConversationIdBeforeSend
        || lastDomState.stopVisible
        || lastDomState.composerCleared;

      if (independentSendSignal) {
        return {
          status: "confirmed",
          conversationId: detectedConversationId,
          validation,
          confirmationSource: "conversation_detected",
          domState: lastDomState,
        };
      }

      if (positiveNoSendProof) {
        return {
          status: "no_send",
          conversationId: detectedConversationId,
          validation,
          confirmationSource: "no_send_proven",
          domState: lastDomState,
        };
      }

      await sleep(350);
      continue;
    }

    lastDomState = await inspectSendStartState({
      page,
      expectedPrompt,
      promptSelectors,
      stopSelector,
    });
    if (lastDomState.stopVisible || lastDomState.composerCleared) {
      return {
        status: "confirmed",
        conversationId: null,
        validation: null,
        confirmationSource: lastDomState.stopVisible
          ? "stop_button"
          : "composer_cleared",
        domState: lastDomState,
      };
    }

    if (lastDomState.promptStillPresent) {
      return {
        status: "no_send",
        conversationId: null,
        validation: null,
        confirmationSource: "no_send_proven",
        domState: lastDomState,
      };
    }

    await sleep(350);
  }

  if (lastDomState && !lastDomState.stopVisible && !lastDomState.composerCleared && lastDomState.promptStillPresent) {
    return {
      status: "no_send",
      conversationId: null,
      validation: null,
      confirmationSource: "no_send_proven",
      domState: lastDomState,
    };
  }

  return {
    status: "ambiguous",
    conversationId: null,
    validation: null,
    confirmationSource: null,
    domState: lastDomState,
  };
}

async function attemptSendAndConfirm({
  page,
  textarea,
  promptEntry,
  finalPrompt,
  conversationId,
  baselineUserNodeId,
  sendButtonSelectors,
  promptSelectors,
  stopSelector,
  sleep,
  log = () => {},
  waitForPromptPersistenceValidation,
  extractConversationIdFromUrl,
}) {
  const tryConfirmation = async ({ method, selector = null, attemptError = null }) => {
    const sentAt = new Date().toISOString();
    const probe = await probeSendConfirmation({
      page,
      expectedPrompt: finalPrompt,
      conversationId,
      baselineUserNodeId,
      timeoutMs: 5_000,
      promptSelectors,
      stopSelector,
      sleep,
      waitForPromptPersistenceValidation,
      extractConversationIdFromUrl,
    });
    return {
      ...probe,
      method,
      selector,
      sentAt,
      attemptError: attemptError ? (attemptError.message || String(attemptError)) : null,
    };
  };

  if (promptEntry.sendEnabled) {
    for (const sel of sendButtonSelectors) {
      let attemptError = null;
      try {
        const btn = page.locator(sel).first();
        await btn.click({ timeout: 5_000 });
        log("info", `Send button clicked: ${sel}`);
      } catch (error) {
        attemptError = error;
        log("warn", `Send button attempt threw: ${sel}`, { error: error?.message || String(error) });
      }

      const result = await tryConfirmation({ method: "click", selector: sel, attemptError });
      if (result.status === "confirmed") return result;
      if (result.status === "ambiguous") {
        throw Object.assign(
          new Error("Prompt send confirmation timed out after click attempt"),
          { code: "send_confirmation_timeout", details: { lastProbe: result.domState || null, selector: sel } },
        );
      }
      log("info", `Send attempt proved no dispatch: ${sel}`, result.domState || {});
    }
  }

  log(
    promptEntry.sendButtonFound ? "warn" : "info",
    promptEntry.sendButtonFound
      ? "Send button attempts proved no dispatch — pressing Enter"
      : "No send button found — pressing Enter",
  );

  let enterError = null;
  try {
    await textarea.press("Enter");
  } catch (error) {
    enterError = error;
    log("warn", "Enter send attempt threw", { error: error?.message || String(error) });
  }

  const result = await tryConfirmation({ method: "enter", attemptError: enterError });
  if (result.status === "confirmed") return result;
  if (result.status === "ambiguous") {
    throw Object.assign(
      new Error("Prompt send confirmation timed out after Enter"),
      { code: "send_confirmation_timeout", details: { lastProbe: result.domState || null } },
    );
  }

  throw Object.assign(
    new Error("Prompt send did not confirm via click or Enter"),
    { code: "send_not_confirmed", details: { lastProbe: result.domState || null } },
  );
}

module.exports = {
  inspectSendStartState,
  probeSendConfirmation,
  attemptSendAndConfirm,
};
