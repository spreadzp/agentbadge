/**
 * SLICE-99-7: Tier gating per spec v0.7 §10.5.
 *
 * Free: 1 project, daily schedule, webhook+email channels only.
 * Paid: unlimited projects, all channels, all schedules.
 *
 * Stripe sync is OUT of this spec version.
 * resolvePlan() is the hook for future Stripe wiring.
 */

import type { ChannelConfig, ScheduleConfig } from "./monitoring-types";

export const FREE_LIMITS = {
  max_projects: 1,
  allowed_schedule_kinds: ["daily"] as const,
  allowed_channel_types: ["webhook", "email"] as const,
};

export type Plan = "free" | "paid";

export interface TierCheckResult {
  allowed: boolean;
  error?: string;
}

/**
 * Resolve plan from requester context.
 * Future: Stripe sync will set plan from subscription status.
 * For now: default free, manual upgrade via env/admin.
 */
export function resolvePlan(ctx: Record<string, unknown>): Plan {
  if (ctx.plan === "paid") return "paid";
  // Check env for global override
  if (process.env.MONITORING_DEFAULT_PLAN === "paid") return "paid";
  return "free";
}

export function checkProjectLimit(plan: Plan, currentCount: number): TierCheckResult {
  if (plan === "paid") return { allowed: true };
  if (currentCount >= FREE_LIMITS.max_projects) {
    return {
      allowed: false,
      error: `Free plan limited to ${FREE_LIMITS.max_projects} project. Upgrade to paid for unlimited projects.`,
    };
  }
  return { allowed: true };
}

export function checkScheduleAllowed(plan: Plan, scheduleKind: string): TierCheckResult {
  if (plan === "paid") return { allowed: true };
  if (!FREE_LIMITS.allowed_schedule_kinds.includes(scheduleKind as any)) {
    return {
      allowed: false,
      error: `Free plan supports ${FREE_LIMITS.allowed_schedule_kinds.join(", ")} schedules only. Upgrade to paid for weekly schedules.`,
    };
  }
  return { allowed: true };
}

export function checkChannelsAllowed(plan: Plan, channels: ChannelConfig[]): TierCheckResult {
  if (plan === "paid") return { allowed: true };
  for (const ch of channels) {
    if (!FREE_LIMITS.allowed_channel_types.includes(ch.type as any)) {
      return {
        allowed: false,
        error: `Free plan supports ${FREE_LIMITS.allowed_channel_types.join(", ")} channels only. Upgrade to paid for ${ch.type}.`,
      };
    }
  }
  return { allowed: true };
}
