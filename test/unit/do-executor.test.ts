import { describe, expect, it, vi } from "vitest";

// @ts-expect-error - CommonJS module without type definitions
import * as executor from "../../native/do-executor.cjs";

describe("shouldAutoWait", () => {
  it("returns true for navigation commands", () => {
    expect(executor.shouldAutoWait("go")).toBe(true);
    expect(executor.shouldAutoWait("navigate")).toBe(true);
    expect(executor.shouldAutoWait("back")).toBe(true);
    expect(executor.shouldAutoWait("forward")).toBe(true);
  });

  it("returns true for interaction commands", () => {
    expect(executor.shouldAutoWait("click")).toBe(true);
    expect(executor.shouldAutoWait("key")).toBe(true);
    expect(executor.shouldAutoWait("form.fill")).toBe(true);
    expect(executor.shouldAutoWait("submit")).toBe(true);
  });

  it("returns false for type (no DOM changes expected)", () => {
    expect(executor.shouldAutoWait("type")).toBe(false);
  });

  it("returns true for tab commands", () => {
    expect(executor.shouldAutoWait("tab.switch")).toBe(true);
    expect(executor.shouldAutoWait("tab.new")).toBe(true);
  });

  it("returns false for read-only commands", () => {
    expect(executor.shouldAutoWait("screenshot")).toBe(false);
    expect(executor.shouldAutoWait("page.read")).toBe(false);
    expect(executor.shouldAutoWait("tab.list")).toBe(false);
    expect(executor.shouldAutoWait("ai")).toBe(false);
  });
});

describe("getAutoWaitCommand", () => {
  it("returns wait.load for navigation", () => {
    expect(executor.getAutoWaitCommand("navigate")).toBe("wait.load");
    expect(executor.getAutoWaitCommand("go")).toBe("wait.load");
    expect(executor.getAutoWaitCommand("back")).toBe("wait.load");
    expect(executor.getAutoWaitCommand("forward")).toBe("wait.load");
  });

  it("returns wait.dom for click", () => {
    expect(executor.getAutoWaitCommand("click")).toBe("wait.dom");
  });

  it("returns wait.load for submit", () => {
    expect(executor.getAutoWaitCommand("submit")).toBe("wait.load");
  });

  it("returns null for type", () => {
    expect(executor.getAutoWaitCommand("type")).toBe(null);
  });

  it("returns wait.load for tab commands", () => {
    expect(executor.getAutoWaitCommand("tab.switch")).toBe("wait.load");
    expect(executor.getAutoWaitCommand("tab.new")).toBe("wait.load");
  });

  it("returns null for unknown commands", () => {
    expect(executor.getAutoWaitCommand("screenshot")).toBe(null);
    expect(executor.getAutoWaitCommand("page.read")).toBe(null);
  });
});

describe("substituteVars", () => {
  it("substitutes variables in strings", () => {
    const args = { url: "https://%{domain}/path" };
    const vars = { domain: "example.com" };
    const result = executor.substituteVars(args, vars);
    expect(result.url).toBe("https://example.com/path");
  });

  it("keeps undefined variables as-is", () => {
    const args = { url: "https://%{domain}/path" };
    const vars = {};
    const result = executor.substituteVars(args, vars);
    expect(result.url).toBe("https://%{domain}/path");
  });

  it("handles multiple variables", () => {
    const args = { text: "%{greeting} %{name}!" };
    const vars = { greeting: "Hello", name: "World" };
    const result = executor.substituteVars(args, vars);
    expect(result.text).toBe("Hello World!");
  });

  it("preserves non-string values", () => {
    const args = { x: 100, enabled: true, text: "%{val}" };
    const vars = { val: "test" };
    const result = executor.substituteVars(args, vars);
    expect(result.x).toBe(100);
    expect(result.enabled).toBe(true);
    expect(result.text).toBe("test");
  });

  it("handles null and undefined args", () => {
    expect(executor.substituteVars(null, {})).toBe(null);
    expect(executor.substituteVars(undefined, {})).toBe(undefined);
  });
});

describe("AUTO_WAIT_COMMANDS", () => {
  it("includes expected commands", () => {
    expect(executor.AUTO_WAIT_COMMANDS).toContain("go");
    expect(executor.AUTO_WAIT_COMMANDS).toContain("navigate");
    expect(executor.AUTO_WAIT_COMMANDS).toContain("click");
    expect(executor.AUTO_WAIT_COMMANDS).toContain("key");
  });

  it("excludes type (typing doesn't trigger waits)", () => {
    expect(executor.AUTO_WAIT_COMMANDS).not.toContain("type");
  });
});

describe("AUTO_WAIT_MAP", () => {
  it("maps navigation to wait.load", () => {
    expect(executor.AUTO_WAIT_MAP.navigate).toBe("wait.load");
    expect(executor.AUTO_WAIT_MAP.go).toBe("wait.load");
  });

  it("maps click to wait.dom", () => {
    expect(executor.AUTO_WAIT_MAP.click).toBe("wait.dom");
  });

  it("does not include type (not an auto-wait command)", () => {
    expect(executor.AUTO_WAIT_MAP.type).toBeUndefined();
  });
});

describe("do executor semantic dispatch", () => {
  it("pins semantic follow-up requests while preserving admission and the shared transport", async () => {
    const transport = { request: vi.fn(async () => ({ result: { content: [] } })) };
    const context = executor.semanticRequestContext(
      { session: "checkout", windowId: 8, transport, admission: { wait: false } },
      1_234,
      { tabId: 42 },
    );
    expect(context).toEqual({
      session: undefined,
      windowId: undefined,
      tabId: 42,
      timeoutMs: 1_234,
      admission: { wait: false },
      transport,
    });
    await executor.sendDoRequest("page.read", {}, context);
    expect(transport.request).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 42, admission: { wait: false } }),
      1_234,
      expect.anything(),
    );
  });

  it("lazily creates the semantic executor and never forwards semantic.step to executeTool", async () => {
    const executeTool = vi.fn();
    const semanticExecutor = vi.fn(async () => ({ status: "completed" }));
    const createSemanticExecutor = vi.fn(async () => semanticExecutor);

    const ordinary = await executor.executeDoSteps([{ cmd: "page.read", args: {} }], {
      executeTool,
      createSemanticExecutor,
      quiet: true,
      stepDelay: 0,
    });
    expect(ordinary.status).toBe("completed");
    expect(createSemanticExecutor).not.toHaveBeenCalled();

    const semantic = await executor.executeDoSteps(
      [{ id: "find", cmd: "semantic.step", args: { op: "find", target: { query: "x" } } }],
      { executeTool, createSemanticExecutor, quiet: true, stepDelay: 0 },
    );
    expect(semantic.status).toBe("completed");
    expect(createSemanticExecutor).toHaveBeenCalledOnce();
    expect(semanticExecutor).toHaveBeenCalledOnce();
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool).not.toHaveBeenCalledWith(
      "semantic.step",
      expect.anything(),
      expect.anything(),
    );
  });
});
