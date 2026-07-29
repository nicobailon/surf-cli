const { throwIfAborted } = require("./abort.cjs");
const { SELECTORS, delay, evaluate } = require("./chatgpt-client-ui.cjs");

function normalizePromptEcho(prompt) {
  return String(prompt || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function matchesPromptEcho(text, promptEcho) {
  const expected = normalizePromptEcho(promptEcho);
  return expected.length > 0 && normalizePromptEcho(text) === expected;
}

function cleanChatGPTResponseText(rawText) {
  if (!rawText) return "";

  const chromeLines = new Set([
    "copy",
    "good response",
    "bad response",
    "read aloud",
    "edit",
    "retry",
    "continue generating",
    "share",
  ]);

  const lines = [];
  let inCodeFence = false;

  for (const line of String(rawText).replace(/\r\n?/g, "\n").split("\n")) {
    const trimmed = line.trim();
    const isFenceLine = trimmed.startsWith("```");
    const normalizedLine = inCodeFence || isFenceLine ? line.replace(/[\t ]+$/g, "") : line;

    lines.push({
      text: normalizedLine,
      trimmed,
      isChrome: trimmed.length > 0 && chromeLines.has(trimmed.toLowerCase()),
      inCodeFence,
      isFenceLine,
    });

    if (isFenceLine) {
      inCodeFence = !inCodeFence;
    }
  }

  while (lines.length > 0 && lines[0].trimmed.length === 0) {
    lines.shift();
  }
  while (lines.length > 0 && lines[lines.length - 1].trimmed.length === 0) {
    lines.pop();
  }

  let trailingChromeStart = lines.length;
  while (trailingChromeStart > 0) {
    const line = lines[trailingChromeStart - 1];
    if (line.inCodeFence || line.isFenceLine || !line.isChrome) break;
    trailingChromeStart--;
  }

  const trailingChromeCount = lines.length - trailingChromeStart;
  if (trailingChromeCount >= 2) {
    lines.splice(trailingChromeStart);
  }

  while (lines.length > 0 && lines[0].trimmed.length === 0) {
    lines.shift();
  }
  while (lines.length > 0 && lines[lines.length - 1].trimmed.length === 0) {
    lines.pop();
  }

  return lines.map((line) => line.text).join("\n");
}

function extractLatestAssistantSnapshot(candidates) {
  if (!Array.isArray(candidates)) return null;

  let latestEmptyAssistant = null;

  for (let i = candidates.length - 1; i >= 0; i--) {
    const candidate = candidates[i];
    if (!candidate?.isAssistant) continue;

    const snapshot = {
      ...candidate,
      text: cleanChatGPTResponseText(candidate?.text || ""),
      turnIndex: i,
    };

    if (snapshot.text) {
      return snapshot;
    }

    if (!latestEmptyAssistant) {
      latestEmptyAssistant = snapshot;
    }
  }

  return latestEmptyAssistant;
}

function normalizeResponseSnapshot(rawSnapshot) {
  const candidates = rawSnapshot?.candidates;
  return {
    latestAssistant: extractLatestAssistantSnapshot(candidates),
    assistantCount: Array.isArray(candidates)
      ? candidates.filter((candidate) => candidate?.isAssistant).length
      : 0,
    stopVisible: Boolean(rawSnapshot?.stopVisible),
  };
}

function isNewAssistantContent(
  latestAssistant,
  baselineAssistant,
  assistantCount = 0,
  baselineAssistantCount = 0,
) {
  if (!latestAssistant) return false;
  if (!baselineAssistant) return true;
  if (
    latestAssistant.messageId &&
    baselineAssistant.messageId &&
    latestAssistant.messageId !== baselineAssistant.messageId
  ) {
    return true;
  }

  const currentText = latestAssistant.text || "";
  const baselineText = baselineAssistant.text || "";

  if (assistantCount > baselineAssistantCount) {
    if (latestAssistant.turnIndex !== baselineAssistant.turnIndex) {
      return true;
    }
    if (currentText !== baselineText) {
      return true;
    }
    return false;
  }

  return currentText !== baselineText;
}

function isChatGPTResponseComplete(snapshot, stableCycles, stableMs) {
  if (!snapshot?.text) return false;
  if (snapshot.stopVisible) return false;
  if (snapshot.hasFinishedActions) return true;
  return stableCycles >= 6 && stableMs >= 1200;
}

function scopeSnapshotToPrompt(rawSnapshot, promptEcho) {
  const candidates = Array.isArray(rawSnapshot?.candidates) ? rawSnapshot.candidates : [];
  let userIndex = -1;
  for (let index = candidates.length - 1; index >= 0; index--) {
    const candidate = candidates[index];
    if (candidate?.isUser && matchesPromptEcho(candidate.text, promptEcho)) {
      userIndex = index;
      break;
    }
  }
  if (userIndex === -1) return { ...rawSnapshot, candidates: [] };

  const following = candidates.slice(userIndex + 1);
  const nextUserIndex = following.findIndex((candidate) => candidate?.isUser);
  return {
    ...rawSnapshot,
    candidates: nextUserIndex === -1 ? following : following.slice(0, nextUserIndex),
  };
}

async function readChatGPTResponseSnapshot(cdp) {
  return evaluate(
    cdp,
    `(() => {
      const scope = document.querySelector('main') || document;
      const CONVERSATION_SELECTOR = ${JSON.stringify(SELECTORS.conversationTurn)};
      const ASSISTANT_SELECTOR = ${JSON.stringify(SELECTORS.assistantMessage)};
      const CONTENT_SELECTORS = ${JSON.stringify(SELECTORS.assistantContent.split(", "))};
      const STOP_SELECTOR = ${JSON.stringify(SELECTORS.stopButton)};
      const FINISHED_SELECTOR = ${JSON.stringify(SELECTORS.finishedActions)};

      const toCandidate = (turnNode, messageRoot = null) => {
        const resolvedMessageRoot = messageRoot || (turnNode.matches?.(ASSISTANT_SELECTOR)
          ? turnNode
          : turnNode.querySelector(ASSISTANT_SELECTOR));
        const authorRoot = turnNode.matches?.('[data-message-author-role], [data-turn]')
          ? turnNode
          : turnNode.querySelector('[data-message-author-role], [data-turn]');
        const searchRoot = resolvedMessageRoot || authorRoot || turnNode;
        let contentRoot = null;

        for (const selector of CONTENT_SELECTORS) {
          const match = selector === '[dir="auto"]'
            ? (searchRoot.matches?.(selector) ? searchRoot : null)
            : (searchRoot.matches?.(selector) ? searchRoot : searchRoot.querySelector(selector));
          if (match) {
            contentRoot = match;
            break;
          }
        }

        const role =
          resolvedMessageRoot?.getAttribute('data-message-author-role') ||
          authorRoot?.getAttribute('data-message-author-role') ||
          turnNode.getAttribute('data-message-author-role') ||
          null;
        const turn =
          resolvedMessageRoot?.getAttribute('data-turn') ||
          authorRoot?.getAttribute('data-turn') ||
          turnNode.getAttribute('data-turn') ||
          null;
        const isAssistant =
          role === 'assistant' ||
          turn === 'assistant' ||
          resolvedMessageRoot !== null;
        const isUser = role === 'user' || turn === 'user';
        const text = (contentRoot || turnNode).innerText || (contentRoot || turnNode).textContent || '';
        const messageId =
          resolvedMessageRoot?.getAttribute('data-message-id') ||
          turnNode.getAttribute('data-message-id') ||
          null;
        const hasFinishedActions = Boolean(turnNode.querySelector(FINISHED_SELECTOR));

        return {
          role,
          turn,
          isAssistant,
          isUser,
          text,
          messageId,
          hasFinishedActions,
        };
      };

      let candidates = Array.from(scope.querySelectorAll(CONVERSATION_SELECTOR)).map((turnNode) =>
        toCandidate(turnNode)
      );

      if (candidates.length === 0) {
        candidates = Array.from(scope.querySelectorAll(ASSISTANT_SELECTOR)).map((messageRoot) =>
          toCandidate(messageRoot, messageRoot)
        );
      }

      return {
        candidates,
        stopVisible: Boolean(scope.querySelector(STOP_SELECTOR)),
      };
    })()`,
  );
}

async function waitForResponse(
  cdp,
  timeoutMs = 2700000,
  baselineAssistant,
  baselineAssistantCount,
  signal,
  promptEcho,
) {
  throwIfAborted(signal);
  const deadline = Date.now() + timeoutMs;
  let previousText = baselineAssistant?.text || "";
  let stableCycles = 0;
  let lastChangeAt = Date.now();

  while (Date.now() < deadline) {
    const rawSnapshot = await readChatGPTResponseSnapshot(cdp);
    const snapshot = promptEcho ? scopeSnapshotToPrompt(rawSnapshot, promptEcho) : rawSnapshot;

    if (!snapshot) {
      await delay(400, signal);
      continue;
    }

    const { latestAssistant, assistantCount, stopVisible } = normalizeResponseSnapshot(snapshot);
    const currentText = latestAssistant?.text || "";
    const hasNewAssistantContent = isNewAssistantContent(
      latestAssistant,
      baselineAssistant,
      assistantCount,
      baselineAssistantCount,
    );

    if (!hasNewAssistantContent) {
      await delay(400, signal);
      continue;
    }

    if (currentText !== previousText) {
      previousText = currentText;
      stableCycles = 0;
      lastChangeAt = Date.now();
    } else if (currentText) {
      stableCycles++;
    } else {
      stableCycles = 0;
      lastChangeAt = Date.now();
    }

    const stableMs = Date.now() - lastChangeAt;
    const completionSnapshot = latestAssistant
      ? { ...latestAssistant, stopVisible }
      : { text: "", stopVisible, hasFinishedActions: false };

    if (isChatGPTResponseComplete(completionSnapshot, stableCycles, stableMs)) {
      return {
        text: latestAssistant.text,
        messageId: latestAssistant.messageId,
        turnIndex: latestAssistant.turnIndex,
      };
    }

    await delay(400, signal);
  }

  throw new Error("Response timeout");
}

module.exports = {
  cleanChatGPTResponseText,
  extractLatestAssistantSnapshot,
  isChatGPTResponseComplete,
  isNewAssistantContent,
  matchesPromptEcho,
  normalizePromptEcho,
  normalizeResponseSnapshot,
  readChatGPTResponseSnapshot,
  waitForResponse,
};
