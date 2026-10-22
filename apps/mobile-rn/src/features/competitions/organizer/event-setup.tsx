import { View } from 'react-native';

import { useT } from '../../../core/prefs';
import { space, useTheme } from '../../../core/theme';
import { SectionHeader } from '../../../core/widgets/common';
import { Button, Chip, SwitchRow, Txt } from '../../../core/widgets/kit';
import { LocalBadge } from './local-badge';
import { LABELS, newAccessCode, PARTICIPANT_TYPES, VISIBILITIES, type EventLabel, type EventSetup, type HybridTemplate, type ParticipantType, type Visibility } from './logic-event';
import type { EventStyle } from './logic';

/**
 * Phase 2: the event's type, visibility, participants, label and invite-only switch, shared by the creation form and
 * General. Kept on the device for now (« Local »). `locked`: the type no longer changes once the event has a WOD.
 */
export function EventSetupFields({ value, onChange, locked = false }: { value: EventSetup; onChange: (s: EventSetup) => void; locked?: boolean }) {
  const t = useT();
  const { colors } = useTheme();
  const set = (patch: Partial<EventSetup>) => onChange({ ...value, ...patch });

  const styles: { key: EventStyle; label: string; hint: string }[] = [
    { key: 'FUNCTIONAL_FITNESS', label: t('orgStyleFF'), hint: t('orgStyleFFHint') },
    { key: 'HYBRID_RACE', label: t('orgStyleHybrid'), hint: t('orgStyleHybridHint') },
  ];
  const templates: { key: HybridTemplate; label: string }[] = [
    { key: 'HYROX_STYLE', label: t('orgTemplateHyrox') },
    { key: 'CUSTOM', label: t('orgTemplateCustom') },
  ];
  const visibility: Record<Visibility, { label: string; hint: string }> = {
    PUBLIC: { label: t('orgVisPublic'), hint: t('orgVisPublicHint') },
    PASSWORD: { label: t('orgVisPassword'), hint: t('orgVisPasswordHint') },
    LINK: { label: t('orgVisLink'), hint: t('orgVisLinkHint') },
  };
  const participants: Record<ParticipantType, string> = { INDIVIDUAL: t('orgForIndividuals'), TEAM: t('orgForTeams') };
  const labels: Record<EventLabel, string> = {
    NONE: t('orgLabelNone'),
    QUALIFIER: t('orgLabelQualifier'),
    FINAL: t('orgLabelFinal'),
    CHARITY: t('orgLabelCharity'),
    BATTLE: t('orgLabelBattle'),
    CHALLENGE: t('orgLabelChallenge'),
    WORKSHOP: t('orgLabelWorkshop'),
  };

  const pickVisibility = (v: Visibility) => set({ visibility: v, accessCode: v === 'PASSWORD' ? value.accessCode ?? newAccessCode() : value.accessCode });
  const toggleParticipant = (p: ParticipantType) =>
    set({ participantTypes: PARTICIPANT_TYPES.filter((x) => (x === p ? !value.participantTypes.includes(p) : value.participantTypes.includes(x))) });

  return (
    <>
      <SectionHeader title={t('orgSetupStyle')} />
      <View style={{ alignSelf: 'flex-start' }}>
        <LocalBadge />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {styles.map((s) => (
          <Chip key={s.key} testID={`org-style-${s.key}`} label={s.label} selected={value.eventStyle === s.key} onPress={locked ? undefined : () => set({ eventStyle: s.key })} />
        ))}
      </View>
      <Txt variant="small" color={colors.outline}>{styles.find((s) => s.key === value.eventStyle)?.hint}</Txt>
      {locked && <Txt variant="small" color={colors.outline}>{t('orgStyleLocked')}</Txt>}
      {value.eventStyle === 'HYBRID_RACE' && (
        <>
          <Txt variant="label" color={colors.outline}>{t('orgTemplate')}</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {templates.map((tp) => (
              <Chip key={tp.key} testID={`org-template-${tp.key}`} label={tp.label} selected={value.hybridTemplate === tp.key} onPress={locked ? undefined : () => set({ hybridTemplate: tp.key })} />
            ))}
          </View>
        </>
      )}

      <SectionHeader title={t('orgVisibility')} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {VISIBILITIES.map((v) => (
          <Chip key={v} testID={`org-visibility-${v}`} label={visibility[v].label} selected={value.visibility === v} onPress={() => pickVisibility(v)} />
        ))}
      </View>
      <Txt variant="small" color={colors.outline}>{visibility[value.visibility].hint}</Txt>
      {value.visibility === 'PASSWORD' && value.accessCode && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
          <Txt testID="org-access-code" style={{ fontWeight: '700' }}>{t('orgAccessCode', { code: value.accessCode })}</Txt>
          <Button testID="org-access-code-new" kind="text" label={t('orgAccessCodeNew')} onPress={() => set({ accessCode: newAccessCode() })} />
        </View>
      )}

      <SectionHeader title={t('orgParticipantsFor')} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {PARTICIPANT_TYPES.map((p) => (
          <Chip key={p} testID={`org-participants-${p}`} label={participants[p]} selected={value.participantTypes.includes(p)} onPress={() => toggleParticipant(p)} />
        ))}
      </View>

      <SectionHeader title={t('orgLabel')} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {LABELS.map((l) => (
          <Chip key={l} testID={`org-label-${l}`} label={labels[l]} selected={value.label === l} onPress={() => set({ label: l })} />
        ))}
      </View>

      <SwitchRow testID="org-invite-only" title={t('orgInviteOnly')} value={value.inviteOnly} onChange={(inviteOnly) => set({ inviteOnly })} />
      <Txt variant="small" color={colors.outline}>{t('orgInviteOnlyHint')}</Txt>
    </>
  );
}
