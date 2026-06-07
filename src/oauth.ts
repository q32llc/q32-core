import type { FetchLike } from "./http.js";
import { defaultFetch } from "./http.js";
import type { D1DatabaseLike } from "./d1.js";
import { sha256Hex } from "./hash.js";
import { createId, createToken, fromBase64Url, toBase64Url } from "./ids.js";

export type OAuthMetadataOptions = {
  issuer: string;
  authorizationPath?: string;
  tokenPath?: string;
  registrationPath?: string;
  revocationPath?: string;
  scopes?: string[];
  resourceDocumentation?: string;
};

export function oauthAuthorizationServerMetadata(options: OAuthMetadataOptions): Record<string, unknown> {
  const issuer = options.issuer.replace(/\/$/, "");
  return {
    issuer,
    authorization_endpoint: `${issuer}${options.authorizationPath ?? "/authorize"}`,
    token_endpoint: `${issuer}${options.tokenPath ?? "/token"}`,
    registration_endpoint: `${issuer}${options.registrationPath ?? "/register"}`,
    revocation_endpoint: `${issuer}${options.revocationPath ?? "/revoke"}`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: options.scopes ?? ["mcp:read", "mcp:write"],
    resource_documentation: options.resourceDocumentation ?? `${issuer}/mcp`,
  };
}

export function oauthProtectedResourceMetadata(resource: string, authorizationServer: string, scopes?: string[]): Record<string, unknown> {
  return {
    resource,
    authorization_servers: [authorizationServer.replace(/\/$/, "")],
    scopes_supported: scopes ?? ["mcp:read", "mcp:write"],
    bearer_methods_supported: ["header"],
  };
}

export function mcpServerCard(options: { name: string; description?: string; url: string }): Record<string, unknown> {
  return {
    name: options.name,
    description: options.description,
    url: options.url,
    transport: "http",
  };
}

export type OAuthAuthorizationUrlInput = {
  clientId: string;
  redirectUri: string;
  state: string;
  scope?: string;
  extraParams?: Record<string, string | undefined>;
};

export type OAuthCodeExchangeInput = {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri?: string;
};

export type GoogleUserProfile = {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
};

export type GitHubUserProfile = {
  id: number;
  login: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
};

export type OAuthClientInformation = {
  client_id: string;
  client_secret?: string;
  client_name?: string;
  redirect_uris: string[];
  scope?: string;
  grant_types?: string[];
  response_types?: string[];
  token_endpoint_auth_method?: string;
  client_uri?: string;
  logo_uri?: string;
  contacts?: string[];
  tos_uri?: string;
  policy_uri?: string;
  software_id?: string;
  software_version?: string;
  client_id_issued_at?: number;
  client_secret_expires_at?: number;
};

export type OAuthClientRegistration = Omit<OAuthClientInformation, "client_id" | "client_id_issued_at" | "redirect_uris"> & {
  redirect_uris?: string[];
};

export type OAuthTokens = {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
};

export type McpOAuthSubjectColumn = {
  field: string;
  column: string;
};

export type McpOAuthRepositoryOptions = {
  defaultScope?: string;
  tokenEndpointAuthMethod?: string;
  subjectColumns?: McpOAuthSubjectColumn[];
  refreshRotationColumns?: boolean;
  createClientId?: () => string;
  createAuthorizationCodeId?: () => string;
  createTokenId?: () => string;
};

export type McpAuthorizationCodeRow = {
  authorizationCodeId: string;
  clientId: string;
  redirectUri: string;
  scopesJson: string;
  resource: string | null;
  codeChallenge: string;
  expiresAt: number;
  usedAt: string | null;
  subject: Record<string, string>;
};

export type McpTokenRow = {
  tokenId: string;
  clientId: string;
  scopesJson: string;
  resource: string | null;
  accessExpiresAt: number;
  refreshExpiresAt: number | null;
  revokedAt: string | null;
  subject: Record<string, string>;
  rotatedToTokenId?: string | null;
  refreshReuseExpiresAt?: number | null;
  rotatedResponseCiphertext?: string | null;
  rotatedResponseNonce?: string | null;
};

export type McpIssuedTokenSet = {
  tokenId: string;
  tokens: OAuthTokens;
  accessExpiresAt: number;
  refreshExpiresAt: number | null;
};

export type McpOAuthTokenOptions = {
  accessTokenTtlSeconds?: number;
  refreshTokenTtlSeconds?: number;
  createAccessToken?: () => string;
  createRefreshToken?: () => string;
  now?: () => number;
};

const DEFAULT_MCP_SUBJECT_COLUMNS: McpOAuthSubjectColumn[] = [{ field: "accountId", column: "account_id" }];
const DEFAULT_AUTH_CODE_TTL_SECONDS = 10 * 60;
const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export class GoogleOAuthClient {
  constructor(private readonly fetchImpl: FetchLike = defaultFetch) {}

  buildAuthorizationUrl(input: OAuthAuthorizationUrlInput): string {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", input.clientId);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", input.scope ?? "openid email profile");
    url.searchParams.set("state", input.state);
    setExtraSearchParams(url, input.extraParams);
    return url.toString();
  }

  async exchangeCode(input: Required<OAuthCodeExchangeInput>): Promise<{ accessToken: string }> {
    const response = await this.fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: input.clientId,
        client_secret: input.clientSecret,
        code: input.code,
        redirect_uri: input.redirectUri,
        grant_type: "authorization_code",
      }),
    });
    if (!response.ok) throw new Error(`Google token exchange failed: ${response.status}`);
    const payload = (await response.json()) as { access_token?: string; error?: string };
    if (!payload.access_token) throw new Error(payload.error ?? "Google token exchange missing access token");
    return { accessToken: payload.access_token };
  }

  async fetchUserProfile(accessToken: string, options: { requireVerifiedEmail?: boolean } = {}): Promise<GoogleUserProfile> {
    const response = await this.fetchImpl("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
      },
    });
    if (!response.ok) throw new Error(`Google profile fetch failed: ${response.status}`);
    const profile = (await response.json()) as GoogleUserProfile;
    if (!profile.sub || !profile.email) throw new Error("Google profile missing identity fields");
    if (options.requireVerifiedEmail && profile.email_verified === false) throw new Error("Google profile missing verified identity fields");
    return profile;
  }
}

export class GitHubOAuthClient {
  constructor(
    private readonly options: {
      fetch?: FetchLike;
      userAgent?: string;
    } = {},
  ) {}

  buildAuthorizationUrl(input: OAuthAuthorizationUrlInput): string {
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", input.clientId);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("scope", input.scope ?? "read:user user:email");
    url.searchParams.set("state", input.state);
    setExtraSearchParams(url, input.extraParams);
    return url.toString();
  }

  async exchangeCode(input: OAuthCodeExchangeInput): Promise<{ accessToken: string }> {
    const response = await (this.options.fetch ?? defaultFetch)("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        client_id: input.clientId,
        client_secret: input.clientSecret,
        code: input.code,
        ...(input.redirectUri ? { redirect_uri: input.redirectUri } : {}),
      }),
    });
    if (!response.ok) throw new Error(`GitHub token exchange failed: ${response.status}`);
    const payload = (await response.json()) as { access_token?: string; error?: string };
    if (!payload.access_token) throw new Error(payload.error ?? "GitHub token exchange missing access token");
    return { accessToken: payload.access_token };
  }

  async fetchUserProfile(accessToken: string): Promise<GitHubUserProfile> {
    const response = await (this.options.fetch ?? defaultFetch)("https://api.github.com/user", {
      headers: this.githubHeaders(accessToken),
    });
    if (!response.ok) throw new Error(`GitHub profile fetch failed: ${response.status}`);
    const profile = (await response.json()) as GitHubUserProfile;
    if (!profile.id || !profile.login) throw new Error("GitHub profile missing identity fields");
    return profile;
  }

  async fetchPrimaryEmail(accessToken: string): Promise<string | null> {
    const response = await (this.options.fetch ?? defaultFetch)("https://api.github.com/user/emails", {
      headers: this.githubHeaders(accessToken),
    });
    if (!response.ok) return null;
    const emails = (await response.json()) as Array<{
      email?: string;
      primary?: boolean;
      verified?: boolean;
    }>;
    return emails.find((email) => email.primary && email.verified)?.email ?? emails.find((email) => email.verified)?.email ?? null;
  }

  private githubHeaders(accessToken: string): Record<string, string> {
    return {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${accessToken}`,
      "user-agent": this.options.userAgent ?? "@q32/core",
    };
  }
}

export class McpOAuthRepository {
  private readonly options: Required<
    Pick<
      McpOAuthRepositoryOptions,
      "defaultScope" | "tokenEndpointAuthMethod" | "subjectColumns" | "refreshRotationColumns" | "createClientId" | "createAuthorizationCodeId" | "createTokenId"
    >
  >;

  constructor(
    private readonly db: D1DatabaseLike,
    options: McpOAuthRepositoryOptions = {},
  ) {
    this.options = {
      defaultScope: options.defaultScope ?? "mcp:read",
      tokenEndpointAuthMethod: options.tokenEndpointAuthMethod ?? "none",
      subjectColumns: options.subjectColumns ?? DEFAULT_MCP_SUBJECT_COLUMNS,
      refreshRotationColumns: options.refreshRotationColumns ?? false,
      createClientId: options.createClientId ?? (() => createId("mcpcli")),
      createAuthorizationCodeId: options.createAuthorizationCodeId ?? (() => createId("mcpac")),
      createTokenId: options.createTokenId ?? (() => createId("mcptok")),
    };
  }

  async getClient(clientId: string): Promise<OAuthClientInformation | undefined> {
    const row = await this.db
      .prepare(
        `
        SELECT
          client_id AS clientId,
          client_secret AS clientSecret,
          client_name AS clientName,
          redirect_uris_json AS redirectUrisJson,
          scope,
          grant_types_json AS grantTypesJson,
          response_types_json AS responseTypesJson,
          token_endpoint_auth_method AS tokenEndpointAuthMethod,
          client_uri AS clientUri,
          logo_uri AS logoUri,
          contacts_json AS contactsJson,
          tos_uri AS tosUri,
          policy_uri AS policyUri,
          software_id AS softwareId,
          software_version AS softwareVersion,
          client_id_issued_at AS clientIdIssuedAt,
          client_secret_expires_at AS clientSecretExpiresAt
        FROM mcp_oauth_clients
        WHERE client_id = ?
        LIMIT 1
      `,
      )
      .bind(clientId)
      .first<OAuthClientRow>();

    if (!row) return undefined;
    return clientFromRow(row);
  }

  async registerClient(client: OAuthClientRegistration): Promise<OAuthClientInformation> {
    const clientId = this.options.createClientId();
    const clientIdIssuedAt = nowEpochSeconds();
    await this.db
      .prepare(
        `
        INSERT INTO mcp_oauth_clients (
          client_id,
          client_secret,
          client_name,
          redirect_uris_json,
          scope,
          grant_types_json,
          response_types_json,
          token_endpoint_auth_method,
          client_uri,
          logo_uri,
          contacts_json,
          tos_uri,
          policy_uri,
          software_id,
          software_version,
          client_id_issued_at,
          client_secret_expires_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `,
      )
      .bind(
        clientId,
        client.client_secret ?? null,
        client.client_name ?? null,
        jsonArray(client.redirect_uris),
        client.scope ?? this.options.defaultScope,
        jsonArray(client.grant_types),
        jsonArray(client.response_types),
        client.token_endpoint_auth_method ?? this.options.tokenEndpointAuthMethod,
        client.client_uri ?? null,
        client.logo_uri ?? null,
        jsonArray(client.contacts),
        client.tos_uri ?? null,
        client.policy_uri ?? null,
        client.software_id ?? null,
        client.software_version ?? null,
        clientIdIssuedAt,
        client.client_secret_expires_at ?? null,
      )
      .run();

    const registered = await this.getClient(clientId);
    if (!registered) throw new Error("registered OAuth client missing");
    return registered;
  }

  async createAuthorizationCode(input: {
    code: string;
    clientId: string;
    subject: Record<string, string>;
    redirectUri: string;
    scopes: string[];
    resource: string | null;
    codeChallenge: string;
    expiresAt?: number;
  }): Promise<void> {
    const subjectColumns = this.options.subjectColumns.map((column) => quoteIdentifier(column.column));
    const subjectValues = this.options.subjectColumns.map((column) => requiredSubject(input.subject, column.field));
    await this.db
      .prepare(
        `
        INSERT INTO mcp_oauth_authorization_codes (
          authorization_code_id,
          code_hash,
          client_id,
          ${subjectColumns.join(",\n          ")},
          redirect_uri,
          scopes_json,
          resource,
          code_challenge,
          expires_at,
          updated_at
        ) VALUES (${["?", "?", "?", ...subjectValues.map(() => "?"), "?", "?", "?", "?", "?", "CURRENT_TIMESTAMP"].join(", ")})
      `,
      )
      .bind(
        this.options.createAuthorizationCodeId(),
        await sha256Hex(input.code),
        input.clientId,
        ...subjectValues,
        input.redirectUri,
        jsonArray(input.scopes),
        input.resource,
        input.codeChallenge,
        input.expiresAt ?? nowEpochSeconds() + DEFAULT_AUTH_CODE_TTL_SECONDS,
      )
      .run();
  }

  async getAuthorizationCode(code: string): Promise<McpAuthorizationCodeRow | null> {
    const subjectSelect = this.subjectSelectSql();
    const row = await this.db
      .prepare(
        `
        SELECT
          authorization_code_id AS authorizationCodeId,
          client_id AS clientId,
          ${subjectSelect}
          redirect_uri AS redirectUri,
          scopes_json AS scopesJson,
          resource,
          code_challenge AS codeChallenge,
          expires_at AS expiresAt,
          used_at AS usedAt
        FROM mcp_oauth_authorization_codes
        WHERE code_hash = ?
        LIMIT 1
      `,
      )
      .bind(await sha256Hex(code))
      .first<AuthorizationCodeStorageRow>();
    return row ? authorizationCodeFromRow(row, this.options.subjectColumns) : null;
  }

  async consumeAuthorizationCode(authorizationCodeId: string): Promise<void> {
    await this.db
      .prepare(
        `
        UPDATE mcp_oauth_authorization_codes
        SET used_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE authorization_code_id = ?
      `,
      )
      .bind(authorizationCodeId)
      .run();
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
    const subjectColumns = this.options.subjectColumns.map((column) => quoteIdentifier(column.column));
    const subjectValues = this.options.subjectColumns.map((column) => requiredSubject(input.subject, column.field));
    const tokenId = this.options.createTokenId();
    await this.db
      .prepare(
        `
        INSERT INTO mcp_oauth_tokens (
          token_id,
          client_id,
          ${subjectColumns.join(",\n          ")},
          access_token_hash,
          refresh_token_hash,
          scopes_json,
          resource,
          access_expires_at,
          refresh_expires_at,
          updated_at
        ) VALUES (${["?", "?", ...subjectValues.map(() => "?"), "?", "?", "?", "?", "?", "?", "CURRENT_TIMESTAMP"].join(", ")})
      `,
      )
      .bind(
        tokenId,
        input.clientId,
        ...subjectValues,
        await sha256Hex(input.accessToken),
        input.refreshToken ? await sha256Hex(input.refreshToken) : null,
        jsonArray(input.scopes),
        input.resource,
        input.accessExpiresAt,
        input.refreshExpiresAt,
      )
      .run();
    return tokenId;
  }

  async getTokenByAccessToken(token: string): Promise<McpTokenRow | null> {
    return this.getTokenByHashColumn("access_token_hash", token);
  }

  async getTokenByRefreshToken(token: string): Promise<McpTokenRow | null> {
    return this.getTokenByHashColumn("refresh_token_hash", token);
  }

  async revokeToken(tokenId: string): Promise<void> {
    await this.db
      .prepare(
        `
        UPDATE mcp_oauth_tokens
        SET revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE token_id = ?
      `,
      )
      .bind(tokenId)
      .run();
  }

  async touchAccessToken(tokenId: string): Promise<void> {
    await this.db
      .prepare(
        `
        UPDATE mcp_oauth_tokens
        SET access_last_used_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE token_id = ?
      `,
      )
      .bind(tokenId)
      .run();
  }

  async markTokenRotated(input: {
    tokenId: string;
    rotatedToTokenId: string;
    refreshReuseExpiresAt: number;
    rotatedResponseCiphertext: string;
    rotatedResponseNonce: string;
  }): Promise<boolean> {
    if (!this.options.refreshRotationColumns) {
      await this.revokeToken(input.tokenId);
      return true;
    }
    const result = await this.db
      .prepare(
        `
        UPDATE mcp_oauth_tokens
        SET
          revoked_at = CURRENT_TIMESTAMP,
          rotated_to_token_id = ?,
          refresh_reuse_expires_at = ?,
          rotated_response_ciphertext = ?,
          rotated_response_nonce = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE token_id = ? AND rotated_to_token_id IS NULL
      `,
      )
      .bind(input.rotatedToTokenId, input.refreshReuseExpiresAt, input.rotatedResponseCiphertext, input.rotatedResponseNonce, input.tokenId)
      .run();
    return Number(result.meta.changes ?? 0) > 0;
  }

  private async getTokenByHashColumn(column: "access_token_hash" | "refresh_token_hash", token: string): Promise<McpTokenRow | null> {
    const subjectSelect = this.subjectSelectSql();
    const rotationSelect = this.options.refreshRotationColumns
      ? `
          rotated_to_token_id AS rotatedToTokenId,
          refresh_reuse_expires_at AS refreshReuseExpiresAt,
          rotated_response_ciphertext AS rotatedResponseCiphertext,
          rotated_response_nonce AS rotatedResponseNonce,
        `
      : "";
    const row = await this.db
      .prepare(
        `
        SELECT
          token_id AS tokenId,
          client_id AS clientId,
          ${subjectSelect}
          scopes_json AS scopesJson,
          resource,
          access_expires_at AS accessExpiresAt,
          refresh_expires_at AS refreshExpiresAt,
          revoked_at AS revokedAt,
          ${rotationSelect}
          token_id AS tokenIdAgain
        FROM mcp_oauth_tokens
        WHERE ${column} = ?
        LIMIT 1
      `,
      )
      .bind(await sha256Hex(token))
      .first<TokenStorageRow>();
    return row ? tokenFromRow(row, this.options.subjectColumns) : null;
  }

  private subjectSelectSql(): string {
    return this.options.subjectColumns.map((column) => `${quoteIdentifier(column.column)} AS ${quoteIdentifier(column.field)},`).join("\n          ");
  }
}

export async function issueMcpOAuthTokenSet(
  repository: McpOAuthRepository,
  input: {
    clientId: string;
    subject: Record<string, string>;
    scopes: string[];
    resource?: URL | null;
  },
  options: McpOAuthTokenOptions = {},
): Promise<McpIssuedTokenSet> {
  const accessToken = options.createAccessToken?.() ?? `${createToken("mcpat")}.${crypto.randomUUID().replace(/-/g, "")}`;
  const refreshToken = options.createRefreshToken?.() ?? `${createToken("mcprt")}.${crypto.randomUUID().replace(/-/g, "")}`;
  const issuedAt = options.now?.() ?? nowEpochSeconds();
  const accessExpiresAt = issuedAt + (options.accessTokenTtlSeconds ?? DEFAULT_ACCESS_TOKEN_TTL_SECONDS);
  const refreshExpiresAt = issuedAt + (options.refreshTokenTtlSeconds ?? DEFAULT_REFRESH_TOKEN_TTL_SECONDS);
  const tokenId = await repository.createTokenSet({
    clientId: input.clientId,
    subject: input.subject,
    accessToken,
    refreshToken,
    scopes: input.scopes,
    resource: input.resource?.href ?? null,
    accessExpiresAt,
    refreshExpiresAt,
  });
  return {
    tokenId,
    accessExpiresAt,
    refreshExpiresAt,
    tokens: {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: options.accessTokenTtlSeconds ?? DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      scope: input.scopes.join(" "),
    },
  };
}

export function parseOAuthScope(scope: string | null | undefined): string[] {
  return scope?.split(/\s+/).filter(Boolean) ?? [];
}

export function parseOAuthJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function createOAuthRedirect(redirectUri: string, params: Record<string, string | undefined>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}

export async function encryptOAuthTokenResponse(tokens: OAuthTokens, secret: string): Promise<{ ciphertext: string; nonce: string }> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await tokenResponseEncryptionKey(secret);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, new TextEncoder().encode(JSON.stringify(tokens)));
  return {
    ciphertext: toBase64Url(new Uint8Array(ciphertext)),
    nonce: toBase64Url(nonce),
  };
}

export async function decryptOAuthTokenResponse(ciphertext: string, nonce: string, secret: string): Promise<OAuthTokens | null> {
  try {
    const key = await tokenResponseEncryptionKey(secret);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: toArrayBuffer(fromBase64Url(nonce)) }, key, toArrayBuffer(fromBase64Url(ciphertext)));
    return JSON.parse(new TextDecoder().decode(plaintext)) as OAuthTokens;
  } catch {
    return null;
  }
}

function setExtraSearchParams(url: URL, params: Record<string, string | undefined> | undefined): void {
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
}

type OAuthClientRow = {
  clientId: string;
  clientSecret: string | null;
  clientName: string | null;
  redirectUrisJson: string;
  scope: string | null;
  grantTypesJson: string | null;
  responseTypesJson: string | null;
  tokenEndpointAuthMethod: string | null;
  clientUri: string | null;
  logoUri: string | null;
  contactsJson: string | null;
  tosUri: string | null;
  policyUri: string | null;
  softwareId: string | null;
  softwareVersion: string | null;
  clientIdIssuedAt: number | null;
  clientSecretExpiresAt: number | null;
};

type AuthorizationCodeStorageRow = {
  authorizationCodeId: string;
  clientId: string;
  redirectUri: string;
  scopesJson: string;
  resource: string | null;
  codeChallenge: string;
  expiresAt: number;
  usedAt: string | null;
} & Record<string, string | number | null>;

type TokenStorageRow = {
  tokenId: string;
  clientId: string;
  scopesJson: string;
  resource: string | null;
  accessExpiresAt: number;
  refreshExpiresAt: number | null;
  revokedAt: string | null;
  rotatedToTokenId?: string | null;
  refreshReuseExpiresAt?: number | null;
  rotatedResponseCiphertext?: string | null;
  rotatedResponseNonce?: string | null;
} & Record<string, string | number | null | undefined>;

function clientFromRow(row: OAuthClientRow): OAuthClientInformation {
  return {
    client_id: row.clientId,
    client_secret: row.clientSecret ?? undefined,
    client_name: row.clientName ?? undefined,
    redirect_uris: parseOAuthJsonArray(row.redirectUrisJson),
    scope: row.scope ?? undefined,
    grant_types: parseOAuthJsonArray(row.grantTypesJson),
    response_types: parseOAuthJsonArray(row.responseTypesJson),
    token_endpoint_auth_method: row.tokenEndpointAuthMethod ?? undefined,
    client_uri: row.clientUri ?? undefined,
    logo_uri: row.logoUri ?? undefined,
    contacts: parseOAuthJsonArray(row.contactsJson),
    tos_uri: row.tosUri ?? undefined,
    policy_uri: row.policyUri ?? undefined,
    software_id: row.softwareId ?? undefined,
    software_version: row.softwareVersion ?? undefined,
    client_id_issued_at: row.clientIdIssuedAt ?? undefined,
    client_secret_expires_at: row.clientSecretExpiresAt ?? undefined,
  };
}

function authorizationCodeFromRow(row: AuthorizationCodeStorageRow, subjectColumns: McpOAuthSubjectColumn[]): McpAuthorizationCodeRow {
  return {
    authorizationCodeId: row.authorizationCodeId,
    clientId: row.clientId,
    redirectUri: row.redirectUri,
    scopesJson: row.scopesJson,
    resource: row.resource,
    codeChallenge: row.codeChallenge,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    subject: subjectFromRow(row, subjectColumns),
  };
}

function tokenFromRow(row: TokenStorageRow, subjectColumns: McpOAuthSubjectColumn[]): McpTokenRow {
  return {
    tokenId: row.tokenId,
    clientId: row.clientId,
    scopesJson: row.scopesJson,
    resource: row.resource,
    accessExpiresAt: row.accessExpiresAt,
    refreshExpiresAt: row.refreshExpiresAt,
    revokedAt: row.revokedAt,
    subject: subjectFromRow(row, subjectColumns),
    rotatedToTokenId: row.rotatedToTokenId,
    refreshReuseExpiresAt: row.refreshReuseExpiresAt,
    rotatedResponseCiphertext: row.rotatedResponseCiphertext,
    rotatedResponseNonce: row.rotatedResponseNonce,
  };
}

function subjectFromRow(row: Record<string, string | number | null | undefined>, subjectColumns: McpOAuthSubjectColumn[]): Record<string, string> {
  const subject: Record<string, string> = {};
  for (const column of subjectColumns) {
    const value = row[column.field];
    if (typeof value === "string") subject[column.field] = value;
  }
  return subject;
}

function requiredSubject(subject: Record<string, string>, field: string): string {
  const value = subject[field];
  if (!value) throw new Error(`Missing OAuth subject field: ${field}`);
  return value;
}

function jsonArray(value: string[] | null | undefined): string {
  return JSON.stringify(value ?? []);
}

function nowEpochSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function quoteIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe SQL identifier: ${value}`);
  }
  return `"${value}"`;
}

async function tokenResponseEncryptionKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
