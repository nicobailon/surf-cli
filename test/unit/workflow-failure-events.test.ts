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
