import { View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useT } from '../../../core/prefs';
import { space, useTheme } from '../../../core/theme';
import { SectionHeader } from '../../../core/widgets/common';
import { Button, Chip, SwitchRow, TextField, Txt } from '../../../core/widgets/kit';
import { DateField } from '../../../core/widgets/pickers';
import { LocalBadge } from './local-badge';
import type { DivisionDraft, DivisionProblem } from './logic-division';
import { newAccessCode } from './logic-event';

const DAY = 86_400_000;

/**
 * Phase 3: the division part of the category form (team composition, sub-division, lock, early-bird, team rules).
 * Kept on the device for now; `categoryId` is the edited category (absent for a new one).
 */
export function DivisionFields({
  value,
  onChange,
  categories,
  categoryId,
  problems,
  registrationEnd,
}: {
  value: DivisionDraft;
  onChange: (d: DivisionDraft) => void;
  categories: Json[];
  categoryId?: string;
  problems: DivisionProblem[];
  registrationEnd: string;
}) {
  const t = useT();
  const { colors } = useTheme();
  const set = (patch: Partial<DivisionDraft>) => onChange({ ...value, ...patch });
  const error = (p: DivisionProblem, text: string) => (problems.includes(p) ? <Txt variant="small" color={colors.error}>{text}</Txt> : null);
  const team = value.type === 'TEAM';
  const closes = new Date(registrationEnd);
  // A parent is a main division other than this one; a division that has sub-divisions stays a main one.
  const parents = categories.filter((k) => k.id !== categoryId && !k.parentId);

  return (
    <>
      <SectionHeader title={t('orgDivType')} />
      <View style={{ alignSelf: 'flex-start' }}>
        <LocalBadge />
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Chip testID="div-type-INDIVIDUAL" label={t('orgForIndividuals')} selected={!team} onPress={() => set({ type: 'INDIVIDUAL' })} />
        <Chip testID="div-type-TEAM" label={t('orgForTeams')} selected={team} onPress={() => set({ type: 'TEAM' })} />
      </View>
      {team && (
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <View style={{ flex: 1 }}>
            <TextField testID="div-team-male" label={t('orgDivTeamMale')} value={value.teamMale} onChangeText={(v) => set({ teamMale: v })} keyboardType="number-pad" />
          </View>
          <View style={{ flex: 1 }}>
            <TextField testID="div-team-female" label={t('orgDivTeamFemale')} value={value.teamFemale} onChangeText={(v) => set({ teamFemale: v })} keyboardType="number-pad" />
          </View>
        </View>
      )}
      {error('TEAM_SIZE', t('orgDivTeamSizeInvalid'))}

      {parents.length > 0 && (
        <>
          <Txt variant="label" color={colors.outline}>{t('orgDivParent')}</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            <Chip testID="div-parent-none" label={t('orgDivParentNone')} selected={!value.parentId} onPress={() => set({ parentId: null })} />
            {parents.map((k) => (
              <Chip key={k.id} testID={`div-parent-${k.id}`} label={k.name} selected={value.parentId === k.id} onPress={() => set({ parentId: k.id })} />
            ))}
          </View>
          {error('PARENT', t('orgDivParentInvalid'))}
        </>
      )}

      <SwitchRow testID="div-locked" title={t('orgDivLocked')} value={value.locked} onChange={(locked) => set({ locked, unlockCode: locked ? value.unlockCode ?? newAccessCode() : value.unlockCode })} />
      {value.locked && value.unlockCode && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
          <Txt testID="div-code" style={{ fontWeight: '700' }}>{t('orgDivUnlockCode', { code: value.unlockCode })}</Txt>
          <Button testID="div-code-new" kind="text" label={t('orgAccessCodeNew')} onPress={() => set({ unlockCode: newAccessCode() })} />
        </View>
      )}

      <TextField
        testID="div-early-price"
        label={t('orgDivEarlyPrice')}
        value={value.earlyPrice}
        onChangeText={(v) => set({ earlyPrice: v, earlyUntil: value.earlyUntil ?? (v.trim() ? new Date(closes.getTime() - 7 * DAY) : null) })}
        keyboardType="decimal-pad"
      />
      {error('EARLY_PRICE', t('orgDivEarlyPriceInvalid'))}
      {value.earlyPrice.trim() && value.earlyUntil && <DateField testID="div-early-until" mode="date" label={t('orgDivEarlyUntil')} value={value.earlyUntil} onChange={(d) => set({ earlyUntil: d })} />}
      {error('EARLY_DATE', t('orgDivEarlyDateInvalid'))}

      {team && (
        <>
          <SectionHeader title={t('orgDivTeamRules')} />
          <SwitchRow testID="div-name-change" title={t('orgDivNameChange')} value={value.teamNameChangeUntil != null} onChange={(on) => set({ teamNameChangeUntil: on ? closes : null })} />
          {value.teamNameChangeUntil && <DateField testID="div-name-change-until" mode="date" label={t('orgDivNameChangeUntil')} value={value.teamNameChangeUntil} onChange={(d) => set({ teamNameChangeUntil: d })} />}
          <SwitchRow testID="div-member-change" title={t('orgDivMemberChange')} value={value.memberChangeUntil != null} onChange={(on) => set({ memberChangeUntil: on ? closes : null })} />
          {value.memberChangeUntil && (
            <>
              <DateField testID="div-member-change-until" mode="date" label={t('orgDivMemberChangeUntil')} value={value.memberChangeUntil} onChange={(d) => set({ memberChangeUntil: d })} />
              <TextField testID="div-member-change-price" label={t('orgDivMemberChangePrice')} value={value.memberChangePrice} onChangeText={(v) => set({ memberChangePrice: v })} keyboardType="decimal-pad" />
              {error('CHANGE_PRICE', t('orgSetAppealPriceInvalid'))}
            </>
          )}
          <SwitchRow testID="div-one-stays" title={t('orgDivOneStays')} value={value.oneMemberStays} onChange={(oneMemberStays) => set({ oneMemberStays })} />
        </>
      )}
    </>
  );
}
