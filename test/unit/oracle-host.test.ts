// @ts-expect-error - CommonJS module without type definitions
import { assertLocalOracleRequest } from "../../native/oracle-host.cjs";

describe("oracle host request guard", () => {
  it("rejects the existing remote request context with a structured code", () => {
    expect(() => assertLocalOracleRequest({ context: { isRemote: true } })).toThrow(
      expect.objectContaining({
        code: "remote_unsupported",
        message: "oracle tools are not supported for remote clients",
      }),
    );
  });

  it("allows local request contexts", () => {
    expect(() => assertLocalOracleRequest({ context: { isRemote: false } })).not.toThrow();
  });
});
