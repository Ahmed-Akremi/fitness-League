import type { Json } from '../../../core/api/client';
import { fromMillimes, toMillimes } from './logic';

/**
 * Organisation update, phase 3: what an athlete pays and what the organizer receives. Kept on the device for now
 * (the competition's `pricing`). Amounts are millimes. The platform fee below is a placeholder until the owner sets
 * the real one (Circle21 charges 4 % + 1.5 €).
 */

export const PLATFORM_FEE = { percent: 4, fixed: 1500 };

export type FeeDistribution = 'PASS' | 'SPLIT' | 'ABSORB';
export type PricingSettings = {
  /** PLATFORM: the platform collects and pays out after registration; DIRECT: the organizer's own account (needs the server). */
  payout: 'PLATFORM' | 'DIRECT';
  fee: FeeDistribution;
  tax: { enabled: boolean; percent: number; number: string; mode: 'INCLUDED' | 'ADDED' };
  deposit: { enabled: boolean; type: 'FIXED' | 'PERCENT'; value: number; deadline: string | null; refundable: boolean };
};

export function pricingOf(c: Json): PricingSettings {
  const p: Json = c.pricing ?? {};
  return {
    payout: p.payout === 'DIRECT' ? 'DIRECT' : 'PLATFORM',
    fee: p.fee === 'SPLIT' || p.fee === 'ABSORB' ? p.fee : 'PASS',
    tax: { enabled: p.tax?.enabled === true, percent: typeof p.tax?.percent === 'number' ? p.tax.percent : 19, number: p.tax?.number ?? '', mode: p.tax?.mode === 'ADDED' ? 'ADDED' : 'INCLUDED' },
    deposit: {
      enabled: p.deposit?.enabled === true,
      type: p.deposit?.type === 'FIXED' ? 'FIXED' : 'PERCENT',
      value: typeof p.deposit?.value === 'number' ? p.deposit.value : 30,
      deadline: p.deposit?.deadline ?? null,
      refundable: p.deposit?.refundable === true,
    },
  };
}

/** The division's early-bird price until its date, else its own price, else the event's. */
export function effectivePrice(c: Json, cat: Json | null, now: Date): number {
  const base = cat?.registrationPriceOverride ?? c.registrationPrice ?? 0;
  if (cat?.earlyPrice != null && cat.earlyUntil && now.getTime() < new Date(cat.earlyUntil).getTime()) return cat.earlyPrice;
  return base;
}

export type Breakdown = { price: number; discount: number; net: number; tax: number; subtotal: number; fee: number; athletePays: number; organizerGets: number; depositNow: number; balance: number };

/** Promo code first, then VAT (added on top or taken out of the price), then the platform fee shared as chosen, then the deposit. */
export function priceBreakdown({ price, discount = 0 }: { price: number; discount?: number }, p: PricingSettings): Breakdown {
  const net = Math.max(0, price - discount);
  let tax = 0;
  let subtotal = net;
  if (p.tax.enabled && p.tax.percent > 0) {
    if (p.tax.mode === 'ADDED') {
      tax = Math.round((net * p.tax.percent) / 100);
      subtotal = net + tax;
    } else {
      tax = net - Math.round((net * 100) / (100 + p.tax.percent));
    }
  }
  const fee = subtotal > 0 ? Math.round((subtotal * PLATFORM_FEE.percent) / 100) + PLATFORM_FEE.fixed : 0;
  const athleteShare = p.fee === 'PASS' ? fee : p.fee === 'SPLIT' ? Math.ceil(fee / 2) : 0;
  const athletePays = subtotal + athleteShare;
  const organizerGets = subtotal - (fee - athleteShare);
  let depositNow = athletePays;
  if (p.deposit.enabled && athletePays > 0) depositNow = p.deposit.type === 'FIXED' ? Math.min(p.deposit.value, athletePays) : Math.round((athletePays * p.deposit.value) / 100);
  return { price, discount, net, tax, subtotal, fee, athletePays, organizerGets, depositNow, balance: athletePays - depositNow };
}

// ───────────── Pricing page form ─────────────

export type PricingDraft = {
  payout: PricingSettings['payout'];
  fee: FeeDistribution;
  taxEnabled: boolean;
  taxPercent: string;
  taxNumber: string;
  taxMode: 'INCLUDED' | 'ADDED';
  depositEnabled: boolean;
  depositType: 'FIXED' | 'PERCENT';
  /** TND for a fixed deposit, a percentage otherwise. */
  depositValue: string;
  depositDeadline: Date | null;
  depositRefundable: boolean;
};
export type PricingProblem = 'TAX_PERCENT' | 'DEPOSIT_VALUE';

export function pricingDraft(c: Json): PricingDraft {
  const p = pricingOf(c);
  return {
    payout: p.payout,
    fee: p.fee,
    taxEnabled: p.tax.enabled,
    taxPercent: String(p.tax.percent),
    taxNumber: p.tax.number,
    taxMode: p.tax.mode,
    depositEnabled: p.deposit.enabled,
    depositType: p.deposit.type,
    depositValue: p.deposit.type === 'FIXED' ? fromMillimes(p.deposit.value) : String(p.deposit.value),
    depositDeadline: p.deposit.deadline ? new Date(p.deposit.deadline) : null,
    depositRefundable: p.deposit.refundable,
  };
}

const percent = (s: string) => Number(s.trim().replace(',', '.'));

export function pricingProblems(d: PricingDraft): PricingProblem[] {
  const problems: PricingProblem[] = [];
  if (d.taxEnabled && !(percent(d.taxPercent) > 0 && percent(d.taxPercent) <= 100)) problems.push('TAX_PERCENT');
  if (d.depositEnabled) {
    const ok = d.depositType === 'PERCENT' ? percent(d.depositValue) > 0 && percent(d.depositValue) < 100 : (toMillimes(d.depositValue) ?? 0) > 0;
    if (!ok) problems.push('DEPOSIT_VALUE');
  }
  return problems;
}

export function pricingBody(d: PricingDraft): Json {
  return {
    payout: d.payout,
    fee: d.fee,
    tax: { enabled: d.taxEnabled, percent: percent(d.taxPercent) || 0, number: d.taxNumber.trim(), mode: d.taxMode },
    deposit: {
      enabled: d.depositEnabled,
      type: d.depositType,
      value: d.depositType === 'FIXED' ? toMillimes(d.depositValue) ?? 0 : percent(d.depositValue) || 0,
      deadline: d.depositDeadline ? d.depositDeadline.toISOString() : null,
      refundable: d.depositRefundable,
    },
  };
}
