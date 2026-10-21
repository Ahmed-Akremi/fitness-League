import { useT } from '../../../core/prefs';
import { TabStack } from '../../../features/shell/tab-stack';

export default function Layout() {
  const t = useT();
  return <TabStack title={t('navLeague')} />;
}
