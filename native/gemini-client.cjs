/**
 * Gemini Web Client for surf-cli
 * 
 * Cookie-based client for gemini.google.com (no API key required).
 * Adapted from Oracle's gemini-web module.
 */

const https = require("https");
const fs = require("fs");
const path = require("path");

// ============================================================================
// Constants
// ============================================================================

const GEMINI_APP_URL = "https://gemini.google.com/app";
const GEMINI_STREAM_GENERATE_URL = "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate";
const GEMINI_UPLOAD_URL = "https://content-push.googleapis.com/upload";
const GEMINI_UPLOAD_PUSH_ID = "feeds/mcudyrk2a4khkz";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const MODEL_HEADER_NAME = "x-goog-ext-525001261-jspb";
const MODEL_HEADERS = {
  "gemini-3-pro": '[1,null,null,null,"9d8ca3786ebdfbea",null,null,0,[4]]',
  "gemini-2.5-pro": '[1,null,null,null,"4af6c7f5da75d65d",null,null,0,[4]]',
  "gemini-2.5-flash": '[1,null,null,null,"9ec249fc9ad08861",null,null,0,[4]]',
};

const REQUIRED_COOKIES = ["__Secure-1PSID", "__Secure-1PSIDTS"];

const ALL_COOKIE_NAMES = [
  "__Secure-1PSID",
  "__Secure-1PSIDTS", 
  "__Secure-1PSIDCC",
  "__Secure-1PAPISID",
  "NID",
  "AEC",
  "SOCS",
  "__Secure-BUCKET",
  "__Secure-ENID",
  "SID",
  "HSID",
  "SSID",
  "APISID",
  "SAPISID",
  "__Secure-3PSID",
  "__Secure-3PSIDTS",
  "__Secure-3PAPISID",
  "SIDCC",
];

// ============================================================================
// Utility Functions
// ============================================================================

function getNestedValue(value, pathParts, fallback) {
  let current = value;
  for (const part of pathParts) {
    if (current == null) return fallback;
    if (typeof part === "number") {
      if (!Array.isArray(current)) return fallback;
      current = current[part];
    } else {
      if (typeof current !== "object") return fallback;
      current = current[part];
    }
  }
  return current ?? fallback;
}

function buildCookieHeader(cookieMap) {
  return Object.entries(cookieMap)
    .filter(([, value]) => typeof value === "string" && value.length > 0)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function buildCookieMap(cookies) {
  const cookieMap = {};
  for (const name of ALL_COOKIE_NAMES) {
    const cookie = cookies.find(c => c.name === name && c.value);
    if (cookie) {
      cookieMap[name] = cookie.value;
    }
  }
  return cookieMap;
}

function hasRequiredCookies(cookieMap) {
  return REQUIRED_COOKIES.every(name => Boolean(cookieMap[name]));
}

// ============================================================================
// HTTP Helpers
// ============================================================================

function httpsGet(url, headers, opts = {}) {
  const { binary = false, timeoutMs = 30000, log = null, label = "httpsGet" } = opts;
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: "GET",
      headers: {
        "user-agent": USER_AGENT,
        ...headers,
      },
      rejectUnauthorized: false, // Required for Gemini API
      timeout: timeoutMs,
    };

    const req = https.request(options, (res) => {
      if (log) log(`${label}: response ${res.statusCode} ${urlObj.hostname}${urlObj.pathname}`);
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => {
        const buffer = Buffer.concat(chunks);
        resolve({ 
          status: res.statusCode, 
          headers: res.headers, 
          text: binary ? null : buffer.toString("utf-8"),
          buffer: binary ? buffer : null,
        });
      });
      res.on("error", (err) => {
        if (log) log(`${label}: response error ${err.message}`);
        reject(err);
      });
    });

    req.on("timeout", () => {
      req.destroy(new Error(`${label}: request timeout after ${timeoutMs}ms`));
    });
    req.on("error", (err) => {
      if (log) log(`${label}: request error ${err.message}`);
      reject(err);
    });
    req.end();
  });
}

function httpsPost(url, headers, body, opts = {}) {
  return httpsSend("POST", url, headers, body, opts);
}

function httpsPut(url, headers, body, opts = {}) {
  return httpsSend("PUT", url, headers, body, opts);
}

function httpsSend(method, url, headers, body, opts = {}) {
  const { timeoutMs = 30000, log = null, label = "httpsSend" } = opts;
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const bodyBuffer = body == null
      ? null
      : Buffer.isBuffer(body)
        ? body
        : Buffer.from(String(body), "utf-8");
    const hasLength = Object.keys(headers || {}).some((key) => key.toLowerCase() === "content-length");
    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: {
        "user-agent": USER_AGENT,
        ...headers,
        ...(bodyBuffer && !hasLength ? { "content-length": String(bodyBuffer.length) } : {}),
      },
      rejectUnauthorized: false, // Required for Gemini API
      timeout: timeoutMs,
    };

    const req = https.request(options, (res) => {
      if (log) log(`${label}: response ${res.statusCode} ${urlObj.hostname}${urlObj.pathname}`);
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: data }));
      res.on("error", (err) => {
        if (log) log(`${label}: response error ${err.message}`);
        reject(err);
      });
    });

    req.on("timeout", () => {
      req.destroy(new Error(`${label}: request timeout after ${timeoutMs}ms`));
    });
    req.on("error", (err) => {
      if (log) log(`${label}: request error ${err.message}`);
      reject(err);
    });
    if (bodyBuffer) req.write(bodyBuffer);
    req.end();
  });
}

async function fetchWithRedirects(url, headers, maxRedirects = 10, binary = false, opts = {}) {
  let current = url;
  for (let i = 0; i <= maxRedirects; i++) {
    const res = await httpsGet(current, headers, { ...opts, binary, label: opts.label || "httpsGet" });
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      current = new URL(res.headers.location, current).toString();
      continue;
    }
    return res;
  }
  throw new Error(`Too many redirects (>${maxRedirects})`);
}

// ============================================================================
// Gemini API Functions
// ============================================================================

async function fetchGeminiAccessToken(cookieMap, opts = {}) {
  const cookieHeader = buildCookieHeader(cookieMap);
  const res = await fetchWithRedirects(GEMINI_APP_URL, { cookie: cookieHeader }, 10, false, {
    ...opts,
    label: opts.label || "geminiAccessToken",
  });
  const html = res.text;

  const tokens = ["SNlM0e", "thykhd"];
  for (const key of tokens) {
    const match = html.match(new RegExp(`"${key}":"(.*?)"`));
    if (match?.[1]) return match[1];
  }
  
  throw new Error("Unable to authenticate with Gemini. Make sure you're signed into gemini.google.com in Chrome.");
}

function trimGeminiJsonEnvelope(text) {
  // Handle streaming chunk format: )]}\n\n<size>\n<json>\n<size>\n<json>...
  const lines = text.split("\n");
  const chunks = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line === ")]}'" || /^\d+$/.test(line)) continue;
    if (line.startsWith("[")) {
      chunks.push(line);
    }
  }

  if (chunks.length > 1) {
    const merged = [];
    for (const chunk of chunks) {
      try {
        const parsed = JSON.parse(chunk);
        if (Array.isArray(parsed)) {
          merged.push(...parsed);
        }
      } catch {
        // ignore
      }
    }
    return JSON.stringify(merged);
  }

  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Gemini response did not contain a JSON payload.");
  }
  return text.slice(start, end + 1);
}

function extractErrorCode(responseJson) {
  const code = getNestedValue(responseJson, [0, 5, 2, 0, 1, 0], -1);
  return typeof code === "number" && code >= 0 ? code : undefined;
}

function isModelUnavailable(errorCode) {
  return errorCode === 1052;
}

function extractGgdlUrls(rawText) {
  const matches = rawText.match(/https:\/\/lh3\.googleusercontent\.com\/gg-dl\/[^\s"']+/g) ?? [];
  const seen = new Set();
  const urls = [];
  for (const match of matches) {
    if (seen.has(match)) continue;
    seen.add(match);
    urls.push(match);
  }
  return urls;
}

function ensureFullSizeImageUrl(url) {
  if (url.includes("=s")) return url; // Already has size parameter
  return `${url}=s2048`;
}

function parseGeminiStreamGenerateResponse(rawText) {
  const responseJson = JSON.parse(trimGeminiJsonEnvelope(rawText));
  const errorCode = extractErrorCode(responseJson);

  const parts = Array.isArray(responseJson) ? responseJson : [];
  let bodyIndex = 0;
  let body = null;
  
  for (let i = 0; i < parts.length; i++) {
    const partBody = getNestedValue(parts[i], [2], null);
    if (!partBody) continue;
    try {
      const parsed = JSON.parse(partBody);
      const candidateList = getNestedValue(parsed, [4], []);
      if (Array.isArray(candidateList) && candidateList.length > 0) {
        bodyIndex = i;
        body = parsed;
        break;
      }
    } catch {
      // ignore
    }
  }

  const candidateList = getNestedValue(body, [4], []);
  const firstCandidate = candidateList[0];
  const textRaw = getNestedValue(firstCandidate, [1, 0], "");
  const cardContent = /^http:\/\/googleusercontent\.com\/card_content\/\d+/.test(textRaw);
  const text = cardContent
    ? (getNestedValue(firstCandidate, [22, 0], null) ?? textRaw)
    : textRaw;
  const thoughts = getNestedValue(firstCandidate, [37, 0, 0], null);
  const metadata = getNestedValue(body, [1], []);

  const images = [];

  // Web images
  const webImages = getNestedValue(firstCandidate, [12, 1], []);
  for (const webImage of webImages) {
    const url = getNestedValue(webImage, [0, 0, 0], null);
    if (!url) continue;
    images.push({
      kind: "web",
      url,
      title: getNestedValue(webImage, [7, 0], undefined),
      alt: getNestedValue(webImage, [0, 4], undefined),
    });
  }

  // Generated images
  const hasGenerated = Boolean(getNestedValue(firstCandidate, [12, 7, 0], null));
  if (hasGenerated) {
    let imgBody = null;
    for (let i = bodyIndex; i < parts.length; i++) {
      const partBody = getNestedValue(parts[i], [2], null);
      if (!partBody) continue;
      try {
        const parsed = JSON.parse(partBody);
        const candidateImages = getNestedValue(parsed, [4, 0, 12, 7, 0], null);
        if (candidateImages != null) {
          imgBody = parsed;
          break;
        }
      } catch {
        // ignore
      }
    }

    const imgCandidate = getNestedValue(imgBody ?? body, [4, 0], null);
    const generated = getNestedValue(imgCandidate, [12, 7, 0], []);
    for (const genImage of generated) {
      const url = getNestedValue(genImage, [0, 3, 3], null);
      if (!url) continue;
      images.push({
        kind: "generated",
        url,
        title: "[Generated Image]",
        alt: "",
      });
    }
  }

  return { metadata, text, thoughts, images, errorCode };
}

// ============================================================================
// File Upload
// ============================================================================

async function uploadGeminiFile(filePath, cookieMap, opts = {}) {
  const absPath = path.resolve(process.cwd(), filePath);
  const data = fs.readFileSync(absPath);
  const fileName = path.basename(absPath);
  const cookieHeader = buildCookieHeader(cookieMap);

  // Step 1: Initiate resumable upload
  const initRes = await httpsPut(GEMINI_UPLOAD_URL, {
    "authorization": "Basic c2F2ZXM6cyNMdGhlNmxzd2F2b0RsN3J1d1U=",
    "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
    "cookie": cookieHeader,
    "push-id": GEMINI_UPLOAD_PUSH_ID,
    "referer": "https://gemini.google.com/",
    "x-goog-upload-command": "start",
    "x-goog-upload-header-content-length": String(data.length),
    "x-goog-upload-header-content-type": "application/octet-stream",
    "x-goog-upload-protocol": "resumable",
    "x-tenant-id": "bard-storage",
  }, data, { ...opts, label: opts.label || "geminiUploadInit" });

  const uploadId = initRes.headers["x-guploader-uploadid"];
  if (!uploadId) {
    throw new Error(`File upload init failed: no upload ID (${initRes.status})`);
  }

  // Step 2: Upload data and finalize
  const uploadUrl = `${GEMINI_UPLOAD_URL}?upload_id=${encodeURIComponent(uploadId)}&upload_protocol=resumable`;
  const finalRes = await httpsPut(uploadUrl, {
    "content-type": "application/octet-stream",
    "cookie": cookieHeader,
    "origin": "https://gemini.google.com",
    "referer": "https://gemini.google.com/",
    "x-goog-upload-command": "upload, finalize",
    "x-goog-upload-offset": "0",
    "x-tenant-id": "bard-storage",
  }, data, { ...opts, label: opts.label || "geminiUpload" });

  if (finalRes.status < 200 || finalRes.status >= 300) {
    throw new Error(`File upload failed: ${finalRes.status} (${finalRes.text.slice(0, 200)})`);
  }

  return { id: finalRes.text, name: fileName };
}

// ============================================================================
// Image Download
// ============================================================================

async function downloadGeminiImage(url, cookieMap, outputPath, opts = {}) {
  const cookieHeader = buildCookieHeader(cookieMap);
  const fullUrl = ensureFullSizeImageUrl(url);
  
  // Use binary mode for image download
  const res = await fetchWithRedirects(fullUrl, { cookie: cookieHeader }, 10, true, {
    ...opts,
    label: opts.label || "geminiImageDownload",
  });
  
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Failed to download image: ${res.status}`);
  }

  const dir = path.dirname(outputPath);
  if (dir && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  // Write binary buffer directly
  fs.writeFileSync(outputPath, res.buffer);
}

async function downloadGeminiImageViaExtension(url, outputPath, opts = {}) {
  const { fetchUrl, log } = opts;
  const fullUrl = ensureFullSizeImageUrl(url);
  
  const result = await fetchUrl(fullUrl);
  if (!result || result.error) throw new Error(`Image download failed: ${result?.error || "no response"}`);
  if (!result.b64) throw new Error("Image download returned no data");
  
  const dir = path.dirname(outputPath);
  if (dir && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  fs.writeFileSync(outputPath, Buffer.from(result.b64, "base64"));
}

async function saveFirstGeminiImage(output, cookieMap, outputPath, opts = {}) {
  const useExtensionDownload = !!opts.fetchUrl;
  const img = output.images?.find(i => i.kind === "generated") ?? output.images?.[0];

  if (img?.b64) {
    const dir = path.dirname(outputPath);
    if (dir && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(outputPath, Buffer.from(img.b64, "base64"));
    return { saved: true, imageCount: output.images.length };
  }

  if (img?.url) {
    if (useExtensionDownload) {
      await downloadGeminiImageViaExtension(img.url, outputPath, opts);
    } else {
      await downloadGeminiImage(img.url, cookieMap, outputPath, opts);
    }
    return { saved: true, imageCount: output.images.length };
  }

  const ggdl = extractGgdlUrls(output.rawResponseText || "");
  if (ggdl[0]) {
    if (useExtensionDownload) {
      await downloadGeminiImageViaExtension(ggdl[0], outputPath, opts);
    } else {
      await downloadGeminiImage(ggdl[0], cookieMap, outputPath, opts);
    }
    return { saved: true, imageCount: ggdl.length };
  }

  return { saved: false, imageCount: 0 };
}

// ============================================================================
// Core Request Function
// ============================================================================

function buildGeminiFReqPayload(prompt, uploaded, chatMetadata) {
  const promptPayload = uploaded.length > 0
    ? [prompt, 0, null, uploaded.map(file => [[file.id, 1], file.name])]
    : [prompt];

  const innerList = [promptPayload, null, chatMetadata ?? null];
  return JSON.stringify([null, JSON.stringify(innerList)]);
}

async function runGeminiWebOnce(input) {
  const { prompt, files, model, cookieMap, chatMetadata, timeoutMs = 30000, log = null } = input;
  const cookieHeader = buildCookieHeader(cookieMap);
  
  // 1. Get access token
  const at = await fetchGeminiAccessToken(cookieMap, { timeoutMs, log, label: "geminiAccessToken" });

  // 2. Upload files
  const uploaded = [];
  for (const file of files ?? []) {
    uploaded.push(await uploadGeminiFile(file, cookieMap, { timeoutMs, log, label: "geminiUpload" }));
  }

  // 3. Build request
  const fReq = buildGeminiFReqPayload(prompt, uploaded, chatMetadata);
  const params = new URLSearchParams();
  params.set("at", at);
  params.set("f.req", fReq);

  // 4. Send request
  const res = await httpsPost(GEMINI_STREAM_GENERATE_URL, {
    "content-type": "application/x-www-form-urlencoded;charset=utf-8",
    "host": "gemini.google.com",
    "origin": "https://gemini.google.com",
    "referer": "https://gemini.google.com/",
    "x-same-domain": "1",
    "cookie": cookieHeader,
    [MODEL_HEADER_NAME]: MODEL_HEADERS[model] || MODEL_HEADERS["gemini-3-pro"],
  }, params.toString(), { timeoutMs, log, label: "geminiStreamGenerate" });

  const rawResponseText = res.text;
  
  if (res.status < 200 || res.status >= 300) {
    return {
      rawResponseText,
      text: "",
      thoughts: null,
      metadata: chatMetadata ?? null,
      images: [],
      errorMessage: `Gemini request failed: ${res.status}`,
    };
  }

  try {
    const parsed = parseGeminiStreamGenerateResponse(rawResponseText);
    return {
      rawResponseText,
      text: parsed.text ?? "",
      thoughts: parsed.thoughts,
      metadata: parsed.metadata,
      images: parsed.images,
      errorCode: parsed.errorCode,
    };
  } catch (error) {
    let responseJson = null;
    try {
      responseJson = JSON.parse(trimGeminiJsonEnvelope(rawResponseText));
    } catch {
      responseJson = null;
    }
    const errorCode = extractErrorCode(responseJson);

    return {
      rawResponseText,
      text: "",
      thoughts: null,
      metadata: chatMetadata ?? null,
      images: [],
      errorCode: typeof errorCode === "number" ? errorCode : undefined,
      errorMessage: error instanceof Error ? error.message : String(error ?? ""),
    };
  }
}

async function runGeminiWebWithFallback(input) {
  const attempt = await runGeminiWebOnce(input);
  
  // Auto-fallback to flash if model unavailable
  if (isModelUnavailable(attempt.errorCode) && input.model !== "gemini-2.5-flash") {
    const fallback = await runGeminiWebOnce({ ...input, model: "gemini-2.5-flash" });
    return { ...fallback, effectiveModel: "gemini-2.5-flash" };
  }
  
  return { ...attempt, effectiveModel: input.model };
}

// ============================================================================
// In-Page Execution (for image generation)
// ============================================================================

async function runGeminiWebViaPage(input) {
  const { prompt, files, model, timeoutMs = 120000, log = null, createTab, closeTab, jsEval, fetchUrl, uploadFile } = input;

  if (!createTab || !closeTab || !jsEval) {
    throw new Error("In-page execution requires createTab, closeTab, and jsEval callbacks");
  }

  let tabId = null;
  try {
    if (log) log("Creating Gemini tab...");
    const tabResult = await createTab();
    tabId = tabResult?.tabId;
    if (!tabId) throw new Error("Failed to create Gemini tab");
    if (log) log(`Gemini tab created: ${tabId}`);
    await new Promise(r => setTimeout(r, 12000));

    if (files?.length && uploadFile) {
      const absFiles = files.map(f => path.resolve(process.cwd(), f));
      if (log) log(`Uploading ${absFiles.length} file(s) via file chooser...`);
      const result = await uploadFile(tabId, absFiles);
      if (result?.error) throw new Error(`File upload failed: ${result.error}`);
      if (log) log("File uploaded, waiting for processing...");
      await new Promise(r => setTimeout(r, 3000));
    }

    const checkJsResult = (result, context) => {
      if (result?.error) throw new Error(`${context}: ${result.error}`);
      if (result?.output === undefined) throw new Error(`${context}: no output`);
      return result.output;
    };

    // Type prompt
    const fullPrompt = prompt.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
    if (log) log("Typing prompt...");
    const typeResult = await jsEval(tabId, `
      const editor = document.querySelector('.ql-editor[contenteditable=true]');
      if (!editor) return JSON.stringify({ error: "No editor found on page" });
      editor.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, '${fullPrompt}');
      return JSON.stringify({ ok: true, len: editor.textContent.length });
    `);
    const typed = JSON.parse(JSON.parse(checkJsResult(typeResult, "Type prompt")));
    if (typed.error) throw new Error(typed.error);

    const beforeResult = await jsEval(tabId, `
      const imageKey = (img) => {
        const url = img.currentSrc || img.src || "";
        return url + "|" + img.naturalWidth + "x" + img.naturalHeight;
      };
      const baselineKeys = Array.from(document.images)
        .filter((img) => {
          const url = img.currentSrc || img.src || "";
          return img.naturalWidth >= 512
            && img.naturalHeight >= 512
            && (url.includes("gg-dl") || url.startsWith("blob:"));
        })
        .map(imageKey);
      return JSON.stringify(baselineKeys);
    `);
    const baselineImageKeys = JSON.parse(JSON.parse(checkJsResult(beforeResult, "Count images")) || "[]");

    if (log) log("Submitting...");
    const sendResult = await jsEval(tabId, `
      const btn = document.querySelector('button[aria-label="Send message"]');
      if (!btn) return 'no-btn';
      btn.click();
      return 'sent';
    `);
    const sendVal = JSON.parse(checkJsResult(sendResult, "Click send"));
    if (sendVal === "no-btn") throw new Error("Send button not found on Gemini page");

    // Poll for response
    if (log) log("Waiting for response...");
    const deadline = Date.now() + timeoutMs;
    let imageEntries = [];
    let responseText = "";

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 2000));
      const pollResult = await jsEval(tabId, `
        const baselineKeys = new Set(${JSON.stringify(baselineImageKeys)});
        const imageKey = (img) => {
          const url = img.currentSrc || img.src || "";
          return url + "|" + img.naturalWidth + "x" + img.naturalHeight;
        };
        const generatedImgs = Array.from(document.images)
          .filter((img) => {
            const url = img.currentSrc || img.src || "";
            return img.naturalWidth >= 512
              && img.naturalHeight >= 512
              && (url.includes("gg-dl") || url.startsWith("blob:"));
          })
          .filter((img) => !baselineKeys.has(imageKey(img)));
        window.__surfGeminiBlobImages = window.__surfGeminiBlobImages || [];
        window.__surfGeminiBlobImageIndexes = window.__surfGeminiBlobImageIndexes || Object.create(null);
        const images = await Promise.all(generatedImgs.map(async (img) => {
          const url = img.currentSrc || img.src || "";
          if (!url.startsWith("blob:")) return { url };
          const key = imageKey(img);
          if (Number.isInteger(window.__surfGeminiBlobImageIndexes[key])) {
            return { url, blobIndex: window.__surfGeminiBlobImageIndexes[key], type: "image/png" };
          }
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Canvas context unavailable");
          ctx.drawImage(img, 0, 0);
          const dataUrl = canvas.toDataURL("image/png");
          const blobIndex = window.__surfGeminiBlobImages.push({
            url,
            b64: dataUrl.split(",")[1],
            type: "image/png",
          }) - 1;
          window.__surfGeminiBlobImageIndexes[key] = blobIndex;
          return { url, blobIndex, type: "image/png" };
        }));
        const loading = !!document.querySelector('mat-progress-bar, .loading-indicator, message-loading');
        const turns = document.querySelectorAll('message-content');
        const lastTurn = turns.length ? turns[turns.length - 1] : null;
        const text = lastTurn ? lastTurn.textContent?.trim() : "";
        return JSON.stringify({ images, loading, text, turns: turns.length });
      `);
      const poll = JSON.parse(JSON.parse(checkJsResult(pollResult, "Poll response")));
      const newImgs = poll.images || [];

      if (newImgs.length > 0) {
        imageEntries = newImgs;
        responseText = poll.text || "";
        if (log) log(`Found ${newImgs.length} generated image(s)`);
        break;
      }
      if (!poll.loading && poll.text && poll.turns > 0) {
        responseText = poll.text;
        break;
      }
    }

    if (!imageEntries.length && !responseText) {
      throw new Error("Gemini response timed out");
    }

    // Download URL-backed images via extension; read blob images from the page in chunks.
    const images = [];
    for (const img of imageEntries) {
      if (Number.isInteger(img?.blobIndex)) {
        let b64 = "";
        let offset = 0;
        const chunkSize = 40000;
        let type = img.type || "image/png";
        while (true) {
          const chunkResult = await jsEval(tabId, `
            const item = window.__surfGeminiBlobImages?.[${img.blobIndex}];
            if (!item) return JSON.stringify({ error: "Blob image not found" });
            return JSON.stringify({
              chunk: item.b64.slice(${offset}, ${offset + chunkSize}),
              done: ${offset + chunkSize} >= item.b64.length,
              type: item.type || "image/png",
              url: item.url,
            });
          `);
          const chunk = JSON.parse(JSON.parse(checkJsResult(chunkResult, "Read blob image chunk")));
          if (chunk.error) throw new Error(chunk.error);
          b64 += chunk.chunk || "";
          type = chunk.type || type;
          if (chunk.done) break;
          offset += chunkSize;
        }
        images.push({ url: img.url, b64, type });
        continue;
      }
      if (img?.url && fetchUrl) {
        if (log) log(`Downloading image (${img.url.slice(0, 60)}...)...`);
        const dlResult = await fetchUrl(img.url);
        if (dlResult?.b64) {
          images.push({ url: img.url, b64: dlResult.b64, type: dlResult.type || "image/png" });
        }
      } else if (img?.url) {
        images.push({ url: img.url });
      }
    }

    return {
      text: responseText,
      thoughts: null,
      metadata: null,
      images,
      effectiveModel: model,
      _pageTabId: tabId,
    };
  } catch (err) {
    if (tabId) { try { await closeTab(tabId); } catch {} }
    throw err;
  }
}

// ============================================================================
// Main Query Function
// ============================================================================

async function query(options) {
  const {
    prompt,
    model = "gemini-3-pro",
    file,
    generateImage,
    editImage,
    output,
    youtube,
    aspectRatio,
    getCookies,
    createTab,
    closeTab,
    jsEval,
    fetchUrl,
    uploadFile,
    timeout = 300000,
    log = () => {},
  } = options;
  const hasPageCallbacks = !!(createTab && closeTab && jsEval);

  const startTime = Date.now();
  log("Starting Gemini query");

  // 1. Get cookies from Chrome
  const cookieResponse = await getCookies();
  const cookies = cookieResponse?.cookies;
  if (!Array.isArray(cookies)) {
    throw new Error("Failed to get cookies from Chrome. Make sure the extension is loaded and Chrome is running.");
  }
  const cookieMap = buildCookieMap(cookies);
  
  if (!hasRequiredCookies(cookieMap)) {
    throw new Error("Gemini login required. Sign into gemini.google.com in Chrome and try again.");
  }
  
  log(`Got ${Object.keys(cookieMap).length} Gemini cookies`);

  // 2. Resolve model
  const resolvedModel = MODEL_HEADERS[model] ? model : "gemini-3-pro";

  // 3. Build prompt
  let fullPrompt = prompt || "";
  if (aspectRatio && (generateImage || editImage)) {
    fullPrompt = `${fullPrompt} (aspect ratio: ${aspectRatio})`;
  }
  if (youtube) {
    fullPrompt = `${fullPrompt}\n\nYouTube video: ${youtube}`;
  }
  if (generateImage && !editImage) {
    fullPrompt = `Generate an image: ${fullPrompt}`;
  }

  // 4. Collect files
  const files = file ? [file] : [];

  // 5. Execute request
  let response;
  let imagePath = null;

  try {
    if (editImage) {
      // Image editing
      if (!hasPageCallbacks) {
        throw new Error("Image editing requires the Chrome extension. Make sure it's loaded.");
      }

      log("Uploading and editing image...");
      const out = await runGeminiWebViaPage({
        prompt: fullPrompt,
        files: [editImage],
        model: resolvedModel,
        timeoutMs: timeout,
        log,
        createTab,
        closeTab,
        jsEval,
        fetchUrl,
        uploadFile,
      });

      response = out;
      
      // Save output image
      const outputPath = output || generateImage || "edited.png";
      const saveOpts = { timeoutMs: timeout, log };
      if (fetchUrl) saveOpts.fetchUrl = fetchUrl;
      try {
        const imageSave = await saveFirstGeminiImage(out, cookieMap, outputPath, saveOpts);
        if (!imageSave.saved) {
          throw new Error(`No images generated. Response: ${out.text?.slice(0, 200) || "(empty)"}`);
        }
      } finally {
        if (out._pageTabId && closeTab) { try { await closeTab(out._pageTabId); } catch {} }
      }
      imagePath = outputPath;
      
    } else if (generateImage) {
      // Image generation
      log("Generating image...");
      let out;
      if (hasPageCallbacks) {
        out = await runGeminiWebViaPage({
          prompt: fullPrompt,
          model: resolvedModel,
          timeoutMs: timeout,
          log,
          createTab,
          closeTab,
          jsEval,
          fetchUrl,
        });
      } else {
        out = await runGeminiWebWithFallback({
          prompt: fullPrompt,
          files,
          model: resolvedModel,
          cookieMap,
          chatMetadata: null,
          timeoutMs: timeout,
          log,
        });
      }

      response = out;
      
      // Save output image
      const saveOpts = { timeoutMs: timeout, log };
      if (fetchUrl) saveOpts.fetchUrl = fetchUrl;
      try {
        const imageSave = await saveFirstGeminiImage(out, cookieMap, generateImage, saveOpts);
        if (!imageSave.saved) {
          throw new Error(`No images generated. Response: ${out.text?.slice(0, 200) || "(empty)"}`);
        }
      } finally {
        if (out._pageTabId && closeTab) { try { await closeTab(out._pageTabId); } catch {} }
      }
      imagePath = generateImage;
      
    } else {
      // Text query
      log("Sending text query...");
      const out = await runGeminiWebWithFallback({
        prompt: fullPrompt,
        files,
        model: resolvedModel,
        cookieMap,
        chatMetadata: null,
        timeoutMs: timeout,
        log,
      });

      response = out;
    }
  } catch (error) {
    throw new Error(`Gemini request failed: ${error.message}`);
  }

  const tookMs = Date.now() - startTime;
  log(`Completed in ${tookMs}ms`);

  return {
    response: response.text || "",
    model: response.effectiveModel || resolvedModel,
    tookMs,
    imagePath,
    thoughts: response.thoughts,
    imageCount: response.images?.length || 0,
  };
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  query,
  hasRequiredCookies,
  buildCookieMap,
  parseGeminiStreamGenerateResponse,
  runGeminiWebViaPage,
  REQUIRED_COOKIES,
  ALL_COOKIE_NAMES,
  GEMINI_APP_URL,
};
