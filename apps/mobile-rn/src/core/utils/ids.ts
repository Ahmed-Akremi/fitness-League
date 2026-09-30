import { randomUUID } from 'expo-crypto';

/** Client-generated workout ids double as idempotency keys (docs §10). */
export const newClientId = (): string => randomUUID();
