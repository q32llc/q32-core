import type { FetchLike } from "./http.js";
import { defaultFetch } from "./http.js";

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

function setExtraSearchParams(url: URL, params: Record<string, string | undefined> | undefined): void {
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
}
