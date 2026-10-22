import { useRef, useState } from 'react';
import { View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useT } from '../../../core/prefs';
import { useApi } from '../../../core/services';
import { space, useTheme } from '../../../core/theme';
import { SectionHeader } from '../../../core/widgets/common';
import { ErrorText } from '../../../core/widgets/error';
import { Button, Card, Chip, IconButton, ListGroup, ListRow, Screen, SwitchRow, TextField, Txt, toast } from '../../../core/widgets/kit';
import { organizerApi, useRefreshCompetition } from './api';
import { LocalBadge } from './local-badge';
import { agreementProblems, agreementsOf, FIELD_TYPES, fieldProblems, formOf, moveField, type Agreements, type FieldType, type FormField } from './logic-forms';
import { OrgPageHeader } from './page';

const newFieldId = () => `f_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Phase 3: the extra questions athletes answer when they register, and the agreements they accept. Kept on the device for now. */
export function FormsTab({ c }: { c: Json }) {
  const t = useT();
  const api = useApi();
  const { colors } = useTheme();
  const refresh = useRefreshCompetition();
  const [fields, setFields] = useState<FormField[]>(() => formOf(c));
  const [agreements, setAgreements] = useState<Agreements>(() => agreementsOf(c));
  const [editing, setEditing] = useState<FormField | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const sending = useRef(false);
  const problems = agreementProblems(agreements);
  const typeLabel = (type: FieldType) => t(`orgFormType${type}`);
  const setAgr = <K extends keyof Agreements>(key: K, patch: Partial<Agreements[K]>) => setAgreements({ ...agreements, [key]: { ...agreements[key], ...patch } });

  async function save() {
    if (sending.current || problems.length || editing) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      await organizerApi(api).update(c.id, { registrationForm: fields, agreements });
      toast(t('orgSaved'));
      await refresh();
    } catch (e) {
      setError(e);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  function keep(f: FormField) {
    setFields(fields.some((x) => x.id === f.id) ? fields.map((x) => (x.id === f.id ? f : x)) : [...fields, f]);
    setEditing(null);
  }

  const text = (key: 'liability' | 'custom' | 'medicalReport' | 'additionalDocument', field: 'text' | 'title' | 'description', testID: string, label: string) => (
    <TextField testID={testID} label={label} value={(agreements[key] as Json)[field]} onChangeText={(v) => setAgr(key, { [field]: v } as never)} multiline={field !== 'title'} maxLength={field === 'title' ? 120 : 5000} />
  );
  const missing = (show: boolean, label = t('orgAgrTextMissing')) => (show ? <Txt variant="small" color={colors.error}>{label}</Txt> : null);

  return (
    <>
      <OrgPageHeader tab="forms" />
      <Screen>
        <View style={{ alignSelf: 'flex-start' }}>
          <LocalBadge />
        </View>
        <SectionHeader title={t('orgFormQuestions')} />
        {fields.length === 0 && <Txt color={colors.outline}>{t('orgFormEmpty')}</Txt>}
        {fields.length > 0 && (
          <ListGroup>
            {fields.map((f, i) => (
              <ListRow
                key={f.id}
                testID={`form-field-${f.id}`}
                title={f.label}
                subtitle={[typeLabel(f.type), f.required ? t('orgFormRequired') : null].filter(Boolean).join(' · ')}
                onPress={() => setEditing(f)}
                trailing={
                  <View style={{ flexDirection: 'row' }}>
                    {i > 0 ? <IconButton testID={`form-field-up-${f.id}`} icon="arrow-upward" label={t('orgMoveUp')} onPress={() => setFields(moveField(fields, i, -1))} /> : null}
                    {i < fields.length - 1 ? <IconButton testID={`form-field-down-${f.id}`} icon="arrow-downward" label={t('orgMoveDown')} onPress={() => setFields(moveField(fields, i, 1))} /> : null}
                    <IconButton testID={`form-field-remove-${f.id}`} icon="delete" label={t('orgFormRemove')} onPress={() => setFields(fields.filter((x) => x.id !== f.id))} />
                  </View>
                }
              />
            ))}
          </ListGroup>
        )}
        {editing ? (
          <FieldEditor field={editing} typeLabel={typeLabel} onSave={keep} onCancel={() => setEditing(null)} />
        ) : (
          <Button testID="form-add" kind="outlined" icon="add" label={t('orgFormAdd')} onPress={() => setEditing({ id: newFieldId(), label: '', type: 'TEXT', required: true, options: [] })} />
        )}

        <SectionHeader title={t('orgAgreements')} />
        <SwitchRow testID="agr-liability" title={t('orgAgrLiability')} value={agreements.liability.required} onChange={(required) => setAgr('liability', { required })} />
        {agreements.liability.required && text('liability', 'text', 'agr-liability-text', t('orgAgrLiabilityText'))}
        {missing(problems.includes('LIABILITY_TEXT'))}
        <SwitchRow testID="agr-custom" title={t('orgAgrCustom')} value={agreements.custom.required} onChange={(required) => setAgr('custom', { required })} />
        {agreements.custom.required && (
          <>
            {text('custom', 'title', 'agr-custom-title', t('orgAgrCustomTitle'))}
            {text('custom', 'text', 'agr-custom-text', t('orgAgrCustomText'))}
          </>
        )}
        {missing(problems.includes('CUSTOM_TITLE') || problems.includes('CUSTOM_TEXT'))}
        <SwitchRow testID="agr-minors" title={t('orgAgrMinors')} value={agreements.minors.enabled} onChange={(enabled) => setAgr('minors', { enabled })} />
        {agreements.minors.enabled && (
          <>
            <TextField testID="agr-minors-age" label={t('orgAgrMinorsAge')} value={String(agreements.minors.age)} onChangeText={(v) => setAgr('minors', { age: Number(v.trim() || NaN) })} keyboardType="number-pad" />
            {missing(problems.includes('MINOR_AGE'), t('orgAgrAgeInvalid'))}
            <SwitchRow testID="agr-minors-photo" title={t('orgAgrMinorsPhoto')} value={agreements.minors.photoConsent} onChange={(photoConsent) => setAgr('minors', { photoConsent })} />
          </>
        )}
        <SwitchRow testID="agr-medical" title={t('orgAgrMedical')} value={agreements.medicalReport.required} onChange={(required) => setAgr('medicalReport', { required })} />
        {agreements.medicalReport.required && text('medicalReport', 'description', 'agr-medical-text', t('orgAgrMedicalText'))}
        <SwitchRow testID="agr-document" title={t('orgAgrDocument')} value={agreements.additionalDocument.required} onChange={(required) => setAgr('additionalDocument', { required })} />
        {agreements.additionalDocument.required && (
          <>
            {text('additionalDocument', 'title', 'agr-document-title', t('orgAgrDocumentTitle'))}
            {text('additionalDocument', 'description', 'agr-document-text', t('orgAgrMedicalText'))}
          </>
        )}
        {missing(problems.includes('DOCUMENT_TITLE'))}
        <SwitchRow testID="agr-face" title={t('orgAgrFace')} value={agreements.faceRecognition.required} onChange={(required) => setAgr('faceRecognition', { required })} />

        <ErrorText error={error} />
        <Button testID="forms-save" label={t('save')} busy={busy} disabled={problems.length > 0 || editing != null} onPress={save} />
      </Screen>
    </>
  );
}

function FieldEditor({ field, typeLabel, onSave, onCancel }: { field: FormField; typeLabel: (t: FieldType) => string; onSave: (f: FormField) => void; onCancel: () => void }) {
  const t = useT();
  const { colors } = useTheme();
  const [f, setF] = useState(field);
  const [options, setOptions] = useState(field.options.join(', '));
  const candidate: FormField = { ...f, label: f.label.trim(), options: f.type === 'SELECT' ? options.split(',').map((o) => o.trim()).filter(Boolean) : [] };
  const problems = fieldProblems(candidate);
  return (
    <Card style={{ gap: space.md }}>
      <TextField testID="form-field-label" label={t('orgFormLabel')} value={f.label} onChangeText={(label) => setF({ ...f, label })} maxLength={80} />
      {problems.includes('LABEL') && f.label.length > 0 && <Txt variant="small" color={colors.error}>{t('orgFormLabelInvalid')}</Txt>}
      <Txt variant="label" color={colors.outline}>{t('orgFormType')}</Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {FIELD_TYPES.map((type) => (
          <Chip key={type} testID={`form-field-type-${type}`} label={typeLabel(type)} selected={f.type === type} onPress={() => setF({ ...f, type })} />
        ))}
      </View>
      {f.type === 'SELECT' && (
        <>
          <TextField testID="form-field-options" label={t('orgFormOptions')} value={options} onChangeText={setOptions} maxLength={500} />
          {problems.includes('OPTIONS') && <Txt variant="small" color={colors.error}>{t('orgFormOptionsInvalid')}</Txt>}
        </>
      )}
      <SwitchRow testID="form-field-required" title={t('orgFormRequired')} value={f.required} onChange={(required) => setF({ ...f, required })} />
      <Button testID="form-field-save" label={t('save')} disabled={problems.length > 0} onPress={() => onSave(candidate)} />
      <Button testID="form-field-cancel" kind="text" label={t('cancel')} onPress={onCancel} />
    </Card>
  );
}
