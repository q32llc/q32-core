import { describe, expect, it } from "vitest";
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1Primitive,
  D1StatementResult,
} from "../src/d1.js";
import {
  createOAuthRedirect,
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

  it("maps client registration defaults and stored client rows", async () => {
    const db = new RecordingD1();
    const repo = new McpOAuthRepository(db, {
      defaultScope: "mcp:read mcp:write",
      tokenEndpointAuthMethod: "client_secret_post",
    });

    db.nextFirst = null;
    expect(await repo.getClient("missing")).toBeUndefined();

    db.nextFirst = {
      clientId: "mcpcli_1",
      clientSecret: null,
      clientName: "Agent",
      redirectUrisJson: '["https://client.test/callback"]',
      scope: null,
      grantTypesJson: null,
      responseTypesJson: "not json",
      tokenEndpointAuthMethod: "none",
      clientUri: null,
      logoUri: null,
      contactsJson: '["ops@example.com", 12]',
      tosUri: null,
      policyUri: null,
      softwareId: "agent",
      softwareVersion: null,
      clientIdIssuedAt: 123,
      clientSecretExpiresAt: null,
    };
    await expect(repo.getClient("mcpcli_1")).resolves.toMatchObject({
      client_id: "mcpcli_1",
      client_name: "Agent",
      redirect_uris: ["https://client.test/callback"],
      response_types: [],
      contacts: ["ops@example.com"],
    });

    db.nextFirst = {
      clientId: "mcpcli_registered",
      clientSecret: null,
      clientName: null,
      redirectUrisJson: "[]",
      scope: "mcp:read mcp:write",
      grantTypesJson: "[]",
      responseTypesJson: "[]",
      tokenEndpointAuthMethod: "client_secret_post",
      clientUri: null,
      logoUri: null,
      contactsJson: "[]",
      tosUri: null,
      policyUri: null,
      softwareId: null,
      softwareVersion: null,
      clientIdIssuedAt: 123,
      clientSecretExpiresAt: null,
    };
    const registered = await repo.registerClient({});

    expect(registered).toMatchObject({
      client_id: "mcpcli_registered",
      scope: "mcp:read mcp:write",
      token_endpoint_auth_method: "client_secret_post",
    });
    const insertValues = db.bindHistory.at(-2) ?? [];
    expect(insertValues[4]).toBe("mcp:read mcp:write");
    expect(insertValues[7]).toBe("client_secret_post");
  });

  it("reads authorization codes and tokens with configurable subjects", async () => {
    const db = new RecordingD1();
    const repo = new McpOAuthRepository(db, {
      subjectColumns: [
        { field: "accountId", column: "account_id" },
        { field: "customerId", column: "customer_id" },
      ],
    });

    db.nextFirst = {
      authorizationCodeId: "mcpac_1",
      clientId: "client_1",
      accountId: "acct_1",
      customerId: "cus_1",
      redirectUri: "https://client.test/callback",
      scopesJson: '["mcp:read"]',
      resource: null,
      codeChallenge: "challenge",
      expiresAt: 200,
      usedAt: null,
    };
    await expect(repo.getAuthorizationCode("code_1")).resolves.toMatchObject({
      subject: { accountId: "acct_1", customerId: "cus_1" },
    });

    db.nextFirst = null;
    await expect(repo.getAuthorizationCode("missing")).resolves.toBeNull();

    db.nextFirst = {
      tokenId: "mcptok_1",
      clientId: "client_1",
      accountId: "acct_1",
      customerId: "cus_1",
      scopesJson: '["mcp:read"]',
      resource: null,
      accessExpiresAt: 200,
      refreshExpiresAt: null,
      revokedAt: null,
    };
    await expect(repo.getTokenByAccessToken("access_1")).resolves.toMatchObject({
      subject: { accountId: "acct_1", customerId: "cus_1" },
    });
  });

  it("guards unsafe subject mappings and missing subject values", async () => {
    const db = new RecordingD1();
    const repo = new McpOAuthRepository(db, {
      subjectColumns: [{ field: "customerId", column: "customer_id" }],
    });

    await expect(
      repo.createTokenSet({
        clientId: "client_1",
        subject: { accountId: "acct_1" },
        accessToken: "access_1",
        refreshToken: null,
        scopes: ["mcp:read"],
        resource: null,
        accessExpiresAt: 100,
        refreshExpiresAt: null,
      }),
    ).rejects.toThrow("Missing OAuth subject field: customerId");

    const unsafeRepo = new McpOAuthRepository(db, {
      subjectColumns: [{ field: "bad-field", column: "bad-column" }],
    });
    await expect(unsafeRepo.getTokenByAccessToken("access_1")).rejects.toThrow(
      "Unsafe SQL identifier",
    );
  });

  it("handles token revocation, use timestamps, and refresh rotation modes", async () => {
    const db = new RecordingD1();
    const repo = new McpOAuthRepository(db);

    await repo.consumeAuthorizationCode("mcpac_1");
    expect(db.lastQuery).toContain("SET used_at = CURRENT_TIMESTAMP");
    await repo.touchAccessToken("mcptok_1");
    expect(db.lastQuery).toContain("access_last_used_at");

    await expect(
      repo.markTokenRotated({
        tokenId: "mcptok_1",
        rotatedToTokenId: "mcptok_2",
        refreshReuseExpiresAt: 123,
        rotatedResponseCiphertext: "cipher",
        rotatedResponseNonce: "nonce",
      }),
    ).resolves.toBe(true);
    expect(db.lastQuery).toContain("SET revoked_at = CURRENT_TIMESTAMP");

    db.changes = 0;
    const rotatingRepo = new McpOAuthRepository(db, {
      refreshRotationColumns: true,
    });
    await expect(
      rotatingRepo.markTokenRotated({
        tokenId: "mcptok_1",
        rotatedToTokenId: "mcptok_2",
        refreshReuseExpiresAt: 123,
        rotatedResponseCiphertext: "cipher",
        rotatedResponseNonce: "nonce",
      }),
    ).resolves.toBe(false);
    expect(db.lastQuery).toContain("rotated_to_token_id");
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
    expect(parseOAuthScope(undefined)).toEqual([]);
    expect(parseOAuthScope("mcp:read  mcp:write")).toEqual([
      "mcp:read",
      "mcp:write",
    ]);
    expect(parseOAuthJsonArray('["mcp:read", 1, false]')).toEqual([
      "mcp:read",
    ]);
    expect(parseOAuthJsonArray(undefined)).toEqual([]);
    expect(parseOAuthJsonArray("not json")).toEqual([]);
  });

  it("creates OAuth redirects while skipping undefined params", () => {
    const redirect = createOAuthRedirect("https://client.test/callback?x=1", {
      code: "code_1",
      state: undefined,
    });

    expect(redirect).toBe("https://client.test/callback?x=1&code=code_1");
  });
});

class RecordingD1 implements D1DatabaseLike {
  lastQuery = "";
  lastValues: D1Primitive[] = [];
  bindHistory: D1Primitive[][] = [];
  nextFirst: Record<string, unknown> | null = null;
  changes = 1;

  prepare(query: string): D1PreparedStatementLike {
    this.lastQuery = query;
    const statement: D1PreparedStatementLike = {
      bind: (...values: D1Primitive[]) => {
        this.lastValues = values;
        this.bindHistory.push(values);
        return statement;
      },
      run: async (): Promise<D1StatementResult> => ({
        success: true,
        meta: { changes: this.changes },
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
