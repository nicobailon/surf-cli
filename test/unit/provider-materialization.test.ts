import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const transfer = require("../../native/file-transfer.cjs");
const helpers = require("../../native/host-helpers.cjs");

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("provider path materialization", () => {
  it("passes ordinary host paths to ChatGPT and Gemini dispatch", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "surf-provider-materialization-"));
    tempDirs.push(directory);
    const staged = path.join(directory, "chat-stage.txt");
    const direct = path.join(directory, "gemini-input.png");
    const output = path.join(directory, "gemini-output.png");
    await fs.writeFile(staged, "chat");
    await fs.writeFile(direct, "image");

    const chatPlan = transfer.prepareRemoteTool("chatgpt", { query: "q", file: "local:chat.txt" });
    const chat = await transfer.materializeRemoteTool({
      tool: "chatgpt",
      args: chatPlan.args,
      metadata: {
        uploads: [
          { transferId: "chat", field: "file", original: "local:chat.txt", kind: "upload" },
        ],
        downloads: [],
      },
      pathRefs: chatPlan.pathRefs,
      transferState: { takeCompleted: () => ({ filePath: staged }) },
    });
    const chatMessage = helpers.mapToolToMessage("chatgpt", chat.args, 1);
    expect(chatMessage.file).toBe(staged);
    expect(JSON.stringify(chatMessage)).not.toMatch(/local:|remote:/);

    const geminiPlan = transfer.prepareRemoteTool("gemini", {
      query: "edit",
      "edit-image": `remote:${direct}`,
      output: `remote:${output}`,
    });
    const gemini = await transfer.materializeRemoteTool({
      tool: "gemini",
      args: geminiPlan.args,
      metadata: { uploads: [], downloads: [] },
      pathRefs: geminiPlan.pathRefs,
    });
    const geminiMessage = helpers.mapToolToMessage("gemini", gemini.args, 1);
    expect(geminiMessage.editImage).toBe(direct);
    expect(geminiMessage.output).toBe(output);
    expect(JSON.stringify(geminiMessage)).not.toMatch(/local:|remote:/);
  });
});
