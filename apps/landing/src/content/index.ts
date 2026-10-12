import { ar } from './ar';
import { en, type Copy } from './en';
import { fr } from './fr';
import type { Lang } from './lang';

export type { Copy } from './en';
export * from './lang';

export const copies: Record<Lang, Copy> = { en, fr, ar };
