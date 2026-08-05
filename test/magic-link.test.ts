import { describe, expect, it, vi } from "vitest";
import {
  createMagicLinkConfirmation,
  renderMagicLinkConfirmationPage,
  verifyMagicLinkTurnstile,
} from "../src/magic-link.js";

const brand = {
  productName: "Signal Garden",
  logoUrl: "/logo.svg",
  accentColor: "#5b3fd8",
};

describe("magic-link confirmation", () => {
  it("stages the token in an HttpOnly cookie and renders a branded auto-submit page", async () => {
    const flow = createMagicLinkConfirmation({
      cookieName: "signal_magic_stage",
      brand,
      consume: async () => new Response(null, { status: 303, headers: { location: "/app" } }),
    });

    const response = await flow.handle(new Request("https://signal.example/auth/verify?token=secret"), "secret");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("signal_magic_stage=secret");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Strict");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(html).toContain("Signal Garden");
    expect(html).toContain("/logo.svg");
    expect(html).toContain("requestSubmit()");
    expect(html).not.toContain("secret");
  });

  it("passes the staged token to the consumer on a same-origin POST and clears it", async () => {
    const consume = vi.fn(async () => new Response(null, { status: 303, headers: { location: "/dashboard" } }));
    const flow = createMagicLinkConfirmation({ cookieName: "signal_magic_stage", brand, consume });
    const request = new Request("https://signal.example/auth/verify", {
      method: "POST",
      headers: {
        cookie: "other=1; signal_magic_stage=token%20value",
        origin: "https://signal.example",
        "sec-fetch-site": "same-origin",
      },
    });

    const response = await flow.handle(request);

    expect(consume).toHaveBeenCalledWith("token value", request);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/dashboard");
    expect(response.headers.get("set-cookie")).toContain("signal_magic_stage=");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("rejects cross-origin submissions before consuming the token", async () => {
    const consume = vi.fn(async () => new Response(null, { status: 303, headers: { location: "/app" } }));
    const flow = createMagicLinkConfirmation({ cookieName: "signal_magic_stage", brand, consume });
    const response = await flow.handle(
      new Request("https://signal.example/auth/verify", {
        method: "POST",
        headers: { cookie: "signal_magic_stage=secret", origin: "https://scanner.example" },
      }),
    );

    expect(response.status).toBe(403);
    expect(consume).not.toHaveBeenCalled();
  });

  it("waits for Turnstile before submitting when configured", () => {
    const html = renderMagicLinkConfirmationPage(brand, {
      actionPath: "/auth/verify",
      turnstileSiteKey: "site-key",
      nonce: "fixed-nonce",
    });

    expect(html).toContain("data-sitekey=\"site-key\"");
    expect(html).toContain("q32MagicLinkReady");
    expect(html).not.toContain('DOMContentLoaded",function(){document.getElementById("magic-link-confirmation").requestSubmit()');
  });

  it("verifies Turnstile action and hostname", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ success: true, action: "magic_link", hostname: "signal.example" }),
    );
    const request = new Request("https://signal.example/auth/verify", {
      headers: { "cf-connecting-ip": "192.0.2.10" },
    });

    const result = await verifyMagicLinkTurnstile(request, "response-token", {
      siteKey: "site-key",
      secretKey: "secret-key",
      expectedAction: "magic_link",
      expectedHostname: "signal.example",
      fetcher,
    });

    expect(result.success).toBe(true);
    const [, init] = fetcher.mock.calls[0] ?? [];
    expect(init?.method).toBe("POST");
    expect((init?.body as FormData).get("remoteip")).toBe("192.0.2.10");
  });

  it("does not consume when Turnstile fails", async () => {
    const consume = vi.fn(async () => new Response(null, { status: 303, headers: { location: "/app" } }));
    const flow = createMagicLinkConfirmation({
      cookieName: "signal_magic_stage",
      brand,
      consume,
      turnstile: {
        siteKey: "site-key",
        secretKey: "secret-key",
        fetcher: async () => Response.json({ success: false, "error-codes": ["invalid-input-response"] }),
      },
    });
    const form = new FormData();
    form.set("cf-turnstile-response", "bad-token");
    const response = await flow.handle(
      new Request("https://signal.example/auth/verify", {
        method: "POST",
        headers: { cookie: "signal_magic_stage=secret", origin: "https://signal.example" },
        body: form,
      }),
    );

    expect(response.status).toBe(400);
    expect(consume).not.toHaveBeenCalled();
  });
});
