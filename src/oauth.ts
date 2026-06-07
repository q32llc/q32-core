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
