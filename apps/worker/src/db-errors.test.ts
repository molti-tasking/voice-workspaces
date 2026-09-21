import { describe, expect, it } from "vitest";
import { isConnectionError } from "./db-errors";

describe("isConnectionError", () => {
  it("matches the dropped-socket errors `pg` throws with no code", () => {
    // The exact pair seen in production on 2026-09-21: a dead pooled socket
    // left by a database restart or redeploy.
    expect(isConnectionError(new Error("Connection terminated unexpectedly"))).toBe(true);
    expect(
      isConnectionError(new Error("Connection terminated due to connection timeout")),
    ).toBe(true);
  });

  it("matches Postgres shutdown and connection-failure SQLSTATE codes", () => {
    expect(isConnectionError(Object.assign(new Error("admin shutdown"), { code: "57P01" }))).toBe(
      true,
    );
    expect(isConnectionError(Object.assign(new Error("boom"), { code: "08006" }))).toBe(true);
  });

  it("matches Node socket error codes", () => {
    expect(isConnectionError(Object.assign(new Error("reset"), { code: "ECONNRESET" }))).toBe(true);
    expect(isConnectionError(Object.assign(new Error("refused"), { code: "ECONNREFUSED" }))).toBe(
      true,
    );
  });

  it("does not match a genuine bug in the work", () => {
    expect(isConnectionError(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isConnectionError(Object.assign(new Error("bad query"), { code: "42601" }))).toBe(false);
  });

  it("handles non-error values", () => {
    expect(isConnectionError(undefined)).toBe(false);
    expect(isConnectionError(null)).toBe(false);
    expect(isConnectionError("Connection terminated unexpectedly")).toBe(false);
  });
});
