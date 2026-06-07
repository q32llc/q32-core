import { describe, expect, it } from "vitest";
import {
  createAuthSystem,
  getCookie,
  honoAuthMiddleware,
  honoRequirePrincipal,
  HttpError,
  honoMcpAuthorize,
  McpAuthService,
  reactRouterAuthContext,
  reactRouterError,
  reactRouterJson,
  reactRouterMcpAuthorize,
  reactRouterRedirect,
  reactRouterRequirePrincipal,
  requireAdminRequest,
  type HonoContextLike,
} from "../src/index.js";
import type {
  McpAuthorizationCodeRow,
  McpIssuedTokenSet,
  McpTokenRow,
  OAuthClientInformation,
  OAuthClientRegistration,
  OAuthTokens,
} from "../src/oauth.js";
import { signSession } from "../src/session.js";

describe("framework-neutral auth", () => {
  it("loads signed cookie sessions and principals from Fetch requests", async () => {
    const token = await signSession({ kind: "app", accountId: "acct_1" }, "secret");
    const auth = createAuthSystem({
      session: { cookie: { name: "sid" }, secret: "secret" },
      loadPrincipal: (session: { accountId?: string }) => (session.accountId ? { accountId: session.accountId } : null),
    });

    const request = new Request("https://app.test/dashboard", {
      headers: { cookie: `other=x; sid=${encodeURIComponent(token)}` },
    });

    await expect(auth.contextFromRequest(request)).resolves.toMatchObject({
      session: { accountId: "acct_1" },
      principal: { accountId: "acct_1" },
    });
    expect(getCookie(request, "sid")).toBe(token);
  });

  it("supports app-provided cookie token verifiers", async () => {
    const auth = createAuthSystem({
      session: {
        cookie: { name: "sid" },
        secret: "secret",
        verifyToken: (token, secret) => (token === `${secret}:raw` ? { accountId: "acct_raw" } : null),
      },
      loadPrincipal: (session: { accountId?: string }) => (session.accountId ? { accountId: session.accountId } : null),
    });

    await expect(
      auth.contextFromRequest(new Request("https://app.test", { headers: { cookie: "sid=secret%3Araw" } })),
    ).resolves.toMatchObject({
      session: { accountId: "acct_raw" },
      principal: { accountId: "acct_raw" },
    });
  });

  it("shares the same auth object across Hono-like and React Router-like adapters", async () => {
    const token = await signSession({ accountId: "acct_1" }, "secret");
    const auth = createAuthSystem({
      session: { cookie: { name: "sid" }, secret: "secret" },
      loadPrincipal: (session: { accountId?: string }) => (session.accountId ? { accountId: session.accountId } : null),
    });
    const request = new Request("https://app.test", { headers: { cookie: `sid=${encodeURIComponent(token)}` } });
    const stored = new Map<string, unknown>();
    const context: HonoContextLike = {
      req: { raw: request, url: request.url },
      set: (key, value) => stored.set(key, value),
      json: (value, status) => new Response(JSON.stringify(value), { status }),
      redirect: (location, status) => new Response(null, { status, headers: { location } }),
    };

    await expect(honoAuthMiddleware(auth)(context, async () => undefined)).resolves.toBeUndefined();
    expect(stored.get("auth")).toMatchObject({ principal: { accountId: "acct_1" } });
    await expect(reactRouterAuthContext(auth, { request })).resolves.toMatchObject({
      principal: { accountId: "acct_1" },
    });
    await expect(honoRequirePrincipal(context, auth)).resolves.toEqual({ accountId: "acct_1" });
    await expect(reactRouterRequirePrincipal(auth, { request })).resolves.toEqual({ accountId: "acct_1" });
  });

  it("keeps admin checks framework-neutral", () => {
    const request = new Request("https://app.test/admin", { headers: { "x-admin-token": "good" } });
    expect(() => requireAdminRequest(request, "good")).not.toThrow();
    expect(() => requireAdminRequest(request, "bad")).toThrow("Invalid admin token");
  });

  it("covers unauthenticated and adapter error response branches", async () => {
    const auth = createAuthSystem<{ accountId: string }, { accountId: string }>({
      session: { cookie: { name: "sid" }, secret: "secret", verify: () => null },
      loadPrincipal: (session) => ({ accountId: session.accountId }),
    });
    const request = new Request("https://app.test");
    const context: HonoContextLike = {
      req: { raw: request, url: request.url },
      json: (value, status) => new Response(JSON.stringify(value), { status }),
      redirect: (location, status) => new Response(null, { status, headers: { location } }),
    };

    await expect(auth.sessionFromRequest(request)).resolves.toBeNull();
    await expect(auth.requirePrincipal(request)).rejects.toThrow("Authentication required");
    const response = await honoAuthMiddleware(auth, { requirePrincipal: true })(context, async () => undefined);
    expect(response?.status).toBe(401);
    expect(reactRouterJson({ ok: true }).headers.get("content-type")).toContain("application/json");
    expect(reactRouterRedirect("/next").headers.get("location")).toBe("/next");
    expect(reactRouterError(new HttpError(418, "teapot", "teapot")).status).toBe(418);
    const existing = new Response("already", { status: 409 });
    expect(reactRouterError(existing)).toBe(existing);
    expect(reactRouterError("broken").status).toBe(500);
  });
});

describe("McpAuthService", () => {
  const client: OAuthClientInformation = {
    client_id: "client_1",
    redirect_uris: ["https://client.test/callback"],
  };

  it("authorizes through a shared service from Hono-like and React Router-like requests", async () => {
    const repository = new MemoryMcpRepository();
    const token = await signSession({ accountId: "acct_1", paid: true }, "secret");
    const auth = createAuthSystem({
      session: { cookie: { name: "sid" }, secret: "secret" },
      loadPrincipal: (session: { accountId?: string; paid?: boolean }) =>
        session.accountId ? { accountId: session.accountId, paid: Boolean(session.paid) } : null,
    });
    const service = new McpAuthService({
      repository,
      sessionAuth: auth,
      tokenEncryptionSecret: "secret",
      createAuthorizationCode: () => "code_custom",
      createAccessToken: () => "access_custom",
      createRefreshToken: () => "refresh_custom",
      now: () => 100,
      principalToSubject: (principal) => ({ accountId: principal.accountId }),
      subjectToPrincipal: (subject) => ({ accountId: subject.accountId, paid: true }),
      canAuthorize: (principal) => principal.paid,
      canUseToken: (principal) => principal.paid,
    });
    const request = new Request("https://app.test/mcp/authorize", {
      headers: { cookie: `sid=${encodeURIComponent(token)}` },
    });
    const context: HonoContextLike = {
      req: { raw: request, url: request.url },
      json: (value, status) => new Response(JSON.stringify(value), { status }),
      redirect: (location, status) => new Response(null, { status, headers: { location } }),
    };

    const response = await honoMcpAuthorize(context, service, client, {
      redirectUri: "https://client.test/callback",
      state: "state_1",
      codeChallenge: "challenge",
    });

    expect(response.headers.get("location")).toBe("https://client.test/callback?code=code_custom&state=state_1");
    await expect(service.challengeForAuthorizationCode(client, "code_custom")).resolves.toBe("challenge");
    const tokens = await service.exchangeAuthorizationCode(client, "code_custom", undefined, "https://client.test/callback");
    expect(tokens).toMatchObject({ access_token: "access_custom", refresh_token: "refresh_custom" });
    await expect(service.verifyAccessToken("access_custom")).resolves.toMatchObject({
      subject: { accountId: "acct_1" },
      scopes: ["mcp:read"],
    });
    await service.revokeToken(client, { token: "access_custom" });
    await expect(service.verifyAccessToken("access_custom")).rejects.toThrow("Invalid access token");

    const rrResponse = await reactRouterMcpAuthorize({ request }, service, client, {
      redirectUri: "https://client.test/callback",
      state: "state_2",
      codeChallenge: "challenge_2",
    });
    expect(rrResponse.status).toBe(302);
  });

  it("redirects unauthenticated users and denies unauthorized principals", async () => {
    const repository = new MemoryMcpRepository();
    const anonymousAuth = createAuthSystem<{ accountId: string }, { accountId: string }>({
      session: { cookie: { name: "sid" }, secret: "secret" },
      loadPrincipal: (session) => ({ accountId: session.accountId }),
    });
    const service = new McpAuthService({
      repository,
      sessionAuth: anonymousAuth,
      loginPath: "/auth/start",
      tokenEncryptionSecret: "secret",
      principalToSubject: (principal) => ({ accountId: principal.accountId }),
      canAuthorize: () => false,
    });

    await expect(
      service.authorize(
        client,
        { redirectUri: "https://client.test/callback", state: "s", codeChallenge: "c" },
        new Request("https://app.test/mcp/authorize"),
      ),
    ).resolves.toMatchObject({ kind: "redirect", location: "/auth/start?next=https%3A%2F%2Fapp.test%2Fmcp%2Fauthorize" });

    const token = await signSession({ accountId: "acct_1" }, "secret");
    const denied = await service.authorize(
      client,
      { redirectUri: "https://client.test/callback", state: "s", codeChallenge: "c" },
      new Request("https://app.test/mcp/authorize", { headers: { cookie: `sid=${encodeURIComponent(token)}` } }),
    );
    expect(denied).toMatchObject({ kind: "redirect" });
    expect((denied as { location: string }).location).toContain("error=access_denied");
  });

  it("handles refresh rotation, cached retry responses, and invalid grant checks", async () => {
    const repository = new MemoryMcpRepository();
    const service = new McpAuthService({
      repository,
      tokenEncryptionSecret: "secret",
      createAccessToken: () => `access_${repository.tokenCounter + 1}`,
      createRefreshToken: () => `refresh_${repository.tokenCounter + 1}`,
      now: () => 100,
      principalToSubject: (principal: { accountId: string }) => ({ accountId: principal.accountId }),
    });
    await repository.createTokenSet({
      clientId: client.client_id,
      subject: { accountId: "acct_1" },
      accessToken: "access_0",
      refreshToken: "refresh_0",
      scopes: ["mcp:read", "mcp:write"],
      resource: "https://app.test/mcp",
      accessExpiresAt: 110,
      refreshExpiresAt: 200,
    });

    const rotated = await service.exchangeRefreshToken(client, "refresh_0", ["mcp:read"], new URL("https://app.test/mcp"));
    expect(rotated).toMatchObject({ access_token: "access_2", refresh_token: "refresh_2", scope: "mcp:read" });
    await expect(service.exchangeRefreshToken(client, "refresh_0")).resolves.toEqual(rotated);
    await expect(service.exchangeRefreshToken({ ...client, client_id: "other" }, "refresh_0")).rejects.toThrow("Invalid refresh token");
    await expect(service.exchangeRefreshToken(client, "missing")).rejects.toThrow("Invalid refresh token");
  });

  it("rejects bad authorization codes, mismatched redirect/resource, and disallowed tokens", async () => {
    const repository = new MemoryMcpRepository();
    const token = await signSession({ accountId: "acct_1" }, "secret");
    const auth = createAuthSystem({
      session: { cookie: { name: "sid" }, secret: "secret" },
      loadPrincipal: (session: { accountId?: string }) => (session.accountId ? { accountId: session.accountId } : null),
    });
    const service = new McpAuthService({
      repository,
      sessionAuth: auth,
      tokenEncryptionSecret: "secret",
      now: () => 100,
      principalToSubject: (principal) => ({ accountId: principal.accountId }),
      subjectToPrincipal: () => ({ accountId: "acct_1" }),
      canUseToken: () => false,
    });
    const request = new Request("https://app.test", { headers: { cookie: `sid=${encodeURIComponent(token)}` } });

    const result = await service.authorize(
      client,
      {
        redirectUri: "https://client.test/callback",
        codeChallenge: "challenge",
        resource: new URL("https://app.test/mcp"),
        scopes: ["mcp:write"],
      },
      request,
    );
    const code = (result as { code: string }).code;
    await expect(service.exchangeAuthorizationCode(client, "missing")).rejects.toThrow("Invalid authorization code");
    await expect(service.exchangeAuthorizationCode(client, code, undefined, "https://wrong.test/callback")).rejects.toThrow("Redirect URI mismatch");
    await expect(
      service.exchangeAuthorizationCode(client, code, undefined, "https://client.test/callback", new URL("https://other.test/mcp")),
    ).rejects.toThrow("Resource mismatch");

    const tokens = await service.exchangeAuthorizationCode(client, code, undefined, "https://client.test/callback", new URL("https://app.test/mcp"));
    await expect(service.verifyAccessToken(tokens.access_token)).rejects.toThrow("Token is not allowed");
    await service.revokeToken(client, { token: tokens.refresh_token ?? "" });
    expect((await repository.getTokenByRefreshToken(tokens.refresh_token ?? ""))?.revokedAt).toBeTruthy();
  });
});

class MemoryMcpRepository {
  clients = new Map<string, OAuthClientInformation>();
  codes = new Map<string, McpAuthorizationCodeRow & { code: string }>();
  tokens = new Map<string, McpTokenRow & { accessToken: string; refreshToken: string | null }>();
  tokenCounter = 0;

  async getClient(clientId: string): Promise<OAuthClientInformation | undefined> {
    return this.clients.get(clientId);
  }

  async registerClient(client: OAuthClientRegistration): Promise<OAuthClientInformation> {
    const registered = { ...client, client_id: `client_${this.clients.size + 1}`, redirect_uris: client.redirect_uris ?? [] };
    this.clients.set(registered.client_id, registered);
    return registered;
  }

  async createAuthorizationCode(input: {
    code: string;
    clientId: string;
    subject: Record<string, string>;
    redirectUri: string;
    scopes: string[];
    resource?: string | null;
    codeChallenge: string;
    expiresAt: number;
  }): Promise<string> {
    const authorizationCodeId = `code_row_${this.codes.size + 1}`;
    this.codes.set(input.code, {
      authorizationCodeId,
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      scopesJson: JSON.stringify(input.scopes),
      resource: input.resource ?? null,
      codeChallenge: input.codeChallenge,
      expiresAt: input.expiresAt,
      usedAt: null,
      subject: input.subject,
      code: input.code,
    });
    return authorizationCodeId;
  }

  async getAuthorizationCode(code: string): Promise<McpAuthorizationCodeRow | null> {
    return this.codes.get(code) ?? null;
  }

  async consumeAuthorizationCode(authorizationCodeId: string): Promise<void> {
    for (const code of this.codes.values()) {
      if (code.authorizationCodeId === authorizationCodeId) code.usedAt = new Date().toISOString();
    }
  }

  async createTokenSet(input: {
    clientId: string;
    subject: Record<string, string>;
    accessToken: string;
    refreshToken: string | null;
    scopes: string[];
    resource: string | null;
    accessExpiresAt: number;
    refreshExpiresAt: number | null;
  }): Promise<string> {
    const tokenId = `token_${(this.tokenCounter += 1)}`;
    this.tokens.set(tokenId, {
      tokenId,
      clientId: input.clientId,
      scopesJson: JSON.stringify(input.scopes),
      resource: input.resource,
      accessExpiresAt: input.accessExpiresAt,
      refreshExpiresAt: input.refreshExpiresAt,
      revokedAt: null,
      subject: input.subject,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
    });
    return tokenId;
  }

  async getTokenByAccessToken(token: string): Promise<McpTokenRow | null> {
    return [...this.tokens.values()].find((row) => row.accessToken === token) ?? null;
  }

  async getTokenByRefreshToken(token: string): Promise<McpTokenRow | null> {
    return [...this.tokens.values()].find((row) => row.refreshToken === token) ?? null;
  }

  async touchAccessToken(): Promise<void> {}

  async revokeToken(tokenId: string): Promise<void> {
    const token = this.tokens.get(tokenId);
    if (token) token.revokedAt = new Date().toISOString();
  }

  async markTokenRotated(input: {
    tokenId: string;
    rotatedToTokenId: string;
    refreshReuseExpiresAt: number;
    rotatedResponseCiphertext: string;
    rotatedResponseNonce: string;
  }): Promise<boolean> {
    const token = this.tokens.get(input.tokenId);
    if (!token || token.revokedAt) return false;
    token.revokedAt = new Date().toISOString();
    token.rotatedToTokenId = input.rotatedToTokenId;
    token.refreshReuseExpiresAt = input.refreshReuseExpiresAt;
    token.rotatedResponseCiphertext = input.rotatedResponseCiphertext;
    token.rotatedResponseNonce = input.rotatedResponseNonce;
    return true;
  }
}
