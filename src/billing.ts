export type BillingPlan = {
  id: string;
  name: string;
  rank: number;
  stripePriceId?: string;
  limits?: Record<string, number>;
};

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete"
  | "incomplete_expired"
  | "paused";

export type BillingCustomer = {
  customerId: string;
  email?: string;
  planId?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  subscriptionStatus?: SubscriptionStatus;
};

export function planAtLeast(plans: BillingPlan[], actualPlanId: string | null | undefined, requiredPlanId: string): boolean {
  const byId = new Map(plans.map((plan) => [plan.id, plan]));
  const actual = actualPlanId ? byId.get(actualPlanId) : undefined;
  const required = byId.get(requiredPlanId);
  if (!actual || !required) return false;
  return actual.rank >= required.rank;
}

export function activeSubscriptionStatuses(): SubscriptionStatus[] {
  return ["trialing", "active"];
}

export function isActiveSubscriptionStatus(status: SubscriptionStatus | null | undefined): boolean {
  return status === "trialing" || status === "active";
}

export function stripeEventAlreadyProcessedMessage(eventId: string): string {
  return `Stripe event already processed: ${eventId}`;
}
