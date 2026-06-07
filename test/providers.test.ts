import { describe, expect, it } from "vitest";
import { extractJsonObject, systemUserMessages } from "../src/ai.js";
import { activeSubscriptionStatuses, isActiveSubscriptionStatus, planAtLeast, stripeEventAlreadyProcessedMessage } from "../src/billing.js";
import { appendUnsubscribeFooter, formatEmailAddress, normalizeEmailAddress } from "../src/email.js";

describe("AI helpers", () => {
  it("builds messages and extracts json", () => {
    expect(systemUserMessages("sys", "user")).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "user" },
    ]);
    expect(extractJsonObject('```json\n{"ok":true}\n```')).toEqual({ ok: true });
    expect(() => extractJsonObject("not json")).toThrow("No JSON object");
  });
});

describe("billing helpers", () => {
  const plans = [
    { id: "free", name: "Free", rank: 0 },
    { id: "pro", name: "Pro", rank: 10 },
  ];

  it("compares plans and statuses", () => {
    expect(planAtLeast(plans, "pro", "free")).toBe(true);
    expect(planAtLeast(plans, "free", "pro")).toBe(false);
    expect(activeSubscriptionStatuses()).toEqual(["trialing", "active"]);
    expect(isActiveSubscriptionStatus("active")).toBe(true);
    expect(isActiveSubscriptionStatus("past_due")).toBe(false);
    expect(stripeEventAlreadyProcessedMessage("evt_1")).toContain("evt_1");
  });
});

describe("email helpers", () => {
  it("formats, validates, and appends unsubscribe footers", () => {
    expect(formatEmailAddress({ name: 'A "B"', email: "a@example.com" })).toBe('"A \\"B\\"" <a@example.com>');
    expect(normalizeEmailAddress(" USER@Example.COM ")).toBe("user@example.com");
    expect(() => normalizeEmailAddress("bad")).toThrow("Invalid email");
    expect(appendUnsubscribeFooter("Hello", "https://example.com/u")).toContain("Unsubscribe");
  });
});
