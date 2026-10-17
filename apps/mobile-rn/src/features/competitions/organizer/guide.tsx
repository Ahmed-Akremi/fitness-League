import { space, useTheme } from '../../../core/theme';
import { Button, Card, Txt } from '../../../core/widgets/kit';

/** What to do first, with a button to the page where it is done (Circle21's « Create at least one Division »). */
export function Guide({ testID, message, action, onPress }: { testID: string; message: string; action: string; onPress?: () => void }) {
  const { colors } = useTheme();
  return (
    <Card testID={testID} style={{ gap: space.sm }}>
      <Txt color={colors.outline}>{message}</Txt>
      {onPress ? <Button testID={`${testID}-go`} kind="outlined" label={action} onPress={onPress} /> : null}
    </Card>
  );
}
