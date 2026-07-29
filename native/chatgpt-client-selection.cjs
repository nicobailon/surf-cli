const CHATGPT_EFFORT_CHOICES = ["light", "standard", "extended", "heavy"];

function normalizeChatGPTModelChoice(desiredModel) {
  const normalized = String(desiredModel || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  if (["instant", "gpt53"].includes(normalized)) return "instant";
  if (["thinking", "gpt54thinking"].includes(normalized)) return "thinking";
  if (["pro", "gpt54pro"].includes(normalized)) return "pro";

  return normalized;
}

function normalizeChatGPTEffortChoice(desiredEffort) {
  const normalized = String(desiredEffort || "").toLowerCase().trim();
  return CHATGPT_EFFORT_CHOICES.includes(normalized) ? normalized : null;
}

function normalizedWords(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function modelCandidateMatches(item, targetModel) {
  const values = [item?.label, item?.testId?.replace(/^model-switcher-/, "")].filter(Boolean);
  return values.some((value) => {
    if (normalizeChatGPTModelChoice(value) === targetModel) return true;
    const variants = ["instant", "thinking", "pro"].filter((variant) =>
      normalizedWords(value).includes(variant),
    );
    return variants.length === 1 && variants[0] === targetModel;
  });
}

function effortCandidateMatches(item, targetEffort) {
  const variants = new Set(
    [item?.label, item?.testId]
      .flatMap((value) => normalizedWords(value))
      .filter((word) => CHATGPT_EFFORT_CHOICES.includes(word)),
  );
  return variants.size === 1 && variants.has(targetEffort);
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
      item?.role === "menuitemradio" &&
      typeof item?.testId === "string" &&
      item.testId.startsWith("model-switcher-") &&
      modelCandidateMatches(item, targetModel),
  );
}

function verifyChatGPTModelSelection(items, desiredModel) {
  const targetModel = normalizeChatGPTModelChoice(desiredModel);
  if (!targetModel) return null;
  return uniqueMatch(
    items,
    (item) =>
      (typeof item?.label === "string" || typeof item?.testId === "string") &&
      modelCandidateMatches(item, targetModel),
  );
}

function resolveChatGPTEffortMenuOption(items, desiredEffort) {
  const targetEffort = normalizeChatGPTEffortChoice(desiredEffort);
  if (!targetEffort) return null;
  return uniqueMatch(
    items,
    (item) =>
      ["button", "menuitem", "menuitemradio"].includes(item?.role) &&
      effortCandidateMatches(item, targetEffort),
  );
}

function verifyChatGPTEffortSelection(items, desiredEffort) {
  const targetEffort = normalizeChatGPTEffortChoice(desiredEffort);
  if (!targetEffort) return null;
  return uniqueMatch(
    items,
    (item) =>
      (typeof item?.label === "string" || typeof item?.testId === "string") &&
      effortCandidateMatches(item, targetEffort),
  );
}

function boundedOptionLabels(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => String(item?.label || "").replace(/\s+/g, " ").trim().slice(0, 80))
    .filter(Boolean)
    .filter((label, index, labels) => labels.indexOf(label) === index)
    .slice(0, 10);
}

module.exports = {
  CHATGPT_EFFORT_CHOICES,
  boundedOptionLabels,
  normalizeChatGPTEffortChoice,
  normalizeChatGPTModelChoice,
  resolveChatGPTEffortMenuOption,
  resolveChatGPTModelMenuOption,
  verifyChatGPTEffortSelection,
  verifyChatGPTModelSelection,
};
