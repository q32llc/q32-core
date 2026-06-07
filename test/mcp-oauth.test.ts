import { describe, expect, it } from "vitest";
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1Primitive,
  D1StatementResult,
} from "../src/d1.js";
import {
  decryptOAuthTokenResponse,
  encryptOAuthTokenResponse,
  issueMcpOAuthTokenSet,
  McpOAuthRepository,
  parseOAuthJsonArray,
  parseOAuthScope,
} from "../src/oauth.js";

describe("MCP OAuth repository helpers", () => {
  it("writes authorization codes with configurable subject columns", async () => {
    const db = new RecordingD1();
    const repo = new McpOAuthRepository(db, {
      subjectColumns: [
        { field: "accountId", column: "account_id" },
        { field: "customerId", column: "customer_id" },
      ],
    });

    await repo.createAuthorizationCode({
      code: "code_1",
      clientId: "client_1",
      subject: { accountId: "acct_1", customerId: "cus_1" },
      redirectUri: "https://client.test/callback",
      scopes: ["mcp:read", "mcp:write"],
      resource: "https://app.test/mcp",
      codeChallenge: "challenge",
      expiresAt: 123,
    });

    expect(db.lastQuery).toContain('"account_id"');
    expect(db.lastQuery).toContain('"customer_id"');
    expect(db.lastValues).toEqual([
      expect.stringMatching(/^mcpac_/),
      expect.stringMatching(/^[a-f0-9]{64}$/),
      "client_1",
      "acct_1",
      "cus_1",
      "https://client.test/callback",
      '["mcp:read","mcp:write"]',
      "https://app.test/mcp",
      "challenge",
      123,
    ]);
  });

  it("issues token sets through the shared D1 mapper", async () => {
    const db = new RecordingD1();
    const repo = new McpOAuthRepository(db);

    const issued = await issueMcpOAuthTokenSet(
      repo,
      {
        clientId: "client_1",
        subject: { accountId: "acct_1" },
        scopes: ["mcp:read"],
        resource: new URL("https://app.test/mcp"),
      },
      {
        accessTokenTtlSeconds: 10,
        refreshTokenTtlSeconds: 20,
        now: () => 100,
      },
    );

    expect(issued.tokenId).toMatch(/^mcptok_/);
    expect(issued.tokens.access_token).toMatch(/^mcpat_/);
    expect(issued.tokens.refresh_token).toMatch(/^mcprt_/);
    expect(issued.accessExpiresAt).toBe(110);
    expect(issued.refreshExpiresAt).toBe(120);
    expect(db.lastQuery).toContain("mcp_oauth_tokens");
    expect(db.lastValues).toEqual([
      issued.tokenId,
      "client_1",
      "acct_1",
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.stringMatching(/^[a-f0-9]{64}$/),
      '["mcp:read"]',
      "https://app.test/mcp",
      110,
      120,
    ]);
  });

  it("reads refresh rotation columns when enabled", async () => {
    const db = new RecordingD1();
    db.nextFirst = {
      tokenId: "mcptok_1",
      clientId: "client_1",
      accountId: "acct_1",
      scopesJson: '["mcp:read"]',
      resource: "https://app.test/mcp",
      accessExpiresAt: 110,
      refreshExpiresAt: 120,
      revokedAt: null,
      rotatedToTokenId: "mcptok_2",
      refreshReuseExpiresAt: 130,
      rotatedResponseCiphertext: "ciphertext",
      rotatedResponseNonce: "nonce",
    };
    const repo = new McpOAuthRepository(db, { refreshRotationColumns: true });

    const row = await repo.getTokenByRefreshToken("refresh_1");

    expect(db.lastQuery).toContain("rotated_to_token_id");
    expect(row).toMatchObject({
      tokenId: "mcptok_1",
      subject: { accountId: "acct_1" },
      rotatedToTokenId: "mcptok_2",
      refreshReuseExpiresAt: 130,
    });
  });

  it("encrypts cached token responses for refresh rotation grace windows", async () => {
    const tokens = {
      access_token: "access",
      token_type: "Bearer" as const,
      expires_in: 60,
      refresh_token: "refresh",
      scope: "mcp:read",
    };

    const encrypted = await encryptOAuthTokenResponse(tokens, "secret");
    const decrypted = await decryptOAuthTokenResponse(
      encrypted.ciphertext,
      encrypted.nonce,
      "secret",
    );

    expect(encrypted.ciphertext).not.toContain("access");
    expect(decrypted).toEqual(tokens);
    await expect(
      decryptOAuthTokenResponse(encrypted.ciphertext, encrypted.nonce, "wrong"),
    ).resolves.toBeNull();
  });

  it("parses scope and JSON scope columns defensively", () => {
    expect(parseOAuthScope("mcp:read  mcp:write")).toEqual([
      "mcp:read",
      "mcp:write",
    ]);
    expect(parseOAuthJsonArray('["mcp:read", 1, false]')).toEqual([
      "mcp:read",
    ]);
    expect(parseOAuthJsonArray("not json")).toEqual([]);
  });
});

class RecordingD1 implements D1DatabaseLike {
  lastQuery = "";
  lastValues: D1Primitive[] = [];
  nextFirst: Record<string, unknown> | null = null;

  prepare(query: string): D1PreparedStatementLike {
    this.lastQuery = query;
    const statement: D1PreparedStatementLike = {
      bind: (...values: D1Primitive[]) => {
        this.lastValues = values;
        return statement;
      },
      run: async (): Promise<D1StatementResult> => ({
        success: true,
        meta: { changes: 1 },
      }),
      first: async <T extends object>() => this.nextFirst as T | null,
      all: async <T extends object>() => ({ results: [] as T[] }),
    };
    return statement;
  }

  async batch(): Promise<D1StatementResult[]> {
    return [];
  }

  async exec(): Promise<unknown> {
    return undefined;
  }
}
