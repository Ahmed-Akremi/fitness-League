import { useT } from '../../core/prefs';
import { EmptyState } from '../../core/widgets/common';
import { Button, Screen, Txt } from '../../core/widgets/kit';
import { useAuth } from '../auth/api';
import { useMe } from '../me/api';

// Sub-project 1 placeholders: these tabs are ported in the next slices.

export function HomeScreen() {
  const t = useT();
  return (
    <Screen>
      <EmptyState icon="home" message={t('appTagline')} />
    </Screen>
  );
}

export function GoalsTabScreen() {
  const t = useT();
  return (
    <Screen>
      <EmptyState icon="flag" message={t('emptyGoals')} />
    </Screen>
  );
}

export function ProfileScreen() {
  const t = useT();
  const auth = useAuth();
  const me = useMe().data;
  return (
    <Screen>
      <Txt variant="headline">{me?.profile?.fullName ?? me?.username ?? ''}</Txt>
      {me?.username ? <Txt>@{me.username}</Txt> : null}
      <Button testID="logout" kind="outlined" icon="logout" label={t('logout')} onPress={() => auth.logout()} style={{ marginTop: 24 }} />
    </Screen>
  );
}
