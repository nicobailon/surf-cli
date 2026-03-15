"use strict";
/**
 * AI Studio response extraction for surf-cli
 *
 * Two extraction strategies:
 *   1. Network-first: intercept GenerateContent RPC responses (structured, reliable)
 *   2. DOM fallback: walk the page DOM for rendered response text (when network fails)
 */

const {
  cleanAiStudioResponse,
  delay,
  parseAiStudioRpcError,
  parseAiStudioGenerateContentText,
  extractGenerateEntries,
  doesGenerateEntryMatchPrompt,
} = require("./aistudio-parser.cjs");

async function evaluate(cdp, expression) {
  const result = await cdp(expression);
  if (result.exceptionDetails) {
    const desc = result.exceptionDetails.exception?.description ||
                 result.exceptionDetails.text ||
                 "Evaluation failed";
    throw new Error(desc);
  }
  if (result.error) {
    throw new Error(result.error);
  }
  return result.result?.value;
}

async function waitForGenerateResponseFromNetwork(params) {
  const {
    tabId,
    readNetworkEntries,
    timeoutMs = 300000,
    baselineEntryIds = new Set(),
    prompt = '',
    log = () => {},
  } = params;

  const deadline = Date.now() + timeoutMs;
  let lastSeenCount = -1;
  const parseErrorCounts = new Map();

  while (Date.now() < deadline) {
    const network = await readNetworkEntries(tabId);

    if (network?.error) {
      throw new Error(String(network.error));
    }

    const allEntries = Array.isArray(network?.entries)
      ? network.entries
      : Array.isArray(network?.requests)
        ? network.requests
        : [];

    const generateEntries = extractGenerateEntries(allEntries);

    if (generateEntries.length !== lastSeenCount) {
      lastSeenCount = generateEntries.length;
      log(`GenerateContent network entries seen: ${generateEntries.length}`);
    }

    const freshEntries = generateEntries.filter((entry) => !baselineEntryIds.has(entry.id));

    for (const entry of freshEntries) {
      if (!doesGenerateEntryMatchPrompt(entry, prompt)) {
        log(`Skipping GenerateContent entry ${entry?.id || 'unknown'} (prompt mismatch)`);
        continue;
      }

      const status = Number(entry?.status || 0);
      const body = typeof entry?.responseBody === 'string' ? entry.responseBody : '';

      if (status >= 400) {
        const rpcError = parseAiStudioRpcError(body);
        const msg = rpcError?.message || `HTTP ${status}`;
        throw new Error(`AI Studio GenerateContent failed (${status}): ${msg}`);
      }

      if (status !== 200 || !body) {
        continue;
      }

      let parsedText = '';
      try {
        parsedText = parseAiStudioGenerateContentText(body);
      } catch (e) {
        const requestId = entry.id || 'unknown';
        const parseErrorCount = (parseErrorCounts.get(requestId) || 0) + 1;
        parseErrorCounts.set(requestId, parseErrorCount);

        log(`GenerateContent parse error (${requestId} #${parseErrorCount}): ${e.message || e}`);

        if (parseErrorCount >= 3) {
          throw new Error(`GenerateContent body for ${requestId} is not parseable; falling back to DOM`);
        }

        continue;
      }

      if (parsedText && parsedText.length > 0) {
        return {
          text: parsedText,
          requestId: entry.id,
          status,
        };
      }
    }

    await delay(350);
  }

  throw new Error('Timed out waiting for AI Studio GenerateContent network response');
}

async function waitForResponse(cdp, timeoutMs = 300000, userPrompt = '', log = () => {}) {
  const deadline = Date.now() + timeoutMs;

  await delay(1000);

  let doneStreak = 0;

  while (Date.now() < deadline) {
    const status = await evaluate(cdp, `(function() {
      var buttons = Array.from(document.querySelectorAll('button'));

      var bodyText = (document.body && document.body.innerText ? document.body.innerText : '').toLowerCase();

      var rateLimitMsg = null;
      if (bodyText.indexOf("you've reached your rate limit") !== -1) {
        rateLimitMsg = "You've reached your rate limit. Please try again later.";
      } else if (bodyText.indexOf('failed to generate content: user has exceeded quota') !== -1) {
        rateLimitMsg = "Failed to generate content: user has exceeded quota. Please try again later.";
      }
      var rateLimited = rateLimitMsg !== null;

      var hasRatingBtns = buttons.some(function(b) {
        return (b.getAttribute('aria-label') || b.textContent || '').toLowerCase().indexOf('good response') !== -1;
      });

      var hasStopBtn = buttons.some(function(b) {
        var label = (b.getAttribute('aria-label') || '').toLowerCase();
        var text = (b.textContent || '').toLowerCase();
        return text.indexOf('stop') !== -1 || label.indexOf('stop') !== -1 || text.indexOf('running') !== -1;
      });

      return {
        done: hasRatingBtns && !hasStopBtn,
        hasStopBtn: hasStopBtn,
        rateLimited: rateLimited,
        rateLimitMsg: rateLimitMsg
      };
    })()`);

    if (status && status.rateLimited) {
      const msg = status.rateLimitMsg || "You've reached your rate limit. Please try again later.";
      throw new Error(
        `AI Studio rate limited: ${msg} ` +
        "(Tip: use `surf gemini` / another provider as a fallback.)"
      );
    }

    if (status && status.done) {
      doneStreak++;
      if (doneStreak === 1) {
        log("Completion signal detected (waiting for stability...)");
      }
      if (doneStreak >= 3) {
        log("Completion signal stable");
        break;
      }
    } else {
      doneStreak = 0;
    }

    await delay(500);
  }

  if (Date.now() >= deadline) {
    throw new Error("Response timeout - AI Studio did not complete in time");
  }

  await delay(800);

  const extractScript = `(function() {
    function stripUi(text) {
      if (!text) return '';

      var removeLabels = ['Edit', 'Rerun this turn', 'Open options', 'Good response', 'Bad response'];
      var removeSet = {};
      for (var i = 0; i < removeLabels.length; i++) {
        removeSet[String(removeLabels[i]).toLowerCase()] = true;
      }

      var lines = String(text).split(/\\r?\\n/);
      var kept = [];

      for (var j = 0; j < lines.length; j++) {
        var line = lines[j];
        var trimmed = (line || '').trim();
        if (!trimmed) {
          kept.push('');
          continue;
        }

        if (removeSet[trimmed.toLowerCase()]) continue;
        kept.push(line);
      }

      return kept.join('\\n').trim();
    }

    var buttons = Array.from(document.querySelectorAll('button'));
    var goodBtn = buttons.find(function(b) {
      return (b.getAttribute('aria-label') || b.textContent || '').toLowerCase().indexOf('good response') !== -1;
    });

    if (goodBtn) {
      var container = goodBtn.parentElement;
      while (container && container !== document.body) {
        try {
          var big = Array.from(container.querySelectorAll('[class*="very-large-text-container"]'));
          if (big && big.length) {
            var t = (big[big.length - 1].innerText || '').trim();
            if (t && t.length > 10) {
              return { text: stripUi(t), method: 'good-btn-large-container' };
            }
          }
        } catch {}

        var text = (container.innerText || '').trim();
        if (text.length > 50) {
          var cleaned = stripUi(text);
          if (cleaned.length > 20) {
            return { text: cleaned, method: 'good-btn-walk' };
          }
        }
        container = container.parentElement;
      }
    }

    var big2 = Array.from(document.querySelectorAll('[class*="very-large-text-container"]'));
    if (big2 && big2.length) {
      for (var j = big2.length - 1; j >= 0; j--) {
        var tt = (big2[j].innerText || '').trim();
        var ll = tt.toLowerCase();
        if (tt.length > 50 && ll.indexOf('google ai studio uses cookies') === -1) {
          return { text: stripUi(tt), method: 'very-large-text-container' };
        }
      }
    }

    var promptInput = document.querySelector('[role="textbox"][placeholder*="prompt" i], textarea[placeholder*="prompt" i]');
    if (promptInput) {
      var parent = promptInput.parentElement;
      while (parent && parent !== document.body) {
        var siblings = parent.parentElement ? Array.from(parent.parentElement.children) : [];
        var myIdx = siblings.indexOf(parent);
        for (var s = 0; s < myIdx; s++) {
          var sibText = (siblings[s].innerText || '').trim();
          if (sibText.length > 50) {
            return { text: stripUi(sibText), method: 'sibling-walk' };
          }
        }
        parent = parent.parentElement;
      }
    }

    return { text: document.body.innerText || '', method: 'body-fallback' };
  })()`;

  let bestText = '';
  let bestRaw = '';
  let bestExtracted = null;
  let lastText = null;
  let stableCount = 0;

  const extractDeadline = Math.min(deadline, Date.now() + 15000);

  while (Date.now() < extractDeadline) {
    const extracted = await evaluate(cdp, extractScript);
    const responseTextRaw = extracted
      ? String(extracted.text || '').trim()
      : '';
    const responseText = cleanAiStudioResponse(responseTextRaw, userPrompt);

    if (responseText.length > bestText.length) {
      bestText = responseText;
      bestRaw = responseTextRaw;
      bestExtracted = extracted;
    }

    if (lastText !== null && responseText === lastText && responseText.length > 5) {
      stableCount++;
      if (stableCount >= 2) {
        log(
          'Extraction stabilized: method=' + (extracted ? extracted.method : 'none') +
          ', raw length=' + responseTextRaw.length +
          ', cleaned length=' + responseText.length
        );
        return {
          text: responseText,
          thinkingTime: null,
        };
      }
    } else {
      stableCount = 0;
      lastText = responseText;
    }

    await delay(700);
  }

  log(
    'Extraction not stable before deadline; returning best length=' + bestText.length +
    ', raw length=' + bestRaw.length +
    ', method=' + (bestExtracted ? bestExtracted.method : 'none')
  );

  if (!bestText || bestText.length < 5) {
    throw new Error('Could not extract response text from AI Studio');
  }

  return {
    text: bestText,
    thinkingTime: null,
  };
}

module.exports = {
  waitForGenerateResponseFromNetwork,
  waitForResponse,
};
