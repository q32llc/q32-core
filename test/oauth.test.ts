import { describe, expect, it } from "vitest";
import { GitHubOAuthClient, GoogleOAuthClient } from "../src/oauth.js";

describe("OAuth provider clients", () => {
  it("builds Google authorization URLs with app-specific extra params", () => {
    const url = new URL(
      new GoogleOAuthClient().buildAuthorizationUrl({
        clientId: "google_client",
        redirectUri: "https://app.test/auth/google/callback",
        state: "state_1",
        extraParams: { prompt: "select_account" },
      }),
    );

    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(url.searchParams.get("client_id")).toBe("google_client");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.test/auth/google/callback",
    );
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("state")).toBe("state_1");
    expect(url.searchParams.get("prompt")).toBe("select_account");
  });

  it("exchanges Google codes and validates profile identity fields", async () => {
    const client = new GoogleOAuthClient(async (input, init) => {
      if (String(input).includes("/token")) {
        expect(init?.method).toBe("POST");
        return Response.json({ access_token: "google_access" });
      }
      expect(init?.headers).toMatchObject({
        authorization: "Bearer google_access",
      });
      return Response.json({
        sub: "google_sub",
        email: "owner@example.com",
        email_verified: true,
      });
    });

    const token = await client.exchangeCode({
      clientId: "id",
      clientSecret: "secret",
      code: "code",
      redirectUri: "https://app.test/callback",
    });
    const profile = await client.fetchUserProfile(token.accessToken, {
      requireVerifiedEmail: true,
    });

    expect(token.accessToken).toBe("google_access");
    expect(profile.sub).toBe("google_sub");
  });

  it("builds GitHub URLs and fetches primary verified email", async () => {
    const requests: string[] = [];
    const client = new GitHubOAuthClient({
      userAgent: "test-app",
      fetch: async (input, init) => {
        requests.push(String(input));
        expect(init?.headers).toMatchObject({ "user-agent": "test-app" });
        if (String(input).endsWith("/user")) {
          return Response.json({
            id: 123,
            login: "owner",
            email: null,
            name: "Owner",
            avatar_url: null,
          });
        }
        return Response.json([
          { email: "backup@example.com", primary: false, verified: true },
          { email: "owner@example.com", primary: true, verified: true },
        ]);
      },
    });
    const url = new URL(
      client.buildAuthorizationUrl({
        clientId: "github_client",
        redirectUri: "https://app.test/auth/github/callback",
        state: "state_1",
      }),
    );

    const profile = await client.fetchUserProfile("github_access");
    const email = await client.fetchPrimaryEmail("github_access");

    expect(url.origin + url.pathname).toBe(
      "https://github.com/login/oauth/authorize",
    );
    expect(url.searchParams.get("scope")).toBe("read:user user:email");
    expect(profile.login).toBe("owner");
    expect(email).toBe("owner@example.com");
    expect(requests).toEqual([
      "https://api.github.com/user",
      "https://api.github.com/user/emails",
    ]);
  });
});
