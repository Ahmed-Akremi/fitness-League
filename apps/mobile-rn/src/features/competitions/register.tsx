import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import type { Json } from '../../core/api/client';
import { ApiError } from '../../core/api/errors';
import { useLocale, useT } from '../../core/prefs';
import { useApi } from '../../core/services';
import { displayText, space, useTheme } from '../../core/theme';
import { EmptyState, Loading, SectionHeader } from '../../core/widgets/common';
import { ErrorText, ErrorView, errorMessage } from '../../core/widgets/error';
import { Button, Card, Checkbox, Chip, Icon, Screen, SwitchRow, TextField, Txt } from '../../core/widgets/kit';
import { useMe } from '../me/api';
import { competitionsApi, formatMoney, useCompetition } from './api';
import {
  codeMatches,
  inviteRefused,
  minorProblems,
  needsEventCode,
  queueStart,
  queueTick,
  registrationExtras,
  requiredAgreements,
  teamMemberSlots,
  teamProblems,
  type AgreementId,
  type Guardian,
  type PaymentPlan,
  type QueueState,
} from './logic-registration';
import { agreementsOf, answerProblems, formOf, SIZES, type FormField } from './organizer/logic-forms';
import { priceBreakdown, pricingOf } from './organizer/logic-pricing';

/** One step of the simulated queue of a busy event (`settings.highDemand`). */
export const QUEUE_TICK_MS = 800;

const seedFrom = (s: string) => [...s].reduce((n, ch) => n + ch.charCodeAt(0), 0);

/**
 * Registration (phase 4): queue of a busy event, invitation list, event and division codes, the division, the team or
 * the person registered as a gift, the organizer's questions and agreements, the guardian of a minor, the promo code,
 * and full or deposit payment. The server gets the category and the promo code; the rest is kept on the device for now.
 */
export function RegisterScreen({ id }: { id: string }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const api = useApi();
  const qc = useQueryClient();
  const comp = useCompetition(id);
  const me = useMe();
  const [queue, setQueue] = useState<QueueState | null>(null);
  const [eventCode, setEventCode] = useState('');
  const [eventOpen, setEventOpen] = useState(false);
  const [eventCodeWrong, setEventCodeWrong] = useState(false);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [divCode, setDivCode] = useState('');
  const [unlocked, setUnlocked] = useState<string | null>(null);
  const [divCodeWrong, setDivCodeWrong] = useState(false);
  const [teamName, setTeamName] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [gift, setGift] = useState(false);
  const [giftEmail, setGiftEmail] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [accepted, setAccepted] = useState<AgreementId[]>([]);
  const [face, setFace] = useState(false);
  const [minor, setMinor] = useState(false);
  const [guardian, setGuardian] = useState<Guardian>({ name: '', email: '', phone: '', consent: false, photoConsent: false });
  const [plan, setPlan] = useState<PaymentPlan>('FULL');
  const [code, setCode] = useState('');
  const [quote, setQuote] = useState<Json | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<Json | null>(null);
  const [full, setFull] = useState(false);
  const [waitlisted, setWaitlisted] = useState(false);

  const highDemand = comp.data?.settings?.highDemand === true;
  useEffect(() => {
    if (highDemand && !queue) setQueue(queueStart(seedFrom(id)));
  }, [highDemand, queue, id]);
  useEffect(() => {
    if (!queue || queue.phase === 'ADMITTED') return;
    const h = setTimeout(() => setQueue(queueTick(queue)), QUEUE_TICK_MS);
    return () => clearTimeout(h);
  }, [queue]);

  if (comp.isError) return <ErrorView error={comp.error} />;
  if (!comp.data) return <Loading />;
  const c = comp.data;
  const money = (p: number) => (p === 0 ? t('compFree') : formatMoney(p, c.currency, locale));

  if (highDemand && queue?.phase !== 'ADMITTED') {
    return (
      <Screen>
        <Card testID="reg-queue" style={{ gap: space.sm, alignItems: 'center' }}>
          <Icon name="hourglass-top" size={40} color={colors.primary} />
          <Txt variant="title">{t('regQueueTitle')}</Txt>
          <Txt color={colors.outline} style={{ textAlign: 'center' }}>{t('regQueueAhead', { count: queue?.position ?? 0 })}</Txt>
        </Card>
      </Screen>
    );
  }
  if ((c.inviteOnly || c.settings?.restrictToEmailList) && me.isLoading) return <Loading />;
  if (inviteRefused(c, me.data?.email)) return <EmptyState icon="lock" message={t('regInviteOnly')} />;
  if (needsEventCode(c) && !eventOpen) {
    const unlock = () => {
      const ok = codeMatches(eventCode, c.accessCode);
      setEventOpen(ok);
      setEventCodeWrong(!ok);
    };
    return (
      <Screen>
        <Txt color={colors.outline}>{t('regEventCodeHint')}</Txt>
        <TextField testID="reg-event-code" label={t('regEventCode')} value={eventCode} onChangeText={setEventCode} keyboardType="number-pad" maxLength={6} />
        {eventCodeWrong && <Txt color={colors.error}>{t('regWrongCode')}</Txt>}
        <Button testID="reg-event-unlock" label={t('regUnlock')} disabled={eventCode.trim().length !== 6} onPress={unlock} />
      </Screen>
    );
  }

  const category: Json | undefined = c.categories.find((x: Json) => x.id === categoryId);
  const locked = category?.locked === true && unlocked !== category.id;
  const team = category?.type === 'TEAM';
  const slots = category ? teamMemberSlots(category) : 0;
  const memberList = Array.from({ length: slots }, (_, i) => members[i] ?? '');
  const fields = formOf(c);
  const agreements = agreementsOf(c);
  const required = requiredAgreements(agreements);
  const now = Date.now();
  const early = category?.earlyPrice != null && category.earlyUntil && now < new Date(category.earlyUntil).getTime() ? (category.earlyPrice as number) : null;
  const price: number = quote?.finalPrice ?? early ?? category?.price ?? 0;
  // Fee and VAT only once the organizer has set up Pricing: otherwise the athlete sees the price the server charges.
  const breakdown = c.pricing ? priceBreakdown({ price }, pricingOf(c)) : null;
  const total = breakdown ? breakdown.athletePays : price;
  const depositOffered = breakdown != null && pricingOf(c).deposit.enabled && breakdown.athletePays > 0;
  const giftOk = !gift || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(giftEmail.trim());
  const valid =
    !!category &&
    !locked &&
    (!team || teamProblems(category, teamName, memberList).length === 0) &&
    giftOk &&
    answerProblems(fields, answers).length === 0 &&
    required.every((r) => accepted.includes(r)) &&
    (!minor || minorProblems(guardian).length === 0);

  async function applyCoupon() {
    setCouponError(null);
    try {
      setQuote(await competitionsApi(api).checkCoupon(id, categoryId!, code.trim().toUpperCase()));
    } catch (e) {
      setQuote(null);
      setCouponError(e instanceof ApiError && e.status === 422 ? t('compCouponRefused') : errorMessage(t, e));
    }
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const extras = registrationExtras({
        answers,
        accepted,
        teamName: team ? teamName : '',
        teamMembers: team ? memberList : [],
        giftFor: gift ? giftEmail : '',
        plan: depositOffered ? plan : 'FULL',
        guardian: minor ? guardian : null,
      });
      const r = await competitionsApi(api).register(id, categoryId!, quote ? code.trim().toUpperCase() : undefined, face ? { ...extras, faceRecognition: true } : extras);
      await qc.invalidateQueries({ queryKey: ['competitions'] });
      setDone(r);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 409 || /FULL/.test(e.code ?? ''))) setFull(true);
      else if (e instanceof ApiError && e.fieldCode('categoryId')) setError(t('compNotEligible'));
      else if (e instanceof ApiError && e.fieldCode('couponCode')) setError(t('compCouponRefused'));
      else if (e instanceof ApiError && e.code === 'PRECONDITION_FAILED') setError(t('compRegistrationClosed'));
      else setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function joinWaitlist() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/competitions/${id}/waiting-list`, { categoryId, name: me.data?.username ?? '', email: me.data?.email ?? '' });
      setWaitlisted(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (waitlisted) return <EmptyState icon="hourglass-top" message={t('regWaitlistDone')} />;
  if (done) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32, backgroundColor: colors.background }}>
        <Icon name={done.registrationStatus === 'CONFIRMED' ? 'check-circle' : 'hourglass-top'} size={64} color={colors.primary} />
        <Txt variant="title" style={{ textAlign: 'center' }}>{done.registrationStatus === 'CONFIRMED' ? t('compRegistered') : t('compPaymentPending')}</Txt>
        {breakdown && depositOffered && plan === 'DEPOSIT' && <Txt style={{ textAlign: 'center' }}>{t('regDepositDone', { deposit: money(breakdown.depositNow), balance: money(breakdown.balance) })}</Txt>}
        <Button label={t('compMyCompetition')} onPress={() => router.replace(`/competitions/${id}`)} />
      </View>
    );
  }

  const answerField = (f: FormField) => {
    const choices = f.type === 'SIZE' ? SIZES : f.type === 'SELECT' ? f.options : null;
    const value = answers[f.id] ?? '';
    const set = (v: string) => setAnswers({ ...answers, [f.id]: v });
    if (choices) {
      return (
        <View key={f.id} style={{ gap: space.xs }}>
          <Txt>{f.required ? `${f.label} *` : f.label}</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {choices.map((o) => (
              <Chip key={o} testID={`reg-answer-${f.id}-${o}`} label={o} selected={value === o} onPress={() => set(o)} />
            ))}
          </View>
        </View>
      );
    }
    const keyboard = f.type === 'NUMBER' ? 'decimal-pad' : f.type === 'PHONE' ? 'phone-pad' : 'default';
    return <TextField key={f.id} testID={`reg-answer-${f.id}`} label={f.required ? `${f.label} *` : f.label} value={value} onChangeText={set} keyboardType={keyboard} placeholder={f.type === 'DATE' ? 'YYYY-MM-DD' : undefined} />;
  };
  const agreementText: Record<AgreementId, { label: string; text: string }> = {
    LIABILITY: { label: t('regAgreeLiability'), text: agreements.liability.text },
    CUSTOM: { label: t('regAgreeCustom', { title: agreements.custom.title }), text: agreements.custom.text },
    MEDICAL: { label: t('regAgreeMedical'), text: agreements.medicalReport.description },
    DOCUMENT: { label: t('regAgreeDocument', { title: agreements.additionalDocument.title }), text: agreements.additionalDocument.description },
  };
  const toggleAgreement = (a: AgreementId, on: boolean) => setAccepted(on ? [...accepted.filter((x) => x !== a), a] : accepted.filter((x) => x !== a));

  return (
    <Screen>
      <SectionHeader title={t('compChooseCategory')} />
      {c.categories
        .filter((x: Json) => x.active)
        .map((x: Json) => (
          <Pressable
            key={x.id}
            testID={`cat-${x.id}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: x.id === categoryId }}
            onPress={() => {
              setCategoryId(x.id);
              setQuote(null);
              setDivCodeWrong(false);
            }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}
          >
            <Icon name={x.id === categoryId ? 'radio-button-checked' : 'radio-button-unchecked'} color={x.id === categoryId ? colors.primary : colors.outline} />
            <Txt style={{ flex: 1 }}>{x.name}</Txt>
            {x.locked ? <Icon name="lock" size={16} color={colors.outline} /> : null}
            <Txt style={{ fontWeight: '700' }}>{money(x.price)}</Txt>
          </Pressable>
        ))}

      {category && locked && (
        <>
          <Txt color={colors.outline}>{t('regDivLocked')}</Txt>
          <TextField testID="reg-div-code" label={t('regEventCode')} value={divCode} onChangeText={setDivCode} keyboardType="number-pad" maxLength={6} />
          {divCodeWrong && <Txt color={colors.error}>{t('regWrongCode')}</Txt>}
          <Button
            testID="reg-div-unlock"
            label={t('regUnlock')}
            disabled={divCode.trim().length !== 6}
            onPress={() => {
              const ok = codeMatches(divCode, category.unlockCode ?? '');
              if (ok) setUnlocked(category.id);
              setDivCodeWrong(!ok);
            }}
          />
        </>
      )}

      {category && !locked && (
        <>
          {team && (
            <>
              <SectionHeader title={t('regTeam')} />
              <TextField testID="reg-team-name" label={t('regTeamName')} value={teamName} onChangeText={setTeamName} maxLength={60} />
              {teamName.length > 0 && teamProblems(category, teamName, memberList).includes('TEAM_NAME') && <Txt variant="small" color={colors.error}>{t('regTeamNameInvalid')}</Txt>}
              {memberList.map((m, i) => (
                <TextField
                  key={i}
                  testID={`reg-member-${i}`}
                  label={t('regMember', { number: i + 1 })}
                  value={m}
                  onChangeText={(v) => setMembers(memberList.map((x, j) => (j === i ? v : x)))}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              ))}
              {memberList.every((m) => m.trim()) && teamProblems(category, teamName, memberList).includes('MEMBERS') && <Txt variant="small" color={colors.error}>{t('regMembersInvalid')}</Txt>}
            </>
          )}
          {!team && <SwitchRow testID="reg-gift" title={t('regGift')} value={gift} onChange={setGift} />}
          {!team && gift && <TextField testID="reg-gift-email" label={t('regGiftEmail')} value={giftEmail} onChangeText={setGiftEmail} keyboardType="email-address" autoCapitalize="none" />}

          {fields.length > 0 && (
            <>
              <SectionHeader title={t('regQuestions')} />
              {fields.map(answerField)}
            </>
          )}

          {(required.length > 0 || agreements.faceRecognition.required || agreements.minors.enabled) && <SectionHeader title={t('regAgreements')} />}
          {required.map((a) => (
            <View key={a} style={{ gap: space.xs }}>
              {agreementText[a].text ? <Txt variant="small" color={colors.outline}>{agreementText[a].text}</Txt> : null}
              <Checkbox testID={`reg-agree-${a}`} label={agreementText[a].label} value={accepted.includes(a)} onChange={(on) => toggleAgreement(a, on)} />
            </View>
          ))}
          {agreements.faceRecognition.required && <SwitchRow testID="reg-face" title={t('regFace')} value={face} onChange={setFace} />}
          {agreements.minors.enabled && (
            <>
              <Checkbox testID="reg-minor" label={t('regMinor', { age: agreements.minors.age })} value={minor} onChange={setMinor} />
              {minor && (
                <>
                  <TextField testID="reg-guardian-name" label={t('regGuardianName')} value={guardian.name} onChangeText={(name) => setGuardian({ ...guardian, name })} />
                  <TextField testID="reg-guardian-email" label={t('regGuardianEmail')} value={guardian.email} onChangeText={(email) => setGuardian({ ...guardian, email })} keyboardType="email-address" autoCapitalize="none" />
                  <TextField testID="reg-guardian-phone" label={t('regGuardianPhone')} value={guardian.phone} onChangeText={(phone) => setGuardian({ ...guardian, phone })} keyboardType="phone-pad" />
                  <Checkbox testID="reg-guardian-consent" label={t('regGuardianConsent')} value={guardian.consent} onChange={(consent) => setGuardian({ ...guardian, consent })} />
                  {agreements.minors.photoConsent && <Checkbox testID="reg-guardian-photo" label={t('regGuardianPhoto')} value={guardian.photoConsent === true} onChange={(photoConsent) => setGuardian({ ...guardian, photoConsent })} />}
                </>
              )}
            </>
          )}

          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
            <TextField testID="coupon" style={{ flex: 1 }} label={t('compCoupon')} value={code} onChangeText={setCode} autoCapitalize="characters" error={couponError} />
            <Button testID="coupon-apply" kind="tonal" label={t('compApplyCoupon')} disabled={code.trim().length < 3} onPress={applyCoupon} />
          </View>
          <Card style={{ gap: 4 }}>
            <View style={{ flexDirection: 'row' }}>
              <Txt style={{ flex: 1 }}>{t('compPrice')}</Txt>
              <Txt>{money(quote?.originalPrice ?? early ?? category.price)}</Txt>
            </View>
            {quote && (
              <View style={{ flexDirection: 'row' }}>
                <Txt style={{ flex: 1 }}>{t('compDiscount')}</Txt>
                <Txt color={colors.primary}>{`− ${money(quote.discount)}`}</Txt>
              </View>
            )}
            {breakdown && breakdown.tax > 0 && (
              <View style={{ flexDirection: 'row' }}>
                <Txt style={{ flex: 1 }}>{t('orgPriceTaxLine')}</Txt>
                <Txt>{money(breakdown.tax)}</Txt>
              </View>
            )}
            {breakdown && breakdown.athletePays > breakdown.subtotal && (
              <View style={{ flexDirection: 'row' }}>
                <Txt style={{ flex: 1 }}>{t('orgPriceFeeLine')}</Txt>
                <Txt>{money(breakdown.athletePays - breakdown.subtotal)}</Txt>
              </View>
            )}
            <View style={{ flexDirection: 'row', marginTop: 4 }}>
              <Txt variant="title" style={{ flex: 1 }}>{t('compTotal')}</Txt>
              <Txt testID="final-price" style={displayText(24)}>{money(total)}</Txt>
            </View>
          </Card>
          {depositOffered && breakdown && (
            <>
              <SectionHeader title={t('regPayment')} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                <Chip testID="reg-plan-FULL" label={t('regPlanFull', { amount: money(breakdown.athletePays) })} selected={plan === 'FULL'} onPress={() => setPlan('FULL')} />
                <Chip testID="reg-plan-DEPOSIT" label={t('regPlanDeposit', { amount: money(breakdown.depositNow) })} selected={plan === 'DEPOSIT'} onPress={() => setPlan('DEPOSIT')} />
              </View>
            </>
          )}
        </>
      )}

      {full && (
        <>
          <Txt color={colors.error}>{t('regFull')}</Txt>
          <Button testID="reg-waitlist" kind="outlined" label={t('regWaitlistJoin')} busy={busy} onPress={joinWaitlist} />
        </>
      )}
      {typeof error === 'string' ? <Txt color={colors.error}>{error}</Txt> : <ErrorText error={error} />}
      <Button testID="register-confirm" label={t('compConfirmRegistration')} busy={busy} disabled={!valid || full} onPress={confirm} style={{ marginTop: 8 }} />
    </Screen>
  );
}
