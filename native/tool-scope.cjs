const path = require("path");

const PROVIDER_TOOLS = new Set([
  "chatgpt", "gemini", "perplexity", "grok", "kimi", "aistudio", "aistudio.build",
  "oracle.ask", "oracle.result", "oracle.cancel",
]);

const HOST_TOOLS = new Set([
  "wait",
  "session.list",
  "session.info",
  "tab.unname", "tabs_unregister", "tab.named", "tabs_list_named",
]);

const BROWSER_READ_TOOLS = new Set([
  "tab.list", "tabs_context", "list_tabs",
  "window.list",
  "history.list", "history.search",
  "bookmark.list",
  "downloads.search",
]);

const BROWSER_WRITE_TOOLS = new Set([
  "session.new", "session.ensure", "session.close", "session.rebind", "session.reopen",
  "tab.new", "new_tab", "tabs_create",
  "tab.move", "tab.switch", "switch_tab",
  "tab.group", "tab.ungroup",
  "window.new", "window.close", "window.focus", "window.resize",
  "smoke",
]);

const BROWSER_WRITE_TARGETED_TOOLS = new Set([
  "cookie.set", "cookie.clear", "cookie.clear-all",
  "bookmark.add", "bookmark.remove",
  "playbook.run",
]);

const TAB_TOOLS = new Set([
  "ai", "computer", "batch", "record", "animate-audit", "perf-audit",
  "navigate", "go", "back", "forward", "reload", "tab.reload",
  "screenshot", "snap", "resize",
  "page.read", "read_page", "page.text", "get_page_text", "page.html", "page.save", "page.state",
  "click", "left_click", "right_click", "double_click", "triple_click", "drag", "hover", "key", "submit",
  "type", "smart_type", "find_and_type", "form_input", "form.fill", "select", "upload", "upload_image",
  "scroll", "scroll.top", "scroll.bottom", "scroll.to", "scroll.info", "scroll_to_position",
  "search", "locate.role", "locate.text", "locate.label", "element.styles",
  "js", "javascript_tool", "eval",
  "wait.element", "wait.url", "wait.network", "wait.dom", "wait.load", "health",
  "frame.list", "frame.switch", "frame.main", "frame.js",
  "dialog.accept", "dialog.dismiss", "dialog.info",
  "console", "network", "network.get", "network.body", "network.curl", "network.path",
  "network.origins", "network.clear", "network.stats", "network.export",
  "emulate.network", "emulate.cpu", "emulate.geo", "emulate.device", "emulate.viewport", "emulate.touch",
  "perf.start", "perf.stop", "perf.metrics",
  "zoom", "cookie.list", "cookie.get",
  "tab.name", "tabs_register",
  "playbook.record.start", "playbook.record.stop", "playbook.record.status", "playbook.record.mark",
  "playbook.record.pause", "playbook.record.resume", "playbook.record.discard",
]);

function hasExplicitTabCloseTarget(args = {}) {
  return [args.id, args.tab_id, args.tabId, args.ids, args.tab_ids, args.tabIds]
    .some((value) => value !== undefined && value !== null && value !== "");
}

function classifyTool(tool, args = {}) {
  if (PROVIDER_TOOLS.has(tool) || tool.startsWith("oracle.")) {
    const hostOnly = tool === "oracle.result" || tool === "oracle.cancel" || tool === "oracle.status" || tool === "oracle.list";
    return hostOnly
      ? { scope: "host", targetUse: "host" }
      : { scope: "provider", targetUse: "default-tab" };
  }
  if (tool === "session.list") {
    return { scope: args.refresh ? "browser-read" : "host", targetUse: "host" };
  }
  if (tool === "session.info") {
    return { scope: args.refresh ? "browser-read" : "host", targetUse: "host" };
  }
  if (tool === "tab.close" || tool === "close_tab") {
    return hasExplicitTabCloseTarget(args)
      ? { scope: "browser-write", targetUse: "browser" }
      : { scope: "browser-write", targetUse: "default-tab" };
  }
  if (HOST_TOOLS.has(tool)) return { scope: "host", targetUse: "host" };
  if (BROWSER_READ_TOOLS.has(tool)) return { scope: "browser-read", targetUse: "browser" };
  if (BROWSER_WRITE_TARGETED_TOOLS.has(tool)) {
    return { scope: "browser-write", targetUse: "default-tab" };
  }
  if (BROWSER_WRITE_TOOLS.has(tool)) return { scope: "browser-write", targetUse: "browser" };
  if (TAB_TOOLS.has(tool)) {
    const resourceKeys = [];
    if (tool === "network.export" && typeof args.output === "string") resourceKeys.push(`file:${path.resolve(args.output)}`);
    if (tool.startsWith("playbook.record.")) resourceKeys.push("playbook-recorder");
    return { scope: "tab", targetUse: "default-tab", resourceKeys };
  }
  return { scope: "browser-write", targetUse: "browser", conservative: true };
}

module.exports = {
  BROWSER_READ_TOOLS,
  BROWSER_WRITE_TARGETED_TOOLS,
  BROWSER_WRITE_TOOLS,
  HOST_TOOLS,
  PROVIDER_TOOLS,
  TAB_TOOLS,
  classifyTool,
};
