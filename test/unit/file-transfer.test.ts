import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const B = require("buffer").Buffer;

const transfer = require("../../native/file-transfer.cjs");

const tempDirs: string[] = [];
async function tempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "surf-transfer-test-"));
  tempDirs.push(dir);
  return dir;
}
function digest(data: any) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("file transfer path policy", () => {
  it("creates private staging directories", async () => {
    const root = await tempDir();
    const staging = await transfer.createStagingDirectory(root, "connection");
    expect((await fs.stat(staging)).mode & 0o777).toBe(0o700);
    await fs.rm(staging, { recursive: true, force: true });
  });

  it("distinguishes local and absolute remote paths", () => {
    expect(transfer.parsePathDescriptor("local:input.txt", { mode: "remote" }).kind).toBe("local");
    expect(transfer.parsePathDescriptor("remote:/tmp/input.txt", { mode: "remote" })).toMatchObject(
      { kind: "remote", path: "/tmp/input.txt" },
    );
    expect(() => transfer.parsePathDescriptor("remote:relative.txt", { mode: "remote" })).toThrow(
      /absolute/,
    );
    expect(() => transfer.parsePathDescriptor("remote:/tmp/input.txt", { mode: "local" })).toThrow(
      /local mode/,
    );
  });

  it("rewrites bounded nested response values without mutating input", () => {
    const original = {
      path: "/tmp/stage",
      nested: [{ message: "Saved /tmp/stage" }],
      untouched: Object.create(null),
    };
    const rewritten = transfer.rewriteTransferPaths(original, [
      { path: "/tmp/stage", original: "local:shot.png" },
    ]);
    expect(rewritten.path).toBe("local:shot.png");
    expect(rewritten.nested[0].message).toBe("Saved local:shot.png");
    expect(original.path).toBe("/tmp/stage");
  });

  it("preserves __proto__ as data without changing the rewritten prototype", () => {
    const original = JSON.parse('{"__proto__":{"error":"spoofed"},"path":"/tmp/stage"}');
    const rewritten = transfer.rewriteTransferPaths(original, [
      { path: "/tmp/stage", original: "local:shot.png" },
    ]);
    expect(Object.getPrototypeOf(rewritten)).toBe(Object.prototype);
    expect(Object.hasOwn(rewritten, "__proto__")).toBe(true);
    expect(rewritten.error).toBeUndefined();
    expect(rewritten.path).toBe("local:shot.png");
  });

  it("fails closed when a response exceeds rewrite limits", () => {
    let nested: unknown = "/tmp/stage";
    for (let depth = 0; depth < 10; depth += 1) {
      nested = { nested };
    }
    expect(() =>
      transfer.rewriteTransferPaths(nested, [{ path: "/tmp/stage", original: "local:shot.png" }]),
    ).toThrow(/rewrite limits/);
  });

  it("normalizes local prefixes while preserving upload shape", () => {
    const normalized = transfer.validateLocalToolPaths("upload", {
      files: ["local:one.txt", "two.txt"],
    });
    expect(normalized.files).toEqual([path.resolve("one.txt"), path.resolve("two.txt")]);
    expect(
      transfer.validateLocalToolPaths("screenshot", { savePath: "local:shot.png" }).savePath,
    ).toBe(path.resolve("shot.png"));
    expect(() =>
      transfer.validateLocalToolPaths("screenshot", { savePath: "a", output: "b" }),
    ).toThrow(/one output/);
    expect(() => transfer.validateLocalToolPaths("upload", { files: "remote:/tmp/x" })).toThrow(
      /local mode/,
    );
    const localExport = transfer.validateLocalToolPaths("network.export", { jsonl: true });
    expect(localExport.output).toMatch(/\.jsonl$/);
    expect(path.isAbsolute(localExport.output)).toBe(true);
    expect(() =>
      transfer.validateLocalToolPaths("network.export", { har: true, jsonl: true }),
    ).toThrow(/combine/);
    expect(() =>
      transfer.validateLocalToolPaths("network.export", { output: "remote:/tmp/export.json" }),
    ).toThrow(/local mode/);
  });

  it("keeps client-local resolved paths out of host descriptors", () => {
    const prepared = transfer.prepareRemoteTool("screenshot", { savePath: "local:shot.png" });
    expect(prepared.pathRefs[0]).toMatchObject({
      original: "local:shot.png",
      path: "local:shot.png",
      pathKind: "local",
    });
    expect(prepared.downloads[0].destination).toBe(path.resolve("shot.png"));
  });

  it("plans scalar provider attachments and image modes", () => {
    const chatgpt = transfer.prepareRemoteTool("chatgpt", { query: "q", file: "local:note.txt" });
    expect(chatgpt.pathRefs).toMatchObject([{ field: "file", kind: "input", pathKind: "local" }]);
    expect(chatgpt.uploads).toHaveLength(1);
    expect(() => transfer.prepareRemoteTool("chatgpt", { query: "q", file: ["a", "b"] })).toThrow(
      /one path/,
    );

    const edit = transfer.prepareRemoteTool("gemini", {
      query: "edit",
      "edit-image": "local:in.png",
    });
    expect(edit.args.output).toBe("edited.png");
    expect(edit.pathRefs.map((entry: any) => entry.field)).toEqual(["edit-image", "output"]);
    expect(edit.downloads).toHaveLength(1);
    expect(() =>
      transfer.prepareRemoteTool("gemini", { query: "q", file: "a", output: "b" }),
    ).toThrow(/cannot combine/);
    expect(() => transfer.prepareRemoteTool("gemini", { query: "q", output: "b" })).toThrow(
      /requires edit-image/,
    );
    expect(() =>
      transfer.prepareRemoteTool("gemini", { query: "q", "generate-image": "a", output: "b" }),
    ).toThrow(/own output/);
  });

  it("generates network and auto-capture client destinations", async () => {
    const network = transfer.prepareRemoteTool("network.export", { jsonl: true });
    expect(network.args.output).toMatch(/\.jsonl$/);
    expect(network.downloads[0].field).toBe("output");
    expect(() => transfer.prepareRemoteTool("network.export", { har: true, jsonl: true })).toThrow(
      /combine/,
    );
    expect(() => transfer.prepareRemoteTool("network.export", { har: "yes" })).toThrow(/boolean/);
    expect(() =>
      transfer.prepareRemoteTool("click", { selector: "#go", autoScreenshot: "yes" }),
    ).toThrow(/boolean/);
    expect(() => transfer.prepareRemoteTool("tab.list", { autoScreenshot: true })).toThrow(
      /not supported/,
    );
    const auto = transfer.prepareRemoteTool("click", { selector: "#go", autoScreenshot: true });
    expect(auto.args.autoScreenshotOutput).toMatch(/\.png$/);
    expect(auto.downloads[0].field).toBe("autoScreenshotOutput");
    await expect(
      transfer.materializeRemoteTool({
        tool: "click",
        args: {
          selector: "#go",
          autoScreenshot: true,
          autoScreenshotOutput: "remote:/tmp/host.png",
        },
        metadata: { uploads: [], downloads: [] },
        pathRefs: [
          {
            field: "autoScreenshotOutput",
            kind: "output",
            original: "remote:/tmp/host.png",
            path: "/tmp/host.png",
            pathKind: "remote",
          },
        ],
      }),
    ).rejects.toThrow(/auto screenshot metadata/);
  });

  it("materializes staged and direct provider paths with rewrites", async () => {
    const directory = await tempDir();
    const stagedInput = path.join(directory, "staged-input");
    await fs.writeFile(stagedInput, "input");
    const state = {
      directory,
      takeCompleted: (transferId: string) => ({ filePath: stagedInput, id: transferId }),
    };
    const chat = transfer.prepareRemoteTool("chatgpt", { query: "q", file: "local:note.txt" });
    const chatMaterialized = await transfer.materializeRemoteTool({
      tool: "chatgpt",
      args: chat.args,
      metadata: {
        uploads: [
          { transferId: "chat-upload", field: "file", original: "local:note.txt", kind: "upload" },
        ],
        downloads: [],
      },
      pathRefs: chat.pathRefs,
      transferState: state,
      getTransferState: async () => state,
    });
    expect(chatMaterialized.args.file).toBe(stagedInput);
    expect(chatMaterialized.pathRewrites).toContainEqual({
      path: stagedInput,
      original: "local:note.txt",
    });

    const remoteInput = path.join(directory, "remote-input");
    await fs.writeFile(remoteInput, "remote");
    const direct = transfer.prepareRemoteTool("chatgpt", {
      query: "q",
      file: `remote:${remoteInput}`,
    });
    const directMaterialized = await transfer.materializeRemoteTool({
      tool: "chatgpt",
      args: direct.args,
      metadata: { uploads: [], downloads: [] },
      pathRefs: direct.pathRefs,
      getTransferState: async () => state,
    });
    expect(directMaterialized.args.file).toBe(remoteInput);
    expect(directMaterialized.outputTransfers).toEqual([]);

    const edit = transfer.prepareRemoteTool("gemini", {
      query: "edit",
      "edit-image": "local:input.png",
      output: `remote:${path.join(directory, "edited.png")}`,
    });
    const editMaterialized = await transfer.materializeRemoteTool({
      tool: "gemini",
      args: edit.args,
      metadata: {
        uploads: [
          {
            transferId: "edit-upload",
            field: "edit-image",
            original: "local:input.png",
            kind: "upload",
          },
        ],
        downloads: [],
      },
      pathRefs: edit.pathRefs,
      transferState: state,
      getTransferState: async () => state,
    });
    expect(editMaterialized.args["edit-image"]).toBe(stagedInput);
    expect(editMaterialized.args.output).toBe(path.join(directory, "edited.png"));
  });

  it("rolls back a claimed Gemini input when output metadata fails", async () => {
    const directory = await tempDir();
    const staged = path.join(directory, "claimed-edit-input");
    await fs.writeFile(staged, "input");
    const plan = transfer.prepareRemoteTool("gemini", {
      query: "edit",
      "edit-image": "local:input.png",
      output: "local:output.png",
    });
    await expect(
      transfer.materializeRemoteTool({
        tool: "gemini",
        args: plan.args,
        metadata: {
          uploads: [
            {
              transferId: "edit-upload",
              field: "edit-image",
              original: "local:input.png",
              kind: "upload",
            },
          ],
          downloads: [],
        },
        pathRefs: plan.pathRefs,
        transferState: { directory, takeCompleted: () => ({ filePath: staged }) },
      }),
    ).rejects.toThrow(/download descriptor/);
    await expect(fs.access(staged)).rejects.toThrow();
  });

  it("rejects unsupported remote commands and multi-file uploads", () => {
    expect(() => transfer.prepareRemoteTool("record", {})).toThrow(/not supported/);
    expect(() => transfer.prepareRemoteTool("upload", { files: ["a", "b"] })).toThrow(
      /exactly one/,
    );
    expect(() => transfer.prepareRemoteTool("smoke", { screenshot: "/tmp" })).toThrow(
      /screenshots/,
    );
  });
});

describe("bounded upload state", () => {
  it("streams chunks and verifies zero-byte and non-empty files", async () => {
    const dir = await tempDir();
    const frames: unknown[] = [];
    const state = transfer.createTransferState({
      directory: dir,
      writer: { send: async (frame: unknown) => frames.push(frame) },
      limits: { maxChunkBytes: 4, maxFileBytes: 32, maxSessionBytes: 64, maxFiles: 2 },
    });
    const emptyHash = digest(B.alloc(0));
    await state.handle({
      type: "transfer_begin",
      version: 1,
      direction: "upload",
      transferId: "zero",
      size: 0,
      sha256: emptyHash,
    });
    await state.handle({ type: "transfer_end", version: 1, transferId: "zero" });
    const complete = frames.find((frame: any) => frame.type === "transfer_complete") as any;
    const stored = state.takeCompleted("zero");
    expect(complete.path).toBeUndefined();
    expect(stored.filePath).toBeTruthy();
    expect((await fs.stat(stored.filePath)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(stored.filePath)).size).toBe(0);
    await state.cleanup();
  });

  it("keeps cumulative file, byte, and ID quotas after completed files are claimed", async () => {
    const countDir = await tempDir();
    const countState = transfer.createTransferState({
      directory: countDir,
      writer: { send: async () => undefined },
      limits: { maxChunkBytes: 4, maxFileBytes: 8, maxSessionBytes: 8, maxFiles: 2 },
    });
    const complete = async (state: any, id: string, data: any) => {
      await state.handle({
        type: "transfer_begin",
        version: 1,
        direction: "upload",
        transferId: id,
        size: data.length,
        sha256: digest(data),
      });
      if (data.length) {
        await state.handle({
          type: "transfer_chunk",
          version: 1,
          transferId: id,
          sequence: 0,
          data: data.toString("base64"),
        });
      }
      await state.handle({ type: "transfer_end", version: 1, transferId: id });
      const claimed = state.takeCompleted(id);
      await fs.rm(claimed.filePath, { force: true });
    };
    await complete(countState, "first", B.from("a"));
    await complete(countState, "second", B.from("b"));
    expect(countState.fileCount).toBe(2);
    expect(countState.usedBytes).toBe(2);
    await expect(
      countState.handle({
        type: "transfer_begin",
        version: 1,
        direction: "upload",
        transferId: "first",
        size: 0,
        sha256: digest(B.alloc(0)),
      }),
    ).rejects.toThrow(/duplicate/);
    await expect(
      countState.handle({
        type: "transfer_begin",
        version: 1,
        direction: "upload",
        transferId: "third",
        size: 0,
        sha256: digest(B.alloc(0)),
      }),
    ).rejects.toThrow(/count limit/);
    await countState.cleanup();

    const byteDir = await tempDir();
    const byteState = transfer.createTransferState({
      directory: byteDir,
      writer: { send: async () => undefined },
      limits: { maxChunkBytes: 4, maxFileBytes: 8, maxSessionBytes: 2, maxFiles: 8 },
    });
    await complete(byteState, "full", B.from("ab"));
    await expect(
      byteState.handle({
        type: "transfer_begin",
        version: 1,
        direction: "upload",
        transferId: "over",
        size: 1,
        sha256: digest(B.from("c")),
      }),
    ).rejects.toThrow(/session byte limit/);
    await byteState.cleanup();
  });

  it("cleans request-owned paths idempotently before completion", async () => {
    const dir = await tempDir();
    const first = path.join(dir, "first");
    const second = path.join(dir, "second");
    await fs.writeFile(first, "1");
    await fs.writeFile(second, "2");
    const paths = [first, second];
    await transfer.cleanupFilePaths(paths);
    await transfer.cleanupFilePaths(paths);
    expect(paths).toEqual([]);
    await expect(fs.access(first)).rejects.toThrow();
    await expect(fs.access(second)).rejects.toThrow();
  });

  it("expires unclaimed completed uploads and supports explicit discard", async () => {
    const dir = await tempDir();
    const frames: any[] = [];
    const state = transfer.createTransferState({
      directory: dir,
      writer: { send: async (frame: any) => frames.push(frame) },
      completedTtlMs: 5,
    });
    const bytes = B.from("x");
    await state.handle({
      type: "transfer_begin",
      version: 1,
      direction: "upload",
      transferId: "ttl",
      size: 1,
      sha256: digest(bytes),
    });
    await state.handle({
      type: "transfer_chunk",
      version: 1,
      transferId: "ttl",
      sequence: 0,
      data: bytes.toString("base64"),
    });
    await state.handle({ type: "transfer_end", version: 1, transferId: "ttl" });
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(state.completed.size).toBe(0);
    expect(await state.discardCompleted("ttl")).toBe(false);
    await state.cleanup();
  });

  it("rejects invalid base64, order, size, and hash", async () => {
    const dir = await tempDir();
    const state = transfer.createTransferState({
      directory: dir,
      writer: { send: async () => undefined },
      limits: { maxChunkBytes: 4, maxFileBytes: 32, maxSessionBytes: 64, maxFiles: 8 },
    });
    const hash = digest(B.from("abc"));
    await state.handle({
      type: "transfer_begin",
      version: 1,
      direction: "upload",
      transferId: "bad-base64",
      size: 3,
      sha256: hash,
    });
    await expect(
      state.handle({
        version: 1,
        type: "transfer_chunk",
        transferId: "bad-base64",
        sequence: 0,
        data: "%%%=",
      }),
    ).rejects.toThrow(/base64/);
    await state.handle({
      type: "transfer_begin",
      version: 1,
      direction: "upload",
      transferId: "noncanonical",
      size: 1,
      sha256: digest(B.from("a")),
    });
    await expect(
      state.handle({
        version: 1,
        type: "transfer_chunk",
        transferId: "noncanonical",
        sequence: 0,
        data: "YR==",
      }),
    ).rejects.toThrow(/canonical/);
    await state.handle({
      type: "transfer_begin",
      version: 1,
      direction: "upload",
      transferId: "bad-order",
      size: 3,
      sha256: hash,
    });
    await expect(
      state.handle({
        version: 1,
        type: "transfer_chunk",
        transferId: "bad-order",
        sequence: 1,
        data: "YQ==",
      }),
    ).rejects.toThrow(/order/);
    await state.handle({
      type: "transfer_begin",
      version: 1,
      direction: "upload",
      transferId: "bad-size",
      size: 2,
      sha256: digest(B.from("ab")),
    });
    await expect(
      state.handle({
        version: 1,
        type: "transfer_chunk",
        transferId: "bad-size",
        sequence: 0,
        data: "YWJj",
      }),
    ).rejects.toThrow(/declared size|exceeds/);
    await state.handle({
      type: "transfer_begin",
      version: 1,
      direction: "upload",
      transferId: "bad-hash",
      size: 3,
      sha256: digest(B.from("abd")),
    });
    await state.handle({
      version: 1,
      type: "transfer_chunk",
      transferId: "bad-hash",
      sequence: 0,
      data: "YWJj",
    });
    await expect(
      state.handle({ version: 1, type: "transfer_end", transferId: "bad-hash" }),
    ).rejects.toThrow(/SHA-256/);
    await state.cleanup();
  });
});

describe("client transfer controller", () => {
  it("cancels reserved downloads and removes their temp files", async () => {
    const dir = await tempDir();
    const destination = path.join(dir, "cancelled.bin");
    const controller = transfer.createClientTransferController({
      writer: { send: async () => undefined },
    });
    await controller.expectDownload({ transferId: "cancel", destination });
    expect(await controller.cancelDownload("cancel")).toBe(true);
    await expect(fs.readdir(dir)).resolves.toEqual([]);
    await controller.cleanup();
  });

  it("correlates upload control frames and atomically completes downloads", async () => {
    const dir = await tempDir();
    const input = path.join(dir, "input.txt");
    const destination = path.join(dir, "received.txt");
    const bytes = B.from("hello transfer");
    await fs.writeFile(input, bytes, { mode: 0o600 });
    const sent: any[] = [];
    let controller: any;
    const writer = {
      send: async (frame: any) => {
        sent.push(frame);
        if (frame.type === "transfer_begin" && frame.direction === "upload") {
          await controller.handle({
            version: 1,
            type: "transfer_ready",
            transferId: frame.transferId,
          });
        }
        if (frame.type === "transfer_end") {
          await controller.handle({
            version: 1,
            type: "transfer_complete",
            transferId: frame.transferId,
            path: "staged",
          });
        }
      },
    };
    controller = transfer.createClientTransferController({ writer, limits: { maxChunkBytes: 4 } });
    const uploaded = await controller.upload(input, { transferId: "up-1", original: "input.txt" });
    expect(uploaded.transferId).toBe("up-1");
    expect(sent.filter((frame) => frame.type === "transfer_chunk").length).toBeGreaterThan(1);

    await controller.expectDownload({ transferId: "down-1", destination });
    const downloadBytes = B.from("downloaded");
    await controller.handle({
      type: "transfer_begin",
      version: 1,
      direction: "download",
      transferId: "down-1",
      size: downloadBytes.length,
      sha256: digest(downloadBytes),
    });
    await controller.handle({
      version: 1,
      type: "transfer_chunk",
      transferId: "down-1",
      sequence: 0,
      data: downloadBytes.subarray(0, 4).toString("base64"),
    });
    await controller.handle({
      version: 1,
      type: "transfer_chunk",
      transferId: "down-1",
      sequence: 1,
      data: downloadBytes.subarray(4, 8).toString("base64"),
    });
    await controller.handle({
      version: 1,
      type: "transfer_chunk",
      transferId: "down-1",
      sequence: 2,
      data: downloadBytes.subarray(8).toString("base64"),
    });
    await controller.handle({ version: 1, type: "transfer_end", transferId: "down-1" });
    expect(await fs.readFile(destination)).toEqual(downloadBytes);
    expect(
      sent.some((frame) => frame.type === "transfer_complete" && frame.transferId === "down-1"),
    ).toBe(true);
    controller.cleanup();
  });
});

describe("outbound transfer limits", () => {
  it("rejects an oversized sparse file before hashing or sending", async () => {
    const dir = await tempDir();
    const filePath = path.join(dir, "oversized.bin");
    await fs.writeFile(filePath, "");
    await fs.truncate(filePath, 256 * 1024 * 1024 + 1);
    const frames: unknown[] = [];
    const state = transfer.createTransferState({
      directory: dir,
      writer: { send: async (frame: unknown) => frames.push(frame) },
    });
    await expect(
      transfer.streamFileDownload({
        writer: { send: async (frame: unknown) => frames.push(frame) },
        state,
        filePath,
        transferId: "oversized",
      }),
    ).rejects.toThrow(/file size limit/);
    expect(frames).toEqual([]);
    expect(state.fileCount).toBe(0);
    expect(state.usedBytes).toBe(0);
    await state.cleanup();
  });
});

describe("atomic downloads", () => {
  it("writes mode 0600 and removes partial destinations on failure", async () => {
    const dir = await tempDir();
    const destination = path.join(dir, "nested", "output.bin");
    const bytes = B.from("download");
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, "old destination");
    await transfer.writeAtomicDownload(
      destination,
      (async function* () {
        yield bytes.subarray(0, 3);
        yield bytes.subarray(3);
      })(),
      { size: bytes.length, sha256: digest(bytes) },
    );
    expect(await fs.readFile(destination)).toEqual(bytes);
    expect((await fs.stat(destination)).mode & 0o777).toBe(0o600);
    await expect(
      transfer.writeAtomicDownload(
        path.join(dir, "bad.bin"),
        (async function* () {
          yield B.from("bad");
        })(),
        { size: 4, sha256: digest(B.from("bad!")) },
      ),
    ).rejects.toThrow(/mismatch/);
    await expect(fs.access(path.join(dir, "bad.bin"))).rejects.toThrow();
  });
});
