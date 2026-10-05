import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useT, type T } from '../../core/prefs';
import { useApi } from '../../core/services';
import { useTheme } from '../../core/theme';
import { errorMessage } from '../../core/widgets/error';
import { Button, Icon, IconButton, TextField, Txt, toast } from '../../core/widgets/kit';

const REASONS = ['CHEATING', 'HARASSMENT', 'SPAM', 'INAPPROPRIATE', 'IMPERSONATION', 'OTHER'];

export const reportReasonLabel = (t: T, r: string) =>
  r === 'CHEATING'
    ? t('reportCheating')
    : r === 'HARASSMENT'
      ? t('reportHarassment')
      : r === 'SPAM'
        ? t('reportSpam')
        : r === 'INAPPROPRIATE'
          ? t('reportInappropriate')
          : r === 'IMPERSONATION'
            ? t('reportImpersonation')
            : t('reportOther');

export type ReportTarget = { targetType: 'USER' | 'WORKOUT' | 'COMMENT' | 'GYM'; targetId: string };

/**
 * Report an athlete, a workout, a comment or a gym (docs §3.12). Moderators review it; the reporter only
 * learns that it was handled.
 */
export function ReportSheet({ target, onClose }: { target: ReportTarget | null; onClose: () => void }) {
  const t = useT();
  const { colors } = useTheme();
  const api = useApi();
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    try {
      await api.post('/reports', { ...target, reason, ...(details.trim() ? { details: details.trim() } : {}) });
      setReason(null);
      setDetails('');
      onClose();
      toast(t('reportSent'));
    } catch (e) {
      toast(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={target != null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Txt variant="title" style={{ flex: 1, fontSize: 20 }}>{t('report')}</Txt>
              <IconButton icon="close" label={t('cancel')} onPress={onClose} />
            </View>
            {REASONS.map((r) => (
              <Pressable key={r} testID={`reason-${r}`} accessibilityRole="radio" accessibilityState={{ checked: reason === r }} onPress={() => setReason(r)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}>
                <Icon name={reason === r ? 'radio-button-checked' : 'radio-button-unchecked'} color={reason === r ? colors.primary : colors.outline} />
                <Txt>{reportReasonLabel(t, r)}</Txt>
              </Pressable>
            ))}
            <TextField label={t('reportDetails')} value={details} onChangeText={setDetails} maxLength={1000} multiline />
            <Button testID="report-send" label={t('reportSend')} busy={busy} disabled={reason == null} onPress={send} style={{ marginTop: 8 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
