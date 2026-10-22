import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useT } from '../../../core/prefs';
import { useApi } from '../../../core/services';
import { space, useTheme } from '../../../core/theme';
import { SectionHeader } from '../../../core/widgets/common';
import { ErrorText } from '../../../core/widgets/error';
import { Button, Chip, Screen, SwitchRow, TextField, Txt, toast } from '../../../core/widgets/kit';
import { DateField } from '../../../core/widgets/pickers';
import { competitionsApi, useCompetitions } from '../api';
import { createWithFreeSlug, organizerApi, type CompetitionInput } from './api';
import { EventSetupFields } from './event-setup';
import { datesValid, fromMillimes, slugFor, toMillimes, type EventFormat } from './logic';
import { copyCategoryBodies, copyWodBodies, setupBody, setupOf, setupValid } from './logic-event';

const DAY = 86_400_000;

/** Organizer space: any user drafts an event; an admin publishes it once the organizer asks. */
export function CreateEventScreen() {
  const t = useT();
  const api = useApi();
  const qc = useQueryClient();
  const { colors } = useTheme();
  const [start] = useState(() => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    return d.getTime() + 3_600_000;
  });
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [format, setFormat] = useState<EventFormat>('ONSITE');
  const [countryCode, setCountryCode] = useState('TN');
  const [city, setCity] = useState('');
  const [place, setPlace] = useState('');
  const [regStart, setRegStart] = useState(new Date(start));
  const [regEnd, setRegEnd] = useState(new Date(start + 14 * DAY));
  const [eventStart, setEventStart] = useState(new Date(start + 21 * DAY));
  const [eventEnd, setEventEnd] = useState(new Date(start + 22 * DAY));
  const [price, setPrice] = useState('0');
  const [max, setMax] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const sending = useRef(false);
  const [setup, setSetup] = useState(() => setupOf({}));
  // Copy a previous event (phase 2): its details fill the form; its categories and WODs are added after the draft exists.
  const mine = useCompetitions('ALL', true);
  const [source, setSource] = useState<Json | null>(null);
  const [copyCategories, setCopyCategories] = useState(true);
  const [copyWods, setCopyWods] = useState(true);

  async function pickSource(id: string | null) {
    if (!id) return setSource(null);
    try {
      const s = await competitionsApi(api).get(id);
      setSource(s);
      setDescription(s.description ?? '');
      setFormat(s.format ?? 'ONSITE');
      if (s.countryCode) setCountryCode(s.countryCode);
      setCity(s.city ?? '');
      setPlace(s.location ?? '');
      setPrice(fromMillimes(s.registrationPrice) || '0');
      setMax(s.maxParticipants ? String(s.maxParticipants) : '');
      setSetup(setupOf(s));
    } catch (e) {
      setError(e);
    }
  }

  const onsite = format !== 'ONLINE';
  const priceMillimes = toMillimes(price);
  const maxN = max.trim() ? Number(max.trim()) : null;
  const dates = { registrationStart: regStart, registrationEnd: regEnd, eventStart, eventEnd };
  const placeOk = !onsite || (city.trim().length > 0 && place.trim().length > 0);
  const valid =
    title.trim().length >= 3 &&
    title.trim().length <= 120 &&
    description.trim().length >= 1 &&
    /^[A-Z]{2}$/.test(countryCode) &&
    placeOk &&
    datesValid(dates) &&
    priceMillimes != null &&
    (maxN == null || (Number.isInteger(maxN) && maxN >= 1)) &&
    setupValid(setup);

  async function submit() {
    if (sending.current || !valid) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    const body: CompetitionInput = {
      title: title.trim(),
      slug: slugFor(title),
      description: description.trim(),
      format,
      countryCode,
      ...(city.trim() ? { city: city.trim() } : {}),
      ...(place.trim() ? { location: place.trim() } : {}),
      registrationStart: regStart.toISOString(),
      registrationEnd: regEnd.toISOString(),
      eventStart: eventStart.toISOString(),
      eventEnd: eventEnd.toISOString(),
      registrationPrice: priceMillimes!,
      currency: 'TND',
      ...(maxN != null ? { maxParticipants: maxN } : {}),
    };
    try {
      const org = organizerApi(api);
      const created = await createWithFreeSlug(org, { ...body, ...setupBody(setup) });
      if (source && !(await copyInto(org, created.id))) toast(t('orgCopyFailed'));
      await qc.invalidateQueries({ queryKey: ['competitions'] });
      router.replace(`/competitions/${created.id}/manage`);
    } catch (e) {
      setError(e);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  /** One request at a time, categories first (WOD versions point at the new categories). False when an item failed. */
  async function copyInto(org: ReturnType<typeof organizerApi>, id: string): Promise<boolean> {
    if (!source) return true;
    let ok = true;
    const ids: Record<string, string> = {};
    if (copyCategories) {
      for (const { sourceId, body: cat } of copyCategoryBodies(source)) {
        try {
          ids[sourceId] = (await org.addCategory(id, cat)).id;
        } catch {
          ok = false;
        }
      }
    }
    if (copyWods) {
      for (const wod of copyWodBodies(source, eventStart, ids)) {
        try {
          await org.addWod(id, wod);
        } catch {
          ok = false;
        }
      }
    }
    return ok;
  }

  const formats: { key: EventFormat; label: string }[] = [
    { key: 'ONSITE', label: t('orgFormatOnsite') },
    { key: 'ONLINE', label: t('orgFormatOnline') },
    { key: 'HYBRID', label: t('orgFormatHybrid') },
  ];
  return (
    <Screen>
      <Txt color={colors.outline}>{t('orgCreateIntro')}</Txt>
      {(mine.data ?? []).length > 0 && (
        <>
          <SectionHeader title={t('orgCopyFrom')} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            <Chip testID="org-copy-none" label={t('orgCopyNone')} selected={!source} onPress={() => pickSource(null)} />
            {(mine.data ?? []).map((c) => (
              <Chip key={c.id} testID={`org-copy-${c.id}`} label={c.title} selected={source?.id === c.id} onPress={() => pickSource(c.id)} />
            ))}
          </View>
          {source && (
            <>
              <SwitchRow testID="org-copy-categories" title={t('orgCopyCategories')} value={copyCategories} onChange={setCopyCategories} />
              <SwitchRow testID="org-copy-wods" title={t('orgCopyWods')} value={copyWods} onChange={setCopyWods} />
            </>
          )}
        </>
      )}
      <TextField testID="org-title" label={t('orgName')} value={title} onChangeText={setTitle} maxLength={120} />
      <TextField testID="org-description" label={t('orgDescription')} value={description} onChangeText={setDescription} maxLength={5000} multiline />
      <EventSetupFields value={setup} onChange={setSetup} />
      <SectionHeader title={t('orgFormat')} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {formats.map((f) => (
          <Chip key={f.key} testID={`org-format-${f.key}`} label={f.label} selected={format === f.key} onPress={() => setFormat(f.key)} />
        ))}
      </View>
      <TextField testID="org-country" label={t('orgCountry')} value={countryCode} onChangeText={(v) => setCountryCode(v.toUpperCase())} maxLength={2} autoCapitalize="characters" />
      <TextField testID="org-city" label={t('city')} value={city} onChangeText={setCity} maxLength={100} />
      <TextField testID="org-place" label={t('orgPlace')} value={place} onChangeText={setPlace} maxLength={200} />
      {!placeOk && <Txt variant="small" color={colors.outline}>{t('orgPlaceRequired')}</Txt>}
      <SectionHeader title={t('orgEvent')} />
      <DateField testID="org-reg-start" mode="datetime" label={t('orgRegistrationStart')} value={regStart} onChange={setRegStart} />
      <DateField testID="org-reg-end" mode="datetime" label={t('orgRegistrationEnd')} value={regEnd} onChange={setRegEnd} />
      <DateField testID="org-event-start" mode="datetime" label={t('orgEventStart')} value={eventStart} onChange={setEventStart} />
      <DateField testID="org-event-end" mode="datetime" label={t('orgEventEnd')} value={eventEnd} onChange={setEventEnd} />
      {!datesValid(dates) && <Txt variant="small" color={colors.error}>{t('orgDatesInvalid')}</Txt>}
      <TextField testID="org-price" label={t('orgPrice')} value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
      <TextField testID="org-max" label={t('orgMaxParticipants')} value={max} onChangeText={setMax} keyboardType="number-pad" />
      <ErrorText error={error} />
      <Button testID="org-create" label={t('orgCreateDraft')} busy={busy} disabled={!valid} onPress={submit} style={{ marginTop: space.sm }} />
    </Screen>
  );
}
