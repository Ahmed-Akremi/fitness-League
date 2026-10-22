import { useRef, useState } from 'react';
import { View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { useApi } from '../../../core/services';
import { space, useTheme } from '../../../core/theme';
import { ErrorText } from '../../../core/widgets/error';
import { Button, Card, Chip, IconButton, ListGroup, ListRow, Screen, TextField, Txt, toast } from '../../../core/widgets/kit';
import { formatMoney } from '../api';
import { organizerApi, useRefreshCompetition } from './api';
import { DivisionFields } from './division-fields';
import { catBody, catDraft, catValid, toMillimes, type CatDraft } from './logic';
import { divisionBody, divisionDraft, divisionProblems, teamSize, type DivisionDraft } from './logic-division';
import { OrgPageHeader } from './page';
import { useWideWeb } from './web';

export function CategoriesTab({ c }: { c: Json }) {
  const t = useT();
  const locale = useLocale();
  const api = useApi();
  const { colors } = useTheme();
  const refresh = useRefreshCompetition();
  const cats: Json[] = [...(c.categories ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  // Phase 3: the server's category and the division extras kept on the device, edited together.
  const [edit, setEdit] = useState<{ draft: CatDraft; extra: DivisionDraft } | null>(null);
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const wide = useWideWeb();
  const genderLabel: Record<string, string> = { MALE: t('orgGenderMale'), FEMALE: t('orgGenderFemale'), MIXED: t('orgGenderMixed') };

  async function run(fn: () => Promise<unknown>, after?: () => void, done?: string) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      await fn();
      after?.();
      // Only once the request has succeeded: an error keeps its text, with no toast.
      if (done) toast(done);
    } catch (e) {
      setError(e);
    } finally {
      await refresh();
      sending.current = false;
      setBusy(false);
    }
  }

  const save = (d: CatDraft, x: DivisionDraft) =>
    run(
      () => (d.id ? organizerApi(api).updateCategory(c.id, d.id, { ...catBody(d), ...divisionBody(x) }) : organizerApi(api).addCategory(c.id, { ...catBody(d), ...divisionBody(x), sortOrder: cats.length })),
      () => setEdit(null),
      t('orgSaved'),
    );
  const toggle = (d: CatDraft) => run(() => organizerApi(api).updateCategory(c.id, d.id!, { active: !d.active }), () => setEdit(null), d.active ? t('orgToastDeactivated') : t('orgToastActivated'));

  /** Swaps two neighbours, then gives every category its position as sortOrder (only the changed ones are sent). */
  function move(i: number, dir: -1 | 1) {
    const order = cats.map((x) => x.id as string);
    [order[i], order[i + dir]] = [order[i + dir], order[i]];
    void run(async () => {
      for (const [n, id] of order.entries()) {
        if (cats.find((x) => x.id === id)!.sortOrder !== n) await organizerApi(api).updateCategory(c.id, id, { sortOrder: n });
      }
    }, undefined, t('orgToastOrder'));
  }

  const subtitle = (x: Json) =>
    [
      genderLabel[x.gender],
      x.minAge != null || x.maxAge != null ? `${x.minAge ?? ''}–${x.maxAge ?? ''}` : null,
      x.level || null,
      x.maxParticipants ? String(x.maxParticipants) : null,
      x.registrationPriceOverride != null ? formatMoney(x.registrationPriceOverride, c.currency, locale) : null,
      x.type === 'TEAM' ? t('orgDivTeamOf', { count: teamSize(x) }) : null,
      x.parentId ? t('orgDivSubOf', { name: cats.find((k) => k.id === x.parentId)?.name ?? '' }) : null,
      x.locked ? t('orgDivLockedShort') : null,
      x.earlyPrice != null ? t('orgDivEarlyShort', { price: formatMoney(x.earlyPrice, c.currency, locale) }) : null,
      x.active ? null : t('orgInactive'),
    ]
      .filter(Boolean)
      .join(' · ');

  if (edit) return <CategoryForm draft={edit.draft} extra={edit.extra} c={c} cats={cats} busy={busy} error={error} onSave={save} onToggle={toggle} onCancel={() => setEdit(null)} />;
  const add = <Button testID="cat-new" icon="add" label={t('orgNewCategory')} onPress={() => setEdit({ draft: catDraft(null), extra: divisionDraft(null) })} />;
  return (
    <>
      <OrgPageHeader tab="categories" actions={add} />
      <Screen>
        {cats.length === 0 ? (
          <>
            <Txt color={colors.outline}>{t('orgNoCategories')}</Txt>
            <Button testID="cat-templates" kind="outlined" icon="playlist-add" label={t('orgAddTemplates')} busy={busy} onPress={() => run(() => organizerApi(api).addTemplates(c.id), undefined, t('orgToastTemplates'))} />
          </>
        ) : (
          <ListGroup>
            {cats.map((x, i) => (
              <ListRow
                key={x.id}
                testID={`cat-${x.id}`}
                title={x.name}
                subtitle={subtitle(x)}
                onPress={() => setEdit({ draft: catDraft(x), extra: divisionDraft(x) })}
                trailing={
                  <View style={{ flexDirection: 'row' }}>
                    {i > 0 ? <IconButton icon="arrow-upward" label={t('orgMoveUp')} onPress={() => move(i, -1)} /> : null}
                    {i < cats.length - 1 ? <IconButton icon="arrow-downward" label={t('orgMoveDown')} onPress={() => move(i, 1)} /> : null}
                  </View>
                }
              />
            ))}
          </ListGroup>
        )}
        <ErrorText error={error} />
        {wide ? null : add}
      </Screen>
    </>
  );
}

function CategoryForm({
  draft,
  extra,
  c,
  cats,
  busy,
  error,
  onSave,
  onToggle,
  onCancel,
}: {
  draft: CatDraft;
  extra: DivisionDraft;
  c: Json;
  cats: Json[];
  busy: boolean;
  error: unknown;
  onSave: (d: CatDraft, x: DivisionDraft) => void;
  onToggle: (d: CatDraft) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const { colors } = useTheme();
  const [d, setD] = useState(draft);
  const [x, setX] = useState(extra);
  const problems = divisionProblems(x, { categoryId: d.id, categories: cats, basePrice: d.price.trim() ? toMillimes(d.price) : c.registrationPrice ?? null, registrationEnd: c.registrationEnd });
  const set = (k: 'name' | 'minAge' | 'maxAge' | 'level' | 'max' | 'price') => (v: string) => setD({ ...d, [k]: v });
  const genders: [CatDraft['gender'], string][] = [
    ['MALE', t('orgGenderMale')],
    ['FEMALE', t('orgGenderFemale')],
    ['MIXED', t('orgGenderMixed')],
  ];
  const ok = catValid(d) && problems.length === 0;
  return (
    <Screen>
      <Card style={{ gap: space.md }}>
        <TextField testID="cat-name" label={t('orgCategoryName')} value={d.name} onChangeText={set('name')} maxLength={120} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {genders.map(([g, label]) => (
            <Chip key={g} testID={`cat-gender-${g}`} label={label} selected={d.gender === g} onPress={() => setD({ ...d, gender: g })} />
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <View style={{ flex: 1 }}>
            <TextField testID="cat-min" label={t('orgMinAge')} value={d.minAge} onChangeText={set('minAge')} keyboardType="number-pad" />
          </View>
          <View style={{ flex: 1 }}>
            <TextField testID="cat-max-age" label={t('orgMaxAge')} value={d.maxAge} onChangeText={set('maxAge')} keyboardType="number-pad" />
          </View>
        </View>
        <TextField testID="cat-level" label={t('orgLevel')} value={d.level} onChangeText={set('level')} maxLength={40} />
        <TextField testID="cat-places" label={t('orgCategoryMax')} value={d.max} onChangeText={set('max')} keyboardType="number-pad" />
        <TextField testID="cat-price" label={t('orgCategoryPrice')} value={d.price} onChangeText={set('price')} keyboardType="decimal-pad" />
        {!catValid(d) && d.name.trim().length > 0 ? <Txt variant="small" color={colors.error}>{t('orgCategoryInvalid')}</Txt> : null}
        <DivisionFields value={x} onChange={setX} categories={cats} categoryId={d.id} problems={problems} registrationEnd={c.registrationEnd} />
        <ErrorText error={error} />
        <Button testID="cat-save" label={t('save')} busy={busy} disabled={!ok} onPress={() => onSave(d, x)} />
        {d.id ? <Button testID="cat-toggle" kind="outlined" label={d.active ? t('orgDeactivate') : t('orgActivate')} busy={busy} onPress={() => onToggle(d)} /> : null}
        <Button kind="text" label={t('cancel')} onPress={onCancel} />
      </Card>
    </Screen>
  );
}
