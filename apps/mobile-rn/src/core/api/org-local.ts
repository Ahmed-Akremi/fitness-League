import type { Fetch } from './client';
import { withLocalRoutes, type LocalLayer } from './local-routes';
import { asyncStoragePersistence, LocalStore } from './local-store';

/**
 * What the organizer space keeps on the device until the API has it (design 2026-10-22). Each phase adds its routes
 * and fields here, and documents them in docs/organisation-backend-contract.md; when the server takes one over, it
 * leaves this list.
 */
export const ORG_LOCAL_LAYER: LocalLayer = {
  competitionFields: [
    // Phase 1
    'eventStyle',
    // Phase 2: setup
    'hybridTemplate',
    'visibility',
    'accessCode',
    'participantTypes',
    'label',
    'inviteOnly',
    // Phase 2: contact and links
    'organizerName',
    'contactEmail',
    'website',
    'instagram',
    'facebook',
    'videoUrl',
    'rulebookUrl',
    // Phase 2: Settings page
    'settings',
    // Phase 3: pricing, registration form, agreements
    'pricing',
    'registrationForm',
    'agreements',
  ],
  // Phase 3: divisions (`features/competitions/organizer/logic-division.ts`)
  categoryFields: ['type', 'teamMale', 'teamFemale', 'parentId', 'locked', 'unlockCode', 'earlyPrice', 'earlyUntil', 'teamNameChangeUntil', 'memberChangeUntil', 'memberChangePrice', 'oneMemberStays'],
  routes: [],
};

/** `EXPO_PUBLIC_ORG_LOCAL=false` turns the layer off (a build where the server has every route). */
export const orgLocalEnabled = (value: string | undefined) => value !== 'false';

export function withOrgLocal(inner: Fetch, enabled: boolean, store: LocalStore = new LocalStore(asyncStoragePersistence())): Fetch {
  return enabled ? withLocalRoutes(inner, store, ORG_LOCAL_LAYER) : inner;
}
