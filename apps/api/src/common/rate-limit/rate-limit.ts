import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ClockService } from '../clock/clock.service';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env.schema';
import { AppException, ErrorCode } from '../errors/app-exception';
import type { AuthUser } from '../auth/auth-user';

export interface RateLimitRule {
  /** Distinguishes rules sharing a key (e.g. "login" vs "register"). */
  name: string;
  limit: number;
  windowS: number;
  /** `ip`, `user`, or `body.<field>` (value lowercased, e.g. an email). */
  by: 'ip' | 'user' | `body.${string}`;
}

const RATE_LIMITS = 'rateLimits';
export const RateLimit = (...rules: RateLimitRule[]) => SetMetadata(RATE_LIMITS, rules);

/** Applied to every route on top of route-specific rules (docs §9.3). */
const GLOBAL_RULES: RateLimitRule[] = [
  { name: 'global-ip', limit: 300, windowS: 60, by: 'ip' },
  { name: 'global-user', limit: 120, windowS: 60, by: 'user' },
];

/**
 * Fixed-window counters. In-memory: correct for a single API instance.
 * ASSUMPTION: moves to Redis (same interface) before running more than one API instance.
 */
export class RateLimitStore {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  hit(key: string, windowS: number, now: number): { count: number; resetAt: number } {
    const current = this.windows.get(key);
    if (!current || current.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowS * 1000 };
      this.windows.set(key, fresh);
      if (this.windows.size > 100_000) this.sweep(now);
      return fresh;
    }
    current.count += 1;
    return current;
  }

  private sweep(now: number): void {
    for (const [k, v] of this.windows) if (v.resetAt <= now) this.windows.delete(k);
  }
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly store = new RateLimitStore();

  constructor(
    private readonly reflector: Reflector,
    private readonly clock: ClockService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.env.RATE_LIMIT_ENABLED || context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const routeRules = this.reflector.getAllAndOverride<RateLimitRule[] | undefined>(RATE_LIMITS, [context.getHandler(), context.getClass()]) ?? [];
    const now = this.clock.now().getTime();

    for (const rule of [...GLOBAL_RULES, ...routeRules]) {
      const subject = this.subject(rule, req);
      if (subject === undefined) continue;
      const { count, resetAt } = this.store.hit(`${rule.name}:${subject}`, rule.windowS, now);
      if (count > rule.limit) {
        throw new AppException(HttpStatus.TOO_MANY_REQUESTS, ErrorCode.RATE_LIMITED, 'Too many requests', {
          headers: { 'Retry-After': String(Math.ceil((resetAt - now) / 1000)) },
        });
      }
    }
    return true;
  }

  private subject(rule: RateLimitRule, req: Request & { user?: AuthUser }): string | undefined {
    if (rule.by === 'ip') return req.ip ?? 'unknown';
    if (rule.by === 'user') return req.user?.id;
    const value = (req.body as Record<string, unknown> | undefined)?.[rule.by.slice(5)];
    return typeof value === 'string' ? value.trim().toLowerCase() : undefined;
  }
}
