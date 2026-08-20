// Validates the registered provider against pi-subagents' real contract
// validators so contract drift fails here instead of in a user's session.
import {
  registerExternalJobProvider,
  validateExternalJobHandle,
  validateExternalJobResult,
} from "pi-subagents/external-job-provider";
import { describe, expect, it, vi } from "vitest";

const { createOracleExternalJobProvider } = require("../../pi-extension/surf.ts");

const externalJobProviderKey = Symbol.for("pi-subagents.external-job-providers.v1");

function oracleResponse(details: Record<string, unknown>) {
  return async () => ({ content: [{ type: "text", text: "{}" }], details });
}

describe("pi-subagents external-job contract", () => {
  it("registers the provider object with pi's validator", () => {
    delete (globalThis as Record<PropertyKey, unknown>)[externalJobProviderKey];
    const provider = createOracleExternalJobProvider("pi-session", new Set(), vi.fn());

    const dispose = registerExternalJobProvider(provider);

    dispose();
    delete (globalThis as Record<PropertyKey, unknown>)[externalJobProviderKey];
  });

  it("returns payloads that pass pi's handle and result validation for every oracle state", async () => {
    for (const oracleState of ["created", "dispatched", "awaiting", "captured", "failed"]) {
      const provider = createOracleExternalJobProvider(
        "pi-session",
        new Set(),
        oracleResponse({
          id: "job-1",
          state: oracleState,
          conversationUrl:
            oracleState === "created" ? null : "https://chatgpt.com/c/conversation-id",
          ...(oracleState === "captured" ? { response: "answer text\n" } : {}),
          ...(oracleState === "failed"
            ? { error: { code: "harvest_failed", message: " harvest failed " } }
            : {}),
        }),
      );

      expect(
        validateExternalJobHandle("surf-oracle", await provider.status("job-1")),
      ).toMatchObject({
        providerJobId: "job-1",
      });
      expect(
        validateExternalJobHandle("surf-oracle", await provider.reattach("job-1")),
      ).toMatchObject({
        providerJobId: "job-1",
      });
      expect(
        validateExternalJobResult("surf-oracle", await provider.result("job-1")),
      ).toMatchObject({
        providerJobId: "job-1",
        ...(oracleState === "captured" ? { output: "answer text" } : {}),
      });
    }
  });

  it("returns a start handle that passes pi's handle validation", async () => {
    const provider = createOracleExternalJobProvider(
      "pi-session",
      new Set(),
      oracleResponse({ id: "job-2", state: "created", conversationUrl: null }),
    );

    expect(
      validateExternalJobHandle(
        "surf-oracle",
        await provider.start({ prompt: "review", options: {} }),
      ),
    ).toEqual({
      providerJobId: "job-2",
      state: "queued",
    });
  });
});
