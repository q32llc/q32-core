import { HttpError, requireAdminToken } from "./http.js";
import {
  createOAuthRedirect,
  decryptOAuthTokenResponse,
  encryptOAuthTokenResponse,
  issueMcpOAuthTokenSet,
  type McpOAuthRepository,
  type McpTokenRow,
  type OAuthClientInformation,
  type OAuthClientRegistration,
  type OAuthTokens,
  parseOAuthJsonArray,
} from "./oauth.js";
import { verifySession } from "./session.js";

export type CookieOptions = {
  name: string;
};

export type SessionAuthOptions<TSession> = {
  secret: string;
  cookie: CookieOptions;
  verify?: (payload: TSession) => Promise<TSession | null> | TSession | null;
};

export type AuthContext<TPrincipal = unknown, TSession = unknown> = {
  request: Request;
  session: TSession | null;
  principal: TPrincipal | null;
};

export type AuthSystemOptions<TPrincipal, TSession> = {
  session?: SessionAuthOptions<TSession>;
  loadPrincipal?: (session: TSession, request: Request) => Promise<TPrincipal | null> | TPrincipal | null;
};

export class AuthSystem<TPrincipal = unknown, TSession = unknown> {
  constructor(private readonly options: AuthSystemOptions<TPrincipal, TSession>) {}

  async sessionFromRequest(request: Request): Promise<TSession | null> {
    const config = this.options.session;
    if (!config) return null;
    const token = getCookie(request, config.cookie.name);
    const payload = await verifySession<TSession>(token, config.secret);
    if (!payload) return null;
    return config.verify ? await config.verify(payload) : payload;
  }

  async contextFromRequest(request: Request): Promise<AuthContext<TPrincipal, TSession>> {
    const session = await this.sessionFromRequest(request);
    const principal = session && this.options.loadPrincipal ? await this.options.loadPrincipal(session, request) : null;
    return { request, session, principal };
  }

  async requirePrincipal(request: Request): Promise<TPrincipal> {
    const context = await this.contextFromRequest(request);
    if (!context.principal) throw new HttpError(401, "Authentication required.", "authentication_required");
    return context.principal;
  }
}

export function createAuthSystem<TPrincipal = unknown, TSession = unknown>(
  options: AuthSystemOptions<TPrincipal, TSession>,
): AuthSystem<TPrincipal, TSession> {
  return new AuthSystem(options);
}

export function getCookie(request: Request, name: string): string | undefined {
  const cookie = request.headers.get("cookie");
  if (!cookie) return undefined;
  for (const part of cookie.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) return decodeURIComponent(rawValue.join("="));
  }
  return undefined;
}

export function requireAdminRequest(request: Request, expectedToken: string | undefined): void {
  requireAdminToken(request, expectedToken);
}

export type McpAuthInfo<TSubject extends Record<string, string> = Record<string, string>> = {
  token: string;
  clientId: string;
  scopes: string[];
  expiresAt: number;
  resource?: URL;
  subject: TSubject;
  extra?: Record<string, unknown>;
};

export type McpAuthorizationParams = {
  redirectUri: string;
  state?: string;
  scopes?: string[];
  resource?: URL;
  codeChallenge: string;
};

export type McpAuthorizeResult =
  | { kind: "redirect"; location: string; status?: number }
  | { kind: "authorized"; code: string; redirect: string };

export type McpAuthServiceOptions<TPrincipal, TSubject extends Record<string, string>> = {
  repository: McpOAuthRepository;
  sessionAuth?: AuthSystem<TPrincipal, unknown>;
  loginPath?: string;
  defaultScopes?: string[];
  authCodeTtlSeconds?: number;
  accessTokenTtlSeconds?: number;
  refreshTokenTtlSeconds?: number;
  refreshTokenReuseGraceSeconds?: number;
  tokenEncryptionSecret: string;
  principalToSubject: (principal: TPrincipal) => TSubject | null | Promise<TSubject | null>;
  subjectToPrincipal?: (subject: TSubject) => TPrincipal | null | Promise<TPrincipal | null>;
  canAuthorize?: (principal: TPrincipal, client: OAuthClientInformation, params: McpAuthorizationParams) => boolean | Promise<boolean>;
  canUseToken?: (principal: TPrincipal, row: McpTokenRow) => boolean | Promise<boolean>;
  accessDeniedDescription?: string;
  createAuthorizationCode?: () => string;
  createAccessToken?: () => string;
  createRefreshToken?: () => string;
  now?: () => number;
};

const DEFAULT_SCOPE = "mcp:read";
const DEFAULT_AUTH_CODE_TTL_SECONDS = 10 * 60;
const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_REFRESH_TOKEN_REUSE_GRACE_SECONDS = 10 * 60;

export class McpAuthService<TPrincipal, TSubject extends Record<string, string> = Record<string, string>> {
  readonly skipLocalPkceValidation = false;

  constructor(private readonly options: McpAuthServiceOptions<TPrincipal, TSubject>) {}

  get clientsStore(): {
    getClient: (clientId: string) => Promise<OAuthClientInformation | undefined>;
    registerClient: (client: OAuthClientRegistration) => Promise<OAuthClientInformation>;
  } {
    return {
      getClient: (clientId: string) => this.options.repository.getClient(clientId),
      registerClient: (client: OAuthClientRegistration) => this.options.repository.registerClient(client),
    };
  }

  async authorize(client: OAuthClientInformation, params: McpAuthorizationParams, request: Request): Promise<McpAuthorizeResult> {
    const principal = this.options.sessionAuth ? await this.options.sessionAuth.requirePrincipal(request).catch(() => null) : null;
    if (!principal) {
      return { kind: "redirect", location: this.loginRedirect(request), status: 302 };
    }

    const allowed = this.options.canAuthorize ? await this.options.canAuthorize(principal, client, params) : true;
    const subject = allowed ? await this.options.principalToSubject(principal) : null;
    if (!allowed || !subject) {
      const redirect = createOAuthRedirect(params.redirectUri, {
        error: "access_denied",
        error_description: this.options.accessDeniedDescription ?? "Access denied.",
        state: params.state,
      });
      return { kind: "redirect", location: redirect, status: 302 };
    }

    const code = this.options.createAuthorizationCode?.() ?? `mcpcode_${crypto.randomUUID().replace(/-/g, "")}`;
    await this.options.repository.createAuthorizationCode({
      code,
      clientId: client.client_id,
      subject,
      redirectUri: params.redirectUri,
      scopes: params.scopes?.length ? params.scopes : this.defaultScopes(),
      resource: params.resource?.href ?? null,
      codeChallenge: params.codeChallenge,
      expiresAt: this.now() + (this.options.authCodeTtlSeconds ?? DEFAULT_AUTH_CODE_TTL_SECONDS),
    });

    return {
      kind: "authorized",
      code,
      redirect: createOAuthRedirect(params.redirectUri, { code, state: params.state }),
    };
  }

  async challengeForAuthorizationCode(client: OAuthClientInformation, authorizationCode: string): Promise<string> {
    const row = await this.validAuthorizationCode(client, authorizationCode);
    return row.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformation,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const row = await this.validAuthorizationCode(client, authorizationCode);
    if (redirectUri && row.redirectUri !== redirectUri) throw invalidGrant("Redirect URI mismatch");
    if (resource?.href && row.resource && row.resource !== resource.href) throw invalidGrant("Resource mismatch");

    await this.options.repository.consumeAuthorizationCode(row.authorizationCodeId);
    return this.issueTokens({
      clientId: row.clientId,
      subject: row.subject as TSubject,
      scopes: parseOAuthJsonArray(row.scopesJson),
      resource: row.resource ? new URL(row.resource) : resource,
    });
  }

  async exchangeRefreshToken(client: OAuthClientInformation, refreshToken: string, scopes?: string[], resource?: URL): Promise<OAuthTokens> {
    const row = await this.options.repository.getTokenByRefreshToken(refreshToken);
    if (!row || row.clientId !== client.client_id) throw invalidGrant("Invalid refresh token");
    const cachedResponse = await this.cachedRefreshResponse(row);
    if (cachedResponse) return cachedResponse;
    if (row.revokedAt) throw invalidGrant("Invalid refresh token");
    if (row.refreshExpiresAt && row.refreshExpiresAt < this.now()) throw invalidGrant("Refresh token expired");

    const grantedScopes = parseOAuthJsonArray(row.scopesJson);
    const requestedScopes = scopes?.length ? scopes.filter((scope) => grantedScopes.includes(scope)) : grantedScopes;
    const issued = await this.issueTokenSet({
      clientId: row.clientId,
      subject: row.subject as TSubject,
      scopes: requestedScopes,
      resource: resource ?? (row.resource ? new URL(row.resource) : undefined),
    });
    const encryptedResponse = await encryptOAuthTokenResponse(issued.tokens, this.options.tokenEncryptionSecret);
    const claimedRotation = await this.options.repository.markTokenRotated({
      tokenId: row.tokenId,
      rotatedToTokenId: issued.tokenId,
      refreshReuseExpiresAt: this.now() + (this.options.refreshTokenReuseGraceSeconds ?? DEFAULT_REFRESH_TOKEN_REUSE_GRACE_SECONDS),
      rotatedResponseCiphertext: encryptedResponse.ciphertext,
      rotatedResponseNonce: encryptedResponse.nonce,
    });
    if (claimedRotation) return issued.tokens;

    await this.options.repository.revokeToken(issued.tokenId);
    const winner = await this.options.repository.getTokenByRefreshToken(refreshToken);
    const winnerResponse = winner ? await this.cachedRefreshResponse(winner) : null;
    if (winnerResponse) return winnerResponse;
    throw invalidGrant("Invalid refresh token");
  }

  async verifyAccessToken(token: string): Promise<McpAuthInfo<TSubject>> {
    const row = await this.options.repository.getTokenByAccessToken(token);
    if (!row || row.revokedAt || row.accessExpiresAt < this.now()) throw new HttpError(401, "Invalid access token.", "invalid_access_token");
    const subject = row.subject as TSubject;
    const principal = this.options.subjectToPrincipal ? await this.options.subjectToPrincipal(subject) : null;
    if (this.options.subjectToPrincipal && !principal) throw new HttpError(401, "Invalid access token.", "invalid_access_token");
    if (principal && this.options.canUseToken && !(await this.options.canUseToken(principal, row))) {
      throw new HttpError(403, "Token is not allowed.", "token_not_allowed");
    }
    await this.options.repository.touchAccessToken(row.tokenId);
    return {
      token,
      clientId: row.clientId,
      scopes: parseOAuthJsonArray(row.scopesJson),
      expiresAt: row.accessExpiresAt,
      resource: row.resource ? new URL(row.resource) : undefined,
      subject,
      extra: { ...subject },
    };
  }

  async revokeToken(client: OAuthClientInformation, request: { token: string }): Promise<void> {
    const accessRow = await this.options.repository.getTokenByAccessToken(request.token);
    if (accessRow && accessRow.clientId === client.client_id) {
      await this.options.repository.revokeToken(accessRow.tokenId);
      return;
    }

    const refreshRow = await this.options.repository.getTokenByRefreshToken(request.token);
    if (refreshRow && refreshRow.clientId === client.client_id) await this.options.repository.revokeToken(refreshRow.tokenId);
  }

  private async validAuthorizationCode(client: OAuthClientInformation, authorizationCode: string) {
    const row = await this.options.repository.getAuthorizationCode(authorizationCode);
    if (!row || row.clientId !== client.client_id || row.usedAt || row.expiresAt < this.now()) {
      throw invalidGrant("Invalid authorization code");
    }
    return row;
  }

  private async issueTokens(input: {
    clientId: string;
    subject: TSubject;
    scopes: string[];
    resource?: URL;
  }): Promise<OAuthTokens> {
    return (await this.issueTokenSet(input)).tokens;
  }

  private async issueTokenSet(input: {
    clientId: string;
    subject: TSubject;
    scopes: string[];
    resource?: URL;
  }) {
    return issueMcpOAuthTokenSet(
      this.options.repository,
      {
        clientId: input.clientId,
        subject: input.subject,
        scopes: input.scopes,
        resource: input.resource,
      },
      {
        accessTokenTtlSeconds: this.options.accessTokenTtlSeconds ?? DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
        refreshTokenTtlSeconds: this.options.refreshTokenTtlSeconds ?? DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
        createAccessToken: this.options.createAccessToken,
        createRefreshToken: this.options.createRefreshToken,
        now: this.options.now,
      },
    );
  }

  private async cachedRefreshResponse(row: McpTokenRow): Promise<OAuthTokens | null> {
    if (!row.rotatedResponseCiphertext || !row.rotatedResponseNonce || !row.refreshReuseExpiresAt || row.refreshReuseExpiresAt < this.now()) return null;
    return decryptOAuthTokenResponse(row.rotatedResponseCiphertext, row.rotatedResponseNonce, this.options.tokenEncryptionSecret);
  }

  private defaultScopes(): string[] {
    return this.options.defaultScopes?.length ? this.options.defaultScopes : [DEFAULT_SCOPE];
  }

  private loginRedirect(request: Request): string {
    const loginPath = this.options.loginPath ?? "/login";
    const url = new URL(loginPath, request.url);
    url.searchParams.set("next", request.url);
    return `${url.pathname}${url.search}`;
  }

  private now(): number {
    return this.options.now?.() ?? Math.floor(Date.now() / 1000);
  }
}

function invalidGrant(message: string): Error {
  const error = new Error(message);
  error.name = "InvalidGrantError";
  return error;
}
