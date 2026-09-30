import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Image, ScrollView, View } from 'react-native';

import type { Json } from '../../core/api/client';
import { useT } from '../../core/prefs';
import { useApi } from '../../core/services';
import { useTheme } from '../../core/theme';
import { pickImage } from '../../core/utils/pick-image';
import { StatCard } from '../../core/widgets/common';
import { errorMessage } from '../../core/widgets/error';
import { Button, IconButton, Txt, toast } from '../../core/widgets/kit';

/** Photos or screenshots backing a workout (docs §3.5): a moderator verifies them, which makes the workout count more. */
export function ProofsSection({ workoutId }: { workoutId: string }) {
  const t = useT();
  const { colors } = useTheme();
  const api = useApi();
  const qc = useQueryClient();
  const key = ['workouts', workoutId, 'proofs'];
  const data = useQuery({ queryKey: key, queryFn: () => api.get<Json>(`/workouts/${workoutId}/proofs`) }).data;
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const picked = await pickImage(8 * 1024 * 1024);
    if (!picked) return;
    if ('tooLarge' in picked) return toast(t('proofTooLarge'));
    await run(() => api.upload(`/workouts/${workoutId}/proofs`, picked.file, { post: true }));
  }

  if (!data) return null;
  const status: string = data.status;
  const proofs: Json[] = data.proofs ?? [];
  const [label, color] =
    status === 'VERIFIED' ? [t('proofVerified'), colors.primary] : status === 'PENDING' ? [t('proofPending'), colors.outline] : status === 'REJECTED' ? [t('proofRejected'), colors.error] : [t('proofNone'), colors.outline];
  return (
    <StatCard label={t('proofs')} trailing={<Txt color={color} style={{ fontWeight: '700' }}>{label}</Txt>}>
      {status === 'REJECTED' && data.note ? <Txt color={colors.error} style={{ marginBottom: 8 }}>{data.note}</Txt> : null}
      {proofs.length > 0 && (
        <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
          {proofs.map((p) => (
            <View key={p.id}>
              <Image source={{ uri: p.url }} style={{ width: 96, height: 96, borderRadius: 8, backgroundColor: colors.surfaceHigh }} />
              {status !== 'VERIFIED' && (
                <View style={{ position: 'absolute', top: 0, end: 0 }}>
                  <IconButton icon="close" label={t('delete')} onPress={() => !busy && run(() => api.delete(`/workouts/${workoutId}/proofs/${p.id}`))} />
                </View>
              )}
            </View>
          ))}
        </ScrollView>
      )}
      {status === 'NONE' && <Txt variant="small" color={colors.outline}>{t('proofHint')}</Txt>}
      {proofs.length < 3 && status !== 'VERIFIED' && <Button kind="text" icon="add-a-photo" label={t('addProof')} disabled={busy} onPress={add} style={{ alignSelf: 'flex-start' }} />}
    </StatCard>
  );
}
