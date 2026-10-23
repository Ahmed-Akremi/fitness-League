import type { Fetch, Json } from './client';
import { withLocalRoutes, type LocalLayer, type LocalRoute } from './local-routes';
import { asyncStoragePersistence, LocalStore } from './local-store';

type Check = (body: Json) => string | null;
const required = (field: string): Check => (body) => (String(body?.[field] ?? '').trim() ? null : field);

/**
 * A list kept per competition (phase 5): `GET` the list, `POST` an item (an `id` in the body replaces the item with that
 * id, so a check-in happens once), `PUT /:itemId` merges fields, `DELETE /:itemId`. `check` names a missing field (422).
 */
function listRoutes(collection: string, path: string, check?: Check): LocalRoute[] {
  const base = `/competitions/:id/${path}`;
  const invalid = (field: string) => ({ status: 422, body: { code: 'VALIDATION_FAILED', status: 422, errors: [{ field, code: 'REQUIRED' }] } });
  return [
    { method: 'GET', path: base, handle: ({ params }, store) => ({ status: 200, body: store.competition(params.id).collections[collection] ?? [] }) },
    {
      method: 'POST',
      path: base,
      handle: async ({ params, body }, store) => {
        const field = check?.(body);
        if (field) return invalid(field);
        const item: Json = { ...body, id: typeof body?.id === 'string' ? body.id : store.newId(), createdAt: new Date().toISOString() };
        await store.update(params.id, (c) => {
          c.collections[collection] = [...(c.collections[collection] ?? []).filter((x) => x.id !== item.id), item];
        });
        return { status: 201, body: item };
      },
    },
    {
      method: 'PUT',
      path: `${base}/:itemId`,
      handle: async ({ params, body }, store) => {
        const current = (store.competition(params.id).collections[collection] ?? []).find((x) => x.id === params.itemId);
        if (!current) return { status: 404, body: { code: 'NOT_FOUND', status: 404 } };
        const next = { ...current, ...body, id: params.itemId };
        const field = check?.(next);
        if (field) return invalid(field);
        await store.update(params.id, (c) => {
          c.collections[collection] = (c.collections[collection] ?? []).map((x) => (x.id === params.itemId ? next : x));
        });
        return { status: 200, body: next };
      },
    },
    {
      method: 'DELETE',
      path: `${base}/:itemId`,
      handle: async ({ params }, store) => {
        await store.update(params.id, (c) => {
          c.collections[collection] = (c.collections[collection] ?? []).filter((x) => x.id !== params.itemId);
        });
        return { status: 204 };
      },
    },
  ];
}

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
    // Phase 7: the race of a hybrid event (`features/competitions/organizer/logic-hybrid.ts`)
    'flow',
    // Phase 10: ranking choices (`features/competitions/organizer/logic-results.ts`)
    'resultsSettings',
  ],
  // Phase 3: divisions (`features/competitions/organizer/logic-division.ts`)
  categoryFields: ['type', 'teamMale', 'teamFemale', 'parentId', 'locked', 'unlockCode', 'earlyPrice', 'earlyUntil', 'teamNameChangeUntil', 'memberChangeUntil', 'memberChangePrice', 'oneMemberStays'],
  // Phase 4: extras of a registration (athlete side)
  registrationFields: ['answers', 'agreementsAccepted', 'teamName', 'teamMembers', 'giftFor', 'paymentPlan', 'guardian', 'faceRecognition'],
  // Phase 6: a WOD's scorecard, penalties and tie-break
  workoutFields: ['scorecard', 'penalties', 'tieBreak'],
  routes: [
    // Phase 7: waves of a hybrid race ({ number, name, categoryId, startsAt, registrationIds, liveStart })
    ...listRoutes('waves', 'waves', required('startsAt')),
    // Phase 8: judging and live control
    ...listRoutes('raceResults', 'race-results', required('registrationId')),
    ...listRoutes('lanePenalties', 'lane-penalties', required('heatId')),
    ...listRoutes('timers', 'timers', required('config')),
    // Phase 9: the call shown on the call screen ({ id: 'current', kind: WARM_UP | CORRAL | null, label, seq, at })
    ...listRoutes('calls', 'calls'),
    // Phase 10: results imported from a spreadsheet, and the standings kept by « Freeze »
    ...listRoutes('importedResults', 'imported-results', required('registrationId')),
    ...listRoutes('boardFreezes', 'board-freezes', required('rows')),
    // Phase 11: messages (the outbox), spectator tickets and the shop
    ...listRoutes('messages', 'messages', (b) => required('subject')(b) ?? required('sendAt')(b)),
    ...listRoutes('ticketTypes', 'ticket-types', required('name')),
    ...listRoutes('ticketOrders', 'ticket-orders', required('itemId')),
    ...listRoutes('shopProducts', 'shop-products', required('name')),
    ...listRoutes('shopOrders', 'shop-orders', required('itemId')),
    // Phase 6: locations (stages, floors) and the location of each heat ({ id: heatId, locationId })
    ...listRoutes('locations', 'locations', required('name')),
    ...listRoutes('heatLocations', 'heat-locations', required('locationId')),
    // Phase 5: participants and staff
    ...listRoutes('sponsors', 'sponsors', required('name')),
    ...listRoutes('checkins', 'checkins'),
    ...listRoutes('finalists', 'finalist-invitations', required('userId')),
    ...listRoutes('staffForms', 'staff-forms', required('title')),
    ...listRoutes('staffApplications', 'staff-applications', (b) => required('name')(b) ?? required('email')(b) ?? required('role')(b)),
    // Phase 4: waiting list of a full division
    { method: 'GET', path: '/competitions/:id/waiting-list', handle: ({ params }, store) => ({ status: 200, body: store.competition(params.id).collections.waitingList ?? [] }) },
    {
      method: 'POST',
      path: '/competitions/:id/waiting-list',
      handle: async ({ params, body }, store) => {
        const email = String(body?.email ?? '').trim().toLowerCase();
        if (!body?.categoryId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return { status: 422, body: { code: 'VALIDATION_FAILED', status: 422, errors: [{ field: body?.categoryId ? 'email' : 'categoryId', code: 'REQUIRED' }] } };
        }
        const entry: Json = { id: store.newId(), categoryId: body.categoryId, name: String(body.name ?? '').trim(), email, createdAt: new Date().toISOString() };
        await store.update(params.id, (c) => {
          c.collections.waitingList = [...(c.collections.waitingList ?? []), entry];
        });
        return { status: 201, body: entry };
      },
    },
    {
      method: 'DELETE',
      path: '/competitions/:id/waiting-list/:entryId',
      handle: async ({ params }, store) => {
        await store.update(params.id, (c) => {
          c.collections.waitingList = (c.collections.waitingList ?? []).filter((e) => e.id !== params.entryId);
        });
        return { status: 204 };
      },
    },
  ],
};

/** `EXPO_PUBLIC_ORG_LOCAL=false` turns the layer off (a build where the server has every route). */
export const orgLocalEnabled = (value: string | undefined) => value !== 'false';

export function withOrgLocal(inner: Fetch, enabled: boolean, store: LocalStore = new LocalStore(asyncStoragePersistence())): Fetch {
  return enabled ? withLocalRoutes(inner, store, ORG_LOCAL_LAYER) : inner;
}
