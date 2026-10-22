import { getRandomBytes } from 'expo-crypto';

import type { Json } from '../../../core/api/client';
import { youtubeId } from '../api';
import { catBody, catDraft, EMAIL_RE as EMAIL, eventStyleOf, fromMillimes, toMillimes, wodBody, wodDraft, type EventStyle } from './logic';

/**
 * Organisation update, phase 2 (design 2026-10-22): the event's setup, contact and links, and settings. These fields
 * are kept on the device for now (`core/api/org-local.ts`); docs/organisation-backend-contract.md lists them.
 */

// ───────────── Setup: type, visibility, participants, label ─────────────

/** PUBLIC: listed, anyone registers. PASSWORD: listed, registering needs a 6-digit code. LINK: not listed, the link is enough. */
export type Visibility = 'PUBLIC' | 'PASSWORD' | 'LINK';
export type ParticipantType = 'INDIVIDUAL' | 'TEAM';
export type EventLabel = 'NONE' | 'QUALIFIER' | 'FINAL' | 'CHARITY' | 'BATTLE' | 'CHALLENGE' | 'WORKSHOP';
/** HYROX_STYLE: 8 fixed stations, each after a 1 km run (phase 7). CUSTOM: the organizer's own stages. */
export type HybridTemplate = 'HYROX_STYLE' | 'CUSTOM';

export const VISIBILITIES: Visibility[] = ['PUBLIC', 'PASSWORD', 'LINK'];
export const PARTICIPANT_TYPES: ParticipantType[] = ['INDIVIDUAL', 'TEAM'];
export const LABELS: EventLabel[] = ['NONE', 'QUALIFIER', 'FINAL', 'CHARITY', 'BATTLE', 'CHALLENGE', 'WORKSHOP'];
export const HYBRID_TEMPLATES: HybridTemplate[] = ['HYROX_STYLE', 'CUSTOM'];

export type EventSetup = {
  eventStyle: EventStyle;
  hybridTemplate: HybridTemplate | null;
  visibility: Visibility;
  accessCode: string | null;
  participantTypes: ParticipantType[];
  label: EventLabel;
  inviteOnly: boolean;
};

const oneOf = <T extends string>(value: unknown, all: readonly T[], fallback: T): T => (all.includes(value as T) ? (value as T) : fallback);

/** Events made before the setup existed get the defaults: functional fitness, public, individuals, no label. */
export function setupOf(c: Json): EventSetup {
  const types = Array.isArray(c.participantTypes) ? PARTICIPANT_TYPES.filter((p) => c.participantTypes.includes(p)) : [];
  return {
    eventStyle: eventStyleOf(c),
    hybridTemplate: HYBRID_TEMPLATES.includes(c.hybridTemplate) ? c.hybridTemplate : null,
    visibility: oneOf(c.visibility, VISIBILITIES, 'PUBLIC'),
    accessCode: typeof c.accessCode === 'string' ? c.accessCode : null,
    participantTypes: types.length ? types : ['INDIVIDUAL'],
    label: oneOf(c.label, LABELS, 'NONE'),
    inviteOnly: c.inviteOnly === true,
  };
}

export function setupValid(s: EventSetup): boolean {
  if (!s.participantTypes.length) return false;
  if (s.eventStyle === 'HYBRID_RACE' && !s.hybridTemplate) return false;
  return s.visibility !== 'PASSWORD' || /^\d{6}$/.test(s.accessCode ?? '');
}

/** What is saved: the template only for a hybrid race, the code only for a password-protected event. */
export function setupBody(s: EventSetup): Json {
  return {
    eventStyle: s.eventStyle,
    hybridTemplate: s.eventStyle === 'HYBRID_RACE' ? s.hybridTemplate : null,
    visibility: s.visibility,
    accessCode: s.visibility === 'PASSWORD' ? s.accessCode : null,
    participantTypes: s.participantTypes,
    label: s.label,
    inviteOnly: s.inviteOnly,
  };
}

/** Six digits from four random bytes (the modulo bias of 2³² over 10⁶ is negligible). */
export function accessCodeFrom(bytes: Uint8Array): string {
  const n = ((bytes[0] << 24) >>> 0) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3];
  return String(n % 1_000_000).padStart(6, '0');
}

/** A new registration code from the system's secure random source (never `Math.random`). */
export const newAccessCode = () => accessCodeFrom(getRandomBytes(4));

/** Ruling 1: the type cannot change once the event has a WOD (the other mode's data would be orphaned). */
export const styleLocked = (c: Json) => (c.workouts ?? []).length > 0;

// ───────────── Contact and links ─────────────

export type DetailsExtra = { organizerName: string; contactEmail: string; website: string; instagram: string; facebook: string; videoUrl: string; rulebookUrl: string };
export type DetailsError = 'EMAIL' | 'URL' | 'VIDEO';

const DETAIL_KEYS: (keyof DetailsExtra)[] = ['organizerName', 'contactEmail', 'website', 'instagram', 'facebook', 'videoUrl', 'rulebookUrl'];
const WEB_LINK = /^https?:\/\/[^\s/]+\.[^\s]+$/i;
const VIMEO = /^(?:https?:\/\/)?(?:www\.|player\.)?vimeo\.com\/(?:video\/)?\d+/i;

export function detailsOf(c: Json): DetailsExtra {
  return Object.fromEntries(DETAIL_KEYS.map((k) => [k, typeof c[k] === 'string' ? c[k] : ''])) as DetailsExtra;
}

/** Empty fields are fine; the publication checklist asks for the contact email separately. */
export function detailsErrors(d: DetailsExtra): Partial<Record<keyof DetailsExtra, DetailsError>> {
  const errors: Partial<Record<keyof DetailsExtra, DetailsError>> = {};
  const email = d.contactEmail.trim();
  if (email && !EMAIL.test(email)) errors.contactEmail = 'EMAIL';
  for (const k of ['website', 'rulebookUrl'] as const) if (d[k].trim() && !WEB_LINK.test(d[k].trim())) errors[k] = 'URL';
  const video = d.videoUrl.trim();
  if (video && !youtubeId(video) && !VIMEO.test(video)) errors.videoUrl = 'VIDEO';
  return errors;
}

const handle = (s: string) => s.trim().replace(/^@+/, '');

export function detailsBody(d: DetailsExtra): Json {
  return {
    organizerName: d.organizerName.trim(),
    contactEmail: d.contactEmail.trim(),
    website: d.website.trim(),
    instagram: handle(d.instagram),
    facebook: handle(d.facebook),
    videoUrl: d.videoUrl.trim(),
    rulebookUrl: d.rulebookUrl.trim(),
  };
}

// ───────────── Settings ─────────────

export type SettingsDraft = {
  countVisibility: 'SHOW' | 'HIDE';
  maxIndividuals: string;
  maxTeams: string;
  hideAthletesTab: boolean;
  coachAssignment: boolean;
  restrictToEmailList: boolean;
  emails: string;
  confirmationMessage: string;
  notifyOnRegistration: boolean;
  appealsEnabled: boolean;
  appealPrice: string;
  appealMax: string;
  appealDeadline: Date | null;
  neutral: string;
};
export type SettingsProblem = 'MAX_INDIVIDUALS' | 'MAX_TEAMS' | 'EMAILS' | 'APPEAL_PRICE' | 'APPEAL_MAX' | 'NEUTRAL';

/** One email per line or separated by commas; lower-cased, without duplicates; what is not an email is kept apart. */
export function parseEmails(text: string): { emails: string[]; invalid: string[] } {
  const emails = new Set<string>();
  const invalid: string[] = [];
  for (const raw of text.split(/[\n,;]+/)) {
    const v = raw.trim();
    if (!v) continue;
    if (EMAIL.test(v)) emails.add(v.toLowerCase());
    else invalid.push(v);
  }
  return { emails: [...emails], invalid };
}

const countryCodes = (s: string) => s.split(/[\s,;]+/).filter(Boolean);
const whole = (n: unknown) => (n == null ? '' : String(n));
const positiveOrEmpty = (s: string) => !s.trim() || (Number.isInteger(Number(s.trim())) && Number(s.trim()) >= 1);
const intOrNull = (s: string) => (s.trim() ? Number(s.trim()) : null);

export function settingsDraft(c: Json): SettingsDraft {
  const s: Json = c.settings ?? {};
  return {
    countVisibility: s.countVisibility === 'HIDE' ? 'HIDE' : 'SHOW',
    maxIndividuals: whole(s.maxIndividuals),
    maxTeams: whole(s.maxTeams),
    hideAthletesTab: s.hideAthletesTab === true,
    coachAssignment: s.coachAssignment === true,
    restrictToEmailList: s.restrictToEmailList === true,
    emails: (s.invitedEmails ?? []).join('\n'),
    confirmationMessage: s.confirmationMessage ?? '',
    notifyOnRegistration: s.notifyOnRegistration === true,
    appealsEnabled: s.appeals?.enabled === true,
    appealPrice: s.appeals?.price ? fromMillimes(s.appeals.price) : '',
    appealMax: whole(s.appeals?.maxPerAthlete),
    appealDeadline: s.appeals?.deadline ? new Date(s.appeals.deadline) : null,
    neutral: (s.neutralCountries ?? []).join(', '),
  };
}

export function settingsProblems(d: SettingsDraft): SettingsProblem[] {
  const problems: SettingsProblem[] = [];
  if (!positiveOrEmpty(d.maxIndividuals)) problems.push('MAX_INDIVIDUALS');
  if (!positiveOrEmpty(d.maxTeams)) problems.push('MAX_TEAMS');
  if (d.restrictToEmailList) {
    const { emails, invalid } = parseEmails(d.emails);
    if (invalid.length || !emails.length) problems.push('EMAILS');
  }
  if (d.appealsEnabled && d.appealPrice.trim() && toMillimes(d.appealPrice) == null) problems.push('APPEAL_PRICE');
  if (d.appealsEnabled && !positiveOrEmpty(d.appealMax)) problems.push('APPEAL_MAX');
  if (countryCodes(d.neutral).some((code) => !/^[A-Za-z]{2}$/.test(code))) problems.push('NEUTRAL');
  return problems;
}

/** Stored as the competition's `settings` (an empty appeal price means free). */
export function settingsBody(d: SettingsDraft): Json {
  return {
    countVisibility: d.countVisibility,
    maxIndividuals: intOrNull(d.maxIndividuals),
    maxTeams: intOrNull(d.maxTeams),
    hideAthletesTab: d.hideAthletesTab,
    coachAssignment: d.coachAssignment,
    restrictToEmailList: d.restrictToEmailList,
    invitedEmails: parseEmails(d.emails).emails,
    confirmationMessage: d.confirmationMessage.trim(),
    notifyOnRegistration: d.notifyOnRegistration,
    appeals: {
      enabled: d.appealsEnabled,
      price: d.appealPrice.trim() ? toMillimes(d.appealPrice) : 0,
      maxPerAthlete: intOrNull(d.appealMax),
      deadline: d.appealDeadline ? d.appealDeadline.toISOString() : null,
    },
    neutralCountries: countryCodes(d.neutral).map((code) => code.toUpperCase()),
  };
}

// ───────────── Copy from a previous event ─────────────

const DAY = 86_400_000;

/** Each category of the source as a new one, with the id it had (to point the WOD versions at the copies). */
export function copyCategoryBodies(source: Json): { sourceId: string; body: Json }[] {
  return (source.categories ?? []).map((k: Json) => ({ sourceId: k.id, body: catBody(catDraft(k)) }));
}

/** Each WOD of the source, its dates moved by as much as the event start moves; versions of categories that were not copied are dropped. */
export function copyWodBodies(source: Json, newEventStart: Date, categoryIds: Record<string, string>): Json[] {
  const delta = newEventStart.getTime() - new Date(source.eventStart).getTime();
  const moved = (iso: unknown) => (typeof iso === 'string' ? new Date(new Date(iso).getTime() + delta) : null);
  return (source.workouts ?? []).map((w: Json) => {
    const start = moved(w.submissionStart) ?? newEventStart;
    const end = moved(w.submissionDeadline) ?? new Date(newEventStart.getTime() + DAY);
    const variants = (w.variants ?? []).filter((v: Json) => categoryIds[v.categoryId]).map((v: Json) => ({ ...v, categoryId: categoryIds[v.categoryId] }));
    const release = moved(w.releaseAt);
    return wodBody(wodDraft({ ...w, submissionStart: start.toISOString(), submissionDeadline: end.toISOString(), releaseAt: release ? release.toISOString() : null, variants }, { number: w.number, start, end }));
  });
}
