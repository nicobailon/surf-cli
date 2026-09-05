const CHATGPT_EFFORT_CHOICES = ["instant", "medium", "high", "xhigh", "pro"];
const CHATGPT_EFFORT_VALUE = new Map([
  ["instant", 0],
  ["medium", 1],
  ["high", 2],
  ["xhigh", 3],
  ["pro", 4],
]);

const CHATGPT_MODEL_ALIASES = new Map([
  ["latest", "latest"],
  ["gpt6", "gpt6astra"],
  ["chatgpt6", "gpt6astra"],
  ["gpt6astra", "gpt6astra"],
  ["chatgpt6astra", "gpt6astra"],
  ["6", "gpt6astra"],
  ["55", "gpt55"],
  ["gpt55", "gpt55"],
  ["chatgpt55", "gpt55"],
  ["56sol", "gpt56sol"],
  ["gpt56sol", "gpt56sol"],
  ["chatgpt56sol", "gpt56sol"],
]);

const CHATGPT_EFFORT_ALIASES = new Map([
  ["instant", "instant"],
  ["medium", "medium"],
  ["high", "high"],
  ["xhigh", "xhigh"],
  ["extrahigh", "xhigh"],
  ["pro", "pro"],
]);

function normalizeChatGPTModelChoice(desiredModel) {
  const normalized = String(desiredModel || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  return CHATGPT_MODEL_ALIASES.get(normalized) || normalized;
}

function normalizeChatGPTEffortChoice(desiredEffort) {
  const normalized = String(desiredEffort || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return CHATGPT_EFFORT_ALIASES.get(normalized) || null;
}

function normalizedWords(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function normalizedText(value) {
  return normalizedWords(value).join(" ");
}

function modelKeyFromValue(value) {
  const text = normalizedText(value);
  if (!text) return null;
  if (/^latest$/.test(text)) return "latest";
  if (/\b5\.6\b/.test(text) && /\bsol\b/.test(text)) return "gpt56sol";
  if (/\b5\.5\b/.test(text)) return "gpt55";
  if (/\bgpt\s*6\b/.test(text) || /\bchatgpt\s*6\b/.test(text) || /^6(?:\s|$)/.test(text)) {
    return "gpt6astra";
  }
  return null;
}

function modelCandidateMatches(item, targetModel) {
  if (item?.modelKey === targetModel) return true;
  const values = [item?.label, item?.displayLabel, item?.testId?.replace(/^model-switcher-/, "")]
    .filter(Boolean);
  return values.some((value) => modelKeyFromValue(value) === targetModel);
}

function modelSelectableCandidateMatches(item, targetModel) {
  if (modelCandidateMatches(item, targetModel)) return true;
  if (targetModel === "gpt6astra") {
    return [item?.label, item?.displayLabel].filter(Boolean).some((value) => modelKeyFromValue(value) === "latest");
  }
  return false;
}

function effortKeyFromValue(value) {
  const text = normalizedText(value);
  if (!text) return null;
  if (/\bextra\s+high\b/.test(text) || /\bxhigh\b/.test(text)) return "xhigh";
  if (/\binstant\b/.test(text)) return "instant";
  if (/\bmedium\b/.test(text)) return "medium";
  if (/\bhigh\b/.test(text)) return "high";
  if (/\bpro\b/.test(text)) return "pro";
  return null;
}

function effortCandidateMatches(item, targetEffort) {
  const labelKey = item?.effortKey || effortKeyFromValue(item?.label || item?.displayLabel);
  if (!labelKey || labelKey !== targetEffort) return false;
  if (item?.value === undefined || item?.value === null) return true;
  return Number(item.value) === CHATGPT_EFFORT_VALUE.get(targetEffort);
}

function uniqueMatch(items, matches) {
  if (!Array.isArray(items)) return null;
  const candidates = items.filter(matches);
  return candidates.length === 1 ? candidates[0] : null;
}

function resolveChatGPTModelMenuOption(items, desiredModel) {
  const targetModel = normalizeChatGPTModelChoice(desiredModel);
  if (!targetModel) return null;
  return uniqueMatch(
    items,
    (item) =>
      ["button", "menuitem", "menuitemradio", "radio"].includes(item?.role) &&
      modelSelectableCandidateMatches(item, targetModel),
  );
}

function verifyChatGPTModelSelection(items, desiredModel) {
  const targetModel = normalizeChatGPTModelChoice(desiredModel);
  if (!targetModel) return null;
  return uniqueMatch(
    items,
    (item) =>
      (!["menuitemradio", "radio"].includes(item?.role) || item.selected === true) &&
      (typeof item?.label === "string" || typeof item?.displayLabel === "string" || typeof item?.testId === "string") &&
      modelCandidateMatches(item, targetModel),
  );
}

function resolveChatGPTEffortMenuOption(items, desiredEffort) {
  const targetEffort = normalizeChatGPTEffortChoice(desiredEffort);
  if (!targetEffort) return null;
  return uniqueMatch(
    items,
    (item) =>
      ["slider", "button", "menuitem", "menuitemradio"].includes(item?.role) &&
      effortCandidateMatches(item, targetEffort),
  );
}

function verifyChatGPTEffortSelection(items, desiredEffort) {
  const targetEffort = normalizeChatGPTEffortChoice(desiredEffort);
  if (!targetEffort) return null;
  return uniqueMatch(
    items,
    (item) =>
      (typeof item?.label === "string" || typeof item?.displayLabel === "string" || typeof item?.testId === "string") &&
      effortCandidateMatches(item, targetEffort),
  );
}

function boundedOptionLabels(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => String(item?.displayLabel || item?.label || "").replace(/\s+/g, " ").trim().slice(0, 80))
    .filter(Boolean)
    .filter((label, index, labels) => labels.indexOf(label) === index)
    .slice(0, 10);
}

module.exports = {
  CHATGPT_EFFORT_CHOICES,
  CHATGPT_EFFORT_VALUE,
  boundedOptionLabels,
  normalizeChatGPTEffortChoice,
  normalizeChatGPTModelChoice,
  resolveChatGPTEffortMenuOption,
  resolveChatGPTModelMenuOption,
  verifyChatGPTEffortSelection,
  verifyChatGPTModelSelection,
};
