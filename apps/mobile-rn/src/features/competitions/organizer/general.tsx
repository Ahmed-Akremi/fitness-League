import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Image, useWindowDimensions, View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useT } from '../../../core/prefs';
import { useApi } from '../../../core/services';
import { radius, space, useTheme } from '../../../core/theme';
import { pickImage } from '../../../core/utils/pick-image';
import { SectionHeader } from '../../../core/widgets/common';
import { ErrorText } from '../../../core/widgets/error';
import { Button, Chip, Dialog, Screen, TextField, Txt, toast } from '../../../core/widgets/kit';
import { DateField } from '../../../core/widgets/pickers';
import { DEFAULT_COVER, statusLabelForCompetition } from '../screens';
import { organizerApi, useRefreshCompetition } from './api';
import { COVER_MAX_BYTES, datesValid, fromMillimes, ORGANIZER_NEXT, toMillimes, type EventFormat } from './logic';
import { OrgPageHeader } from './page';

export function GeneralTab({ c }: { c: Json }) {
  const t = useT();
  const api = useApi();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const refresh = useRefreshCompetition();
  const [title, setTitle] = useState<string>(c.title ?? '');
  const [description, setDescription] = useState<string>(c.description ?? '');
  const [format, setFormat] = useState<EventFormat>(c.format ?? 'ONSITE');
  const [city, setCity] = useState<string>(c.city ?? '');
  const [place, setPlace] = useState<string>(c.location ?? '');
  const [regStart, setRegStart] = useState(() => new Date(c.deadlines?.registrationStart ?? c.registrationEnd));
  const [regEnd, setRegEnd] = useState(() => new Date(c.registrationEnd));
  const [eventStart, setEventStart] = useState(() => new Date(c.eventStart));
  const [eventEnd, setEventEnd] = useState(() => new Date(c.eventEnd));
  const [price, setPrice] = useState(fromMillimes(c.registrationPrice));
  const [max, setMax] = useState(c.maxParticipants ? String(c.maxParticipants) : '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const sending = useRef(false);

  const onsite = format !== 'ONLINE';
  const priceMillimes = toMillimes(price);
  const maxN = max.trim() ? Number(max.trim()) : null;
  const dates = { registrationStart: regStart, registrationEnd: regEnd, eventStart, eventEnd };
  const placeOk = !onsite || (city.trim().length > 0 && place.trim().length > 0);
  const valid =
    title.trim().length >= 3 && title.trim().length <= 120 && description.trim().length >= 1 && placeOk && datesValid(dates) && priceMillimes != null && (maxN == null || (Number.isInteger(maxN) && maxN >= 1));
  const draft = c.status === 'DRAFT';
  const bannerWidth = Math.min(width, 720) - 32;
  const nextLabels: Record<string, string> = {
    REGISTRATION_OPEN: t('orgToRegistrationOpen'),
    REGISTRATION_CLOSED: t('orgToRegistrationClosed'),
    ACTIVE: t('orgToActive'),
    SUBMISSION_OPEN: t('orgToSubmissionOpen'),
    JUDGING: t('orgToJudging'),
    PROVISIONAL_LEADERBOARD: t('orgToProvisional'),
    FINISHED: t('orgToFinished'),
  };

  const askLabels: Record<string, string> = {
    REGISTRATION_OPEN: t('orgAskRegistrationOpen'),
    REGISTRATION_CLOSED: t('orgAskRegistrationClosed'),
    ACTIVE: t('orgAskActive'),
    SUBMISSION_OPEN: t('orgAskSubmissionOpen'),
    JUDGING: t('orgAskJudging'),
    PROVISIONAL_LEADERBOARD: t('orgAskProvisional'),
    FINISHED: t('orgAskFinished'),
  };

  async function run(key: string, fn: () => Promise<unknown>, done?: string) {
    if (sending.current) return;
    sending.current = true;
    setBusy(key);
    setError(null);
    try {
      await fn();
      if (done) toast(done);
    } catch (e) {
      setError(e);
    } finally {
      await refresh();
      sending.current = false;
      setBusy(null);
    }
  }

  const save = () =>
    run(
      'save',
      () =>
        organizerApi(api).update(c.id, {
          title: title.trim(),
          description: description.trim(),
          format,
          city: city.trim(),
          location: place.trim(),
          registrationStart: regStart.toISOString(),
          registrationEnd: regEnd.toISOString(),
          eventStart: eventStart.toISOString(),
          eventEnd: eventEnd.toISOString(),
          registrationPrice: priceMillimes!,
          maxParticipants: maxN,
        }),
      t('orgSaved'),
    );

  async function pickBanner() {
    const picked = await pickImage(COVER_MAX_BYTES);
    if (!picked) return;
    if ('tooLarge' in picked) {
      toast(t('orgBannerTooLarge'));
      return;
    }
    await run('cover', () => organizerApi(api).uploadCover(c.id, picked.file), t('orgToastBanner'));
  }

  async function remove() {
    setDeleting(false);
    setBusy('delete');
    try {
      await organizerApi(api).remove(c.id);
      // Said before leaving: the list it lands on does not show what happened.
      toast(t('orgToastEventDeleted'));
      router.replace('/competitions');
      await refresh();
    } catch (e) {
      setError(e);
      setBusy(null);
    }
  }

  const formats: { key: EventFormat; label: string }[] = [
    { key: 'ONSITE', label: t('orgFormatOnsite') },
    { key: 'ONLINE', label: t('orgFormatOnline') },
    { key: 'HYBRID', label: t('orgFormatHybrid') },
  ];
  return (
    <>
      <OrgPageHeader tab="general" />
      <Screen>
        <SectionHeader title={t('orgBanner')} />
        <Image source={c.coverUrl ? { uri: c.coverUrl } : DEFAULT_COVER} style={{ width: bannerWidth, height: (bannerWidth * 596) / 1440, borderRadius: radius.field }} />
        <Txt variant="small" color={colors.outline}>{t('orgBannerHint')}</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          <Button testID="org-banner-pick" kind="outlined" icon="image" label={t('orgBannerPick')} busy={busy === 'cover'} onPress={pickBanner} />
          {c.coverUrl ? <Button testID="org-banner-remove" kind="text" label={t('orgBannerRemove')} onPress={() => run('cover', () => organizerApi(api).removeCover(c.id), t('orgToastBannerRemoved'))} /> : null}
        </View>

        <SectionHeader title={t('orgTabGeneral')} />
        <TextField testID="org-title" label={t('orgName')} value={title} onChangeText={setTitle} maxLength={120} />
        <TextField testID="org-description" label={t('orgDescription')} value={description} onChangeText={setDescription} maxLength={5000} multiline />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {formats.map((f) => (
            <Chip key={f.key} testID={`org-format-${f.key}`} label={f.label} selected={format === f.key} onPress={() => setFormat(f.key)} />
          ))}
        </View>
        <TextField testID="org-city" label={t('city')} value={city} onChangeText={setCity} maxLength={100} />
        <TextField testID="org-place" label={t('orgPlace')} value={place} onChangeText={setPlace} maxLength={200} />
        {!placeOk && <Txt variant="small" color={colors.outline}>{t('orgPlaceRequired')}</Txt>}
        <DateField mode="datetime" label={t('orgRegistrationStart')} value={regStart} onChange={setRegStart} />
        <DateField mode="datetime" label={t('orgRegistrationEnd')} value={regEnd} onChange={setRegEnd} />
        <DateField mode="datetime" label={t('orgEventStart')} value={eventStart} onChange={setEventStart} />
        <DateField mode="datetime" label={t('orgEventEnd')} value={eventEnd} onChange={setEventEnd} />
        {!datesValid(dates) && <Txt variant="small" color={colors.error}>{t('orgDatesInvalid')}</Txt>}
        <TextField testID="org-price" label={t('orgPrice')} value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
        <TextField testID="org-max" label={t('orgMaxParticipants')} value={max} onChangeText={setMax} keyboardType="number-pad" />
        <ErrorText error={error} />
        <Button testID="org-save" label={t('save')} busy={busy === 'save'} disabled={!valid} onPress={save} />

        <SectionHeader title={t('orgEvent')} />
        {draft ? (
          <Button testID="org-delete" kind="outlined" icon="delete" label={t('orgDelete')} busy={busy === 'delete'} onPress={() => setDeleting(true)} />
        ) : (
          <>
            <Txt variant="small" color={colors.outline}>{t('orgNextStep')}</Txt>
            {(ORGANIZER_NEXT[c.status] ?? []).map((s) => (
              <Button key={s} testID={`org-next-${s}`} kind="outlined" label={nextLabels[s]} busy={busy === s} onPress={() => setConfirming(s)} />
            ))}
          </>
        )}
        <Dialog
          visible={confirming != null}
          title={confirming ? nextLabels[confirming] : ''}
          message={confirming ? askLabels[confirming] : undefined}
          confirmLabel={t('orgConfirm')}
          cancelLabel={t('cancel')}
          onConfirm={() => {
            const s = confirming!;
            setConfirming(null);
            void run(s, () => organizerApi(api).setStatus(c.id, s), t('orgToastStatus', { status: statusLabelForCompetition(t, s) }));
          }}
          onCancel={() => setConfirming(null)}
        />
        <Dialog
          visible={deleting}
          title={t('orgDelete')}
          message={t('orgDeleteConfirm', { title: c.title })}
          confirmLabel={t('delete')}
          cancelLabel={t('cancel')}
          destructive
          onConfirm={remove}
          onCancel={() => setDeleting(false)}
        />
      </Screen>
    </>
  );
}
