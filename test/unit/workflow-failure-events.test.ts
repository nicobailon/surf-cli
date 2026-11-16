// A failed workflow step's events go to the activity journal and the active record. Neither may hold
// an env value the run resolved or the text a step typed, even when the step's error quotes them.
import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const runtime = require("../../native/workflow-runtime.cjs");
const playbookRuntime = require("../../native/playbook-runtime.cjs");
const { appendActivity } = require("../../native/activity-journal.cjs");
const records = require("../../native/playbook-records.cjs");

// Dummy values, built from parts so no literal here reads as a credential.
const TYPED = ["dummy", "typed", "pw", "7"].join("-");
const ENV_VALUE = ["dummy", "env", "value", "7"].join("-");

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function stateRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "surf-failure-events-"));
  roots.push(root);
  return root;
}

function filesUnder(root: string): string[] {
  return fs
    .readdirSync(root, { recursive: true })
    .map((name: string) => path.join(root, name))
    .filter((file: string) => fs.statSync(file).isFile());
}

describe("a failed workflow step's events", () => {
  it("keep the typed text out of tool.failed and the step's error", async () => {
    const events: Array<Record<string, unknown>> = [];
    const result = await runtime.executeSingleStep(
      { cmd: "type", args: { text: "%{password}" } },
      { password: TYPED },
      {
        executeTool: async () => ({ error: `could not type "${TYPED}" into #password` }),
        onEvent: (event: Record<string, unknown>) => events.push(event),
        stepDelay: 0,
      },
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe('could not type "<redacted>" into #password');
    expect(JSON.stringify(events)).not.toContain(TYPED);
    expect(events.find((event) => event.type === "tool.failed")?.resultSummary).toBe(
      'could not type "<redacted>" into #password',
    );
  });

  it("keep env values and typed text out of every file a playbook run writes", async () => {
    const root = stateRoot();
    records.startRecord({ site: "shop", op: "login", tabId: 1, root });
    const report = (event: Record<string, unknown>) => {
      appendActivity(event, { root });
      records.appendRecordEvent(event, { target: { tabId: 1 }, root });
    };
    const op = {
      id: "login",
      effect: "read",
      args: { password: { type: "string", required: true } },
      run: [
        {
          using: "network",
          request: {
            method: "GET",
            url: "https://shop.test/session",
            authInputs: [{ env: "SURF_TEST_SITE_KEY", header: "X-Site-Key" }],
          },
        },
        { using: "workflow", steps: [{ cmd: "type", args: { text: "{{password}}" } }] },
      ],
    };
    const executeTool = async (tool: string) => {
      if (tool === "type") {
        return { error: `page rejected "${TYPED}" for site key ${ENV_VALUE}` };
      }
      return { error: "network unavailable" };
    };
    await expect(
      playbookRuntime.runPlaybookOp({
        playbook: { id: "shop", provenance: { scope: "test" } },
        op,
        args: { password: TYPED },
        secrets: { SURF_TEST_SITE_KEY: ENV_VALUE },
        env: {},
        executeTool,
        sleep: async () => undefined,
        onEvent: report,
      }),
    ).rejects.toThrow(/All strategies failed/);
    const files = filesUnder(root);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      expect(content, file).not.toContain(TYPED);
      expect(content, file).not.toContain(ENV_VALUE);
    }
    const journal = fs.readFileSync(path.join(root, "activity-journal", "events.jsonl"), "utf8");
    expect(journal).toContain('"type":"tool.failed"');
  });
});

describe("a failed step's error in escaped form", () => {
  // Dummy values: one plain, one with a quote and a backslash, so their escaped spellings differ.
  const PLAIN = ["dummy", "plain", "pw", "8"].join("-");
  const QUOTED = ["dummy", 'quo"ted', "va\\lue", "8"].join("-");
  const spellings = (value: string) => {
    const once = JSON.stringify(value).slice(1, -1);
    return [value, once, JSON.stringify(once).slice(1, -1), encodeURIComponent(value)];
  };

  it.each([PLAIN, QUOTED])(
    "keeps %s, JSON-escaped or URL-encoded, out of every file",
    async (typed) => {
      const root = stateRoot();
      records.startRecord({ site: "shop", op: "login", tabId: 1, root });
      const report = (event: Record<string, unknown>) => {
        appendActivity(event, { root });
        records.appendRecordEvent(event, { target: { tabId: 1 }, root });
      };
      const once = JSON.stringify(typed).slice(1, -1);
      const error = `rejected {"value":"${once}"} at /login?pw=${encodeURIComponent(typed)} (${JSON.stringify(JSON.stringify(typed))})`;
      const result = await runtime.executeSingleStep(
        { cmd: "type", args: { selector: "#pw", text: typed } },
        {},
        { executeTool: async () => ({ error }), onEvent: report, stepDelay: 0 },
      );
      expect(result.success).toBe(false);
      for (const spelling of [...spellings(typed), "dummy"]) {
        expect(result.error).not.toContain(spelling);
        for (const file of filesUnder(root)) {
          expect(fs.readFileSync(file, "utf8"), file).not.toContain(spelling);
        }
      }
    },
  );
});

describe("a very short env value", () => {
  it.each(["a", "1"])(
    "(%s) leaves the run's events and the draft made from them intact",
    async (value) => {
      const root = stateRoot();
      const record = records.startRecord({ site: "shop", op: "browse", tabId: 1, root });
      const report = (event: Record<string, unknown>) => {
        records.appendRecordEvent(event, { target: { tabId: 1 }, root });
      };
      const op = {
        id: "browse",
        effect: "read",
        args: {},
        run: [
          {
            using: "network",
            request: {
              method: "GET",
              url: "https://shop.test/api",
              authInputs: [{ env: "SURF_TEST_SHORT", header: "X-Site-Key" }],
            },
          },
          {
            using: "workflow",
            steps: [
              { cmd: "navigate", args: { url: "https://shop.test/page/1" } },
              { cmd: "click", args: { selector: "a" } },
              { cmd: "type", args: { selector: "#q", text: "books" } },
            ],
          },
        ],
      };
      const executeTool = async (tool: string) => {
        if (tool === "type") {
          return { error: `rejected key ${value}` };
        }
        if (tool === "javascript_tool") {
          return { error: "network unavailable" };
        }
        return { success: true };
      };
      await expect(
        playbookRuntime.runPlaybookOp({
          playbook: { id: "shop", provenance: { scope: "test" } },
          op,
          secrets: { SURF_TEST_SHORT: value },
          env: {},
          executeTool,
          sleep: async () => undefined,
          onEvent: report,
        }),
      ).rejects.toThrow(/All strategies failed/);
      const events = records.readEvents(record.id, root);
      const steps = events.filter((event: { type: string }) => event.type === "tool.completed");
      expect(steps.map((event: { argsRedacted: unknown }) => event.argsRedacted)).toEqual([
        { url: "https://shop.test/page/1" },
        { selector: "a" },
      ]);
      const failed = events.find((event: { type: string }) => event.type === "tool.failed");
      expect(failed).toMatchObject({
        type: "tool.failed",
        command: "type",
        resultSummary: "rejected key <redacted>",
      });
      const { draft } = records.stopRecord({ target: { tabId: 1 }, draft: true, root });
      const workflow = draft.run.find(
        (strategy: { using: string }) => strategy.using === "workflow",
      );
      expect(workflow.steps.slice(0, 2)).toEqual([
        { tool: "navigate", args: { url: "https://shop.test/page/1" } },
        { tool: "click", args: { selector: "a" } },
      ]);
    },
  );
});
