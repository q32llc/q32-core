import { describe, expect, it } from "vitest";
import {
  normalizePem,
  postgresClientOptions,
  resolvePgConnection,
} from "../src/pg-kysely.js";

describe("Kysely Postgres helpers", () => {
  it("prefers Hyperdrive and disables client-side close by default", () => {
    const connection = resolvePgConnection({
      HYPERDRIVE: { connectionString: "postgres://hyperdrive/db" },
      PG_URL: "postgres://direct/db",
    });
    expect(connection).toMatchObject({
      connectionString: "postgres://hyperdrive/db",
      source: "hyperdrive",
      closeConnection: false,
    });
    expect(postgresClientOptions(connection).ssl).toBe(false);
  });

  it("uses PG_URL with secure defaults and CA-cert verification", () => {
    const connection = resolvePgConnection({
      PG_URL: "postgres://user:pass@db.example.com/app",
      PG_CA_CERT: "-----BEGIN CERT-----\\nabc\\n-----END CERT-----",
    });
    expect(connection.source).toBe("url");
    expect(connection.closeConnection).toBe(true);
    expect(connection.caCert).toContain("\nabc\n");
    expect(postgresClientOptions(connection).ssl).toEqual({
      ca: "-----BEGIN CERT-----\nabc\n-----END CERT-----",
      rejectUnauthorized: true,
    });
  });

  it("disables SSL for local PG and supports custom env keys", () => {
    const connection = resolvePgConnection(
      {
        ADMIN_URL: "postgres://postgres:postgres@127.0.0.1/postgres",
      },
      { urlKey: "ADMIN_URL" },
    );
    expect(postgresClientOptions(connection).ssl).toBe(false);
  });

  it("can be optional or fallback-backed", () => {
    expect(
      resolvePgConnection({}, { requireConnection: false }),
    ).toMatchObject({ connectionString: "", source: "fallback" });
    expect(
      resolvePgConnection({}, { fallbackConnectionString: "postgres://test:test@127.0.0.1:54321/test" }),
    ).toMatchObject({ source: "fallback" });
  });

  it("normalizes PEM values", () => {
    expect(normalizePem(" a\\nb ")).toBe("a\nb");
    expect(normalizePem("   ")).toBeUndefined();
  });
});
