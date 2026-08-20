const AISTUDIO_URL = "https://aistudio.google.com/prompts/new_chat";
const GENERATE_CONTENT_URL_FRAGMENT =
  "google.internal.alkali.applications.makersuite.v1.MakerSuiteService/GenerateContent";

function normalizeModelString(model) {
  return String(model || "").trim().toLowerCase();
}

function buildAiStudioUrl(model) {
  const normalized = normalizeModelString(model);
  if (!normalized) return AISTUDIO_URL;

  // Only use the URL param when the caller passes a literal AI Studio model id.
  // If the model id is wrong/unknown, AI Studio will fall back to the last-selected
  // model in the UI, which is acceptable.
  const looksLikeUrlModelId =
    /^[a-z0-9.\-]+$/.test(normalized) && (normalized.includes("preview") || normalized.includes("latest"));

  if (!looksLikeUrlModelId) return AISTUDIO_URL;

  return `${AISTUDIO_URL}?model=${encodeURIComponent(normalized)}`;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getNestedValue(value, pathParts, fallback) {
  let current = value;
  for (const part of pathParts) {
    if (current == null) return fallback;
    if (typeof part === 'number') {
      if (!Array.isArray(current)) return fallback;
      current = current[part];
    } else {
      if (typeof current !== 'object') return fallback;
      current = current[part];
    }
  }
  return current ?? fallback;
}

function buildClickDispatcher() {
  return `function dispatchClickSequence(target) {
    if (!target || !(target instanceof EventTarget)) return false;
    const types = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
    for (const type of types) {
      const common = { bubbles: true, cancelable: true, view: window };
      let event;
      if (type.startsWith('pointer') && 'PointerEvent' in window) {
        event = new PointerEvent(type, { ...common, pointerId: 1, pointerType: 'mouse' });
      } else {
        event = new MouseEvent(type, common);
      }
      target.dispatchEvent(event);
    }
    return true;
  }`;
}

function cleanAiStudioResponse(rawText, userPrompt = '') {
  if (!rawText) return '';

  // Lines that match exactly (full trimmed line, case-insensitive) are stripped
  // These are AI Studio UI chrome artifacts that can leak into DOM text extraction
  const bannedExact = new Set([
    'user',
    'model',
    'info',
    'warning',
    'close',
    'edit',
    'more_vert',
    'thumb_up',
    'thumb_down',
    'good response',
    'bad response',
    'rerun this turn',
    'open options',
    'running...',

    // Code block UI chrome from AI Studio (can leak from rendered mode)
    'code',
    'download',
    'content_copy',
    'expand_less',
    'expand_more',
  ]);

  const promptTrimmed = String(userPrompt || '').trim();

  let lines = String(rawText).split(/\r?\n/);

  // If the raw extraction includes both roles, keep only the last model segment
  // Raw Mode commonly renders as:
  //   User
  //   <prompt>
  //   Model
  //   <response>
  // plus occasional UI banners
  const lastModelIdx = (() => {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (String(lines[i] || '').trim().toLowerCase() === 'model') return i;
    }
    return -1;
  })();

  if (lastModelIdx !== -1 && lastModelIdx + 1 < lines.length) {
    lines = lines.slice(lastModelIdx + 1);
  }

  let inCodeFence = false;
  let previousWasBlank = false;

  const cleanedLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();

    const isFenceLine = trimmed.startsWith('```');

    // Fence lines: preserve exactly (minus trailing whitespace)
    if (isFenceLine) {
      inCodeFence = !inCodeFence;
      cleanedLines.push(line.replace(/[\t ]+$/g, ''));
      previousWasBlank = false;
      continue;
    }

    // Inside code fences: preserve indentation and blank lines
    if (inCodeFence) {
      cleanedLines.push(line.replace(/[\t ]+$/g, ''));
      previousWasBlank = false;
      continue;
    }

    // Outside code: drop UI-only lines and prompt echo
    if (trimmed.length === 0) {
      if (!previousWasBlank) {
        cleanedLines.push('');
        previousWasBlank = true;
      }
      continue;
    }

    if (bannedExact.has(lower)) continue;
    if (promptTrimmed && trimmed === promptTrimmed) continue;

    // Common AI Studio footer/disclaimer
    if (lower.includes('google ai models may make mistakes')) continue;
    if (lower.includes('double-check outputs')) continue;
    if (lower.startsWith('response ready')) continue;

    // Drive enable prompt (AI Studio UI banner)
    if (lower.includes('turn drive on for future conversations')) continue;
    if (lower.includes('your work is currently not being saved')) continue;
    if (lower.includes('enable google drive')) continue;

    // Remove inline UI icon tokens, but only outside code
    const withoutIcons = trimmed
      .replace(/\bthumb_up\b/g, '')
      .replace(/\bthumb_down\b/g, '')
      .replace(/\bmore_vert\b/g, '')
      .trim();

    if (withoutIcons.length === 0) continue;

    cleanedLines.push(withoutIcons);
    previousWasBlank = false;
  }

  // Trim leading/trailing blank lines
  while (cleanedLines.length > 0 && cleanedLines[0].trim().length === 0) cleanedLines.shift();
  while (cleanedLines.length > 0 && cleanedLines[cleanedLines.length - 1].trim().length === 0) cleanedLines.pop();

  return cleanedLines.join('\n');
}

function hasRequiredCookies(cookies) {
  if (!cookies || !Array.isArray(cookies)) return false;
  const sid = cookies.find(c => c.name === "__Secure-1PSID" && c.value);
  return Boolean(sid);
}

function extractModelKeywords(modelId) {
  const normalized = normalizeModelString(modelId);
  if (!normalized) return [];

  const ignored = new Set(["gemini", "preview", "latest"]);

  const tokens = normalized
    .split("-")
    .map(t => t.trim())
    .filter(Boolean)
    .filter(t => !ignored.has(t))
    .filter(t => !/^\d+(?:\.\d+)?$/.test(t));

  // Keep short-but-meaningful tokens like "pro"
  const keywords = tokens.filter(t => t.length >= 3);

  return Array.from(new Set(keywords));
}

function normalizeAiStudioRpcJson(rawText) {
  let text = String(rawText || '').trim();
  if (!text) return text;

  // Strip Google's common XSSI prefix
  //   )]}'\n<json>
  if (text.startsWith(")]}'")) {
    const newlineIndex = text.indexOf('\n');
    text = (newlineIndex === -1 ? '' : text.slice(newlineIndex + 1)).trim();
    if (!text) return text;
  }

  // Some RPC errors are returned in JS-ish array form with a leading elision:
  //   [,[7,"The caller does not have permission"]]
  // Normalize this into valid JSON before parsing
  if (text.startsWith('[,')) {
    return `[null${text.slice(1)}`;
  }

  return text;
}

function parseAiStudioRpcError(rawText) {
  const normalized = normalizeAiStudioRpcJson(rawText);
  if (!normalized) return null;

  try {
    const parsed = JSON.parse(normalized);
    const code = getNestedValue(parsed, [1, 0], null);
    const message = getNestedValue(parsed, [1, 1], null);

    if (typeof message === 'string' && message.trim()) {
      return {
        code: typeof code === 'number' ? code : undefined,
        message: message.trim(),
      };
    }
  } catch {
    // ignore parse failures
  }

  return null;
}

function isThinkingModelChunk(chunk) {
  if (!Array.isArray(chunk)) return false;

  // Observed structure for thinking chunks:
  // [null, "<thinking>", ..., 1]
  if (chunk.length >= 16 && chunk[15] === 1) return true;

  const last = chunk[chunk.length - 1];
  return chunk.length > 2 && last === 1;
}

function collectModelTextSegments(node, out) {
  if (!Array.isArray(node)) return;

  // Stream chunk patterns seen in GenerateContent response payload:
  //   [ [[null, "<chunk>"]], "model" ]
  //   [ [[[null, "<chunk>"]]], "model" ]
  if (node.length >= 2 && node[1] === 'model') {
    const payloadLevel2 = getNestedValue(node, [0, 0], null);
    const payloadLevel3 = getNestedValue(node, [0, 0, 0], null);

    const segment = typeof payloadLevel2?.[1] === 'string'
      ? payloadLevel2[1]
      : typeof payloadLevel3?.[1] === 'string'
        ? payloadLevel3[1]
        : null;

    if (typeof segment === 'string' && segment.length > 0) {
      out.push({
        text: segment,
        thinking: isThinkingModelChunk(payloadLevel2) || isThinkingModelChunk(payloadLevel3),
      });

      return;
    }
  }

  for (const child of node) {
    if (Array.isArray(child)) {
      collectModelTextSegments(child, out);
    }
  }
}

function extractFinalResponseText(value) {
  const text = String(value || '').trim();
  if (!text) return '';

  const lines = text.split(/\r?\n/);
  const headingIndex = lines.findIndex((line, index) => index > 0 && /^#{1,6}\s+/.test(String(line || '').trim()));

  if (headingIndex <= 0) {
    return text;
  }

  const preambleText = lines.slice(0, headingIndex).join('\n').trim();
  const finalText = lines.slice(headingIndex).join('\n').trim();

  if (!preambleText || !finalText) {
    return text;
  }

  const lower = preambleText.toLowerCase();
  // Heuristic can false-positive on conversational preambles when a heading follows.
  const looksLikeThinking =
    lower.includes('considering') ||
    lower.includes('focusing') ||
    lower.includes('reasoning') ||
    lower.includes("i'm") ||
    lower.includes('i am');

  return looksLikeThinking ? finalText : text;
}

function parseAiStudioGenerateContentText(rawText) {
  const normalized = normalizeAiStudioRpcJson(rawText);
  if (!normalized) return '';

  let parsed;
  try {
    parsed = JSON.parse(normalized);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid GenerateContent JSON (${normalized.length} chars): ${message}`, {
      cause: error,
    });
  }

  const segments = [];
  collectModelTextSegments(parsed, segments);

  const finalText = segments
    .filter((segment) => !segment.thinking)
    .map((segment) => segment.text)
    .join('')
    .trim();

  if (finalText) {
    return extractFinalResponseText(finalText);
  }

  const combinedText = segments
    .map((segment) => segment.text)
    .join('')
    .trim();

  return extractFinalResponseText(combinedText);
}

function extractGenerateEntries(entries) {
  if (!Array.isArray(entries)) return [];

  return entries
    .filter((entry) => {
      const url = String(entry?.url || '');
      return entry && typeof entry === 'object' && url.includes(GENERATE_CONTENT_URL_FRAGMENT);
    })
    .sort((a, b) => (a.ts || 0) - (b.ts || 0));
}

function extractLastUserPromptFromGenerateRequestBody(rawBody) {
  if (!rawBody || typeof rawBody !== 'string') return null;

  try {
    const parsed = JSON.parse(rawBody);
    const turns = Array.isArray(parsed?.[1]) ? parsed[1] : [];

    for (let i = turns.length - 1; i >= 0; i--) {
      const turn = turns[i];
      if (!Array.isArray(turn) || turn[1] !== 'user') continue;

      const prompt = getNestedValue(turn, [0, 0, 1], null);
      if (typeof prompt === 'string' && prompt.trim()) {
        return prompt.trim();
      }
    }
  } catch {
    // ignore parse failures
  }

  return null;
}

function doesGenerateEntryMatchPrompt(entry, expectedPrompt) {
  const expected = String(expectedPrompt || '').trim();
  if (!expected) return true;

  const requestBody = typeof entry?.requestBody === 'string' ? entry.requestBody : '';
  if (!requestBody) return false;

  const extractedPrompt = extractLastUserPromptFromGenerateRequestBody(requestBody);
  if (extractedPrompt) {
    return extractedPrompt === expected;
  }

  // Fallback heuristic if request body parsing fails
  const probe = expected.slice(0, 120);
  return probe.length > 0 && requestBody.includes(probe);
}

module.exports = {
  normalizeModelString,
  buildAiStudioUrl,
  getNestedValue,
  delay,
  buildClickDispatcher,
  cleanAiStudioResponse,
  hasRequiredCookies,
  extractModelKeywords,
  normalizeAiStudioRpcJson,
  parseAiStudioRpcError,
  isThinkingModelChunk,
  collectModelTextSegments,
  extractFinalResponseText,
  parseAiStudioGenerateContentText,
  extractGenerateEntries,
  extractLastUserPromptFromGenerateRequestBody,
  doesGenerateEntryMatchPrompt,
};
