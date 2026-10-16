import { fireEvent } from 'expo-router/testing-library';
import { StyleSheet } from 'react-native';

import { ThemeScope, useTheme } from '../../src/core/theme';
import { SectionHeader, StatusPill } from '../../src/core/widgets/common';
import { Button, Card, Chip, ListGroup, ListRow, SwitchRow, TextField, Txt } from '../../src/core/widgets/kit';
import { Select } from '../../src/core/widgets/pickers';
import { FakeBackend } from '../fake-api';
import { renderScreen } from '../harness';

describe('shared widgets', () => {
  it('ListGroup puts one divider between rows and skips empty children', async () => {
    const show = false;
    const screen = await renderScreen(
      () => (
        <ListGroup>
          <ListRow title="A" />
          {show && <ListRow title="hidden" />}
          {null}
          <ListRow title="B" />
          <ListRow title="C" />
        </ListGroup>
      ),
      new FakeBackend(),
    );
    expect(screen.getByText('A')).toBeTruthy();
    expect(screen.queryByText('hidden')).toBeNull();
    expect(screen.getAllByTestId('list-divider')).toHaveLength(2);
  });

  it('SectionHeader renders its action as a link', async () => {
    const onAction = jest.fn();
    const screen = await renderScreen(() => <SectionHeader title="My gym" actionLabel="Gyms" onAction={onAction} />, new FakeBackend());
    fireEvent.press(screen.getByText('Gyms'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('StatusPill shows its label', async () => {
    const screen = await renderScreen(() => <StatusPill label="Accepted" color="#C6F432" />, new FakeBackend());
    expect(screen.getByText('Accepted')).toBeTruthy();
  });
});

describe('dense look of the computer layout (ThemeScope)', () => {
  const style = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;

  it('cards, buttons and chips get small radii and 32 px controls; outside the scope nothing changes', async () => {
    const screen = await renderScreen(
      () => (
        <>
          <Card testID="phone-card">
            <Txt>a</Txt>
          </Card>
          <Button testID="phone-button" label="Go" onPress={() => {}} />
          <ThemeScope dense>
            <Card testID="dense-card">
              <Txt>b</Txt>
            </Card>
            <Button testID="dense-button" label="Go" onPress={() => {}} />
            <Chip testID="dense-chip" label="All" selected />
          </ThemeScope>
        </>
      ),
      new FakeBackend(),
    );
    expect(style(screen.getByTestId('phone-card'))).toMatchObject({ borderRadius: 20, padding: 16, borderWidth: 1 });
    expect(style(screen.getByTestId('dense-card'))).toMatchObject({ borderRadius: 10, padding: 16, borderWidth: 0 });
    expect(style(screen.getByTestId('phone-button'))).toMatchObject({ minHeight: 50, borderRadius: 999 });
    expect(style(screen.getByTestId('dense-button'))).toMatchObject({ minHeight: 32, borderRadius: 6 });
    expect(style(screen.getByTestId('dense-chip'))).toMatchObject({ borderRadius: 6 });
  });

  it('a field has 14 px text inside the scope, 16 px outside', async () => {
    const screen = await renderScreen(
      () => (
        <>
          <TextField testID="phone-field" value="" onChangeText={() => {}} />
          <ThemeScope dense>
            <TextField testID="dense-field" value="" onChangeText={() => {}} />
          </ThemeScope>
        </>
      ),
      new FakeBackend(),
    );
    expect(style(screen.getByTestId('phone-field'))).toMatchObject({ fontSize: 16, paddingVertical: 12 });
    expect(style(screen.getByTestId('dense-field'))).toMatchObject({ fontSize: 14, paddingVertical: 7 });
  });

  it('the section title is 13 px uppercase with 0.5 letter spacing', async () => {
    const screen = await renderScreen(
      () => (
        <ThemeScope dense>
          <SectionHeader title="Promo codes" />
        </ThemeScope>
      ),
      new FakeBackend(),
    );
    expect(style(screen.getByText('Promo codes'))).toMatchObject({ fontSize: 13, letterSpacing: 0.5, textTransform: 'uppercase' });
  });

  it('`scheme` forces the light palette inside a dark page, and the scopes add up', async () => {
    function Probe() {
      const { colors, dark, dense } = useTheme();
      return <Txt testID="probe">{`${dark}-${colors.background}-${dense}`}</Txt>;
    }
    const screen = await renderScreen(
      () => (
        <>
          <Probe />
          <ThemeScope dense>
            <ThemeScope scheme="light">
              <Probe />
            </ThemeScope>
          </ThemeScope>
        </>
      ),
      new FakeBackend(),
    );
    const [page, panel] = screen.getAllByTestId('probe');
    expect(page.props.children).toBe('true-#0E0F12-false');
    expect(panel.props.children).toBe('false-#FFFFFF-true');
  });

  it('an « on » switch is green on a computer (Circle21), in the accent on a phone', async () => {
    const screen = await renderScreen(
      () => (
        <>
          <SwitchRow testID="phone-switch" title="phone" value onChange={() => {}} />
          <ThemeScope dense>
            <SwitchRow testID="dense-switch" title="computer" value onChange={() => {}} />
          </ThemeScope>
        </>
      ),
      new FakeBackend(),
    );
    // The native switch gets the « on » colour as `onTintColor` (iOS, the test platform) or `trackColorForTrue` (Android).
    const on = (id: string) => screen.getByTestId(id).props.onTintColor ?? screen.getByTestId(id).props.trackColorForTrue;
    expect(on('phone-switch')).toBe('#C6F432');
    expect(on('dense-switch')).toBe('#3DDC84');
  });

  it('a select in a toolbar shows no label above it but keeps it for screen readers', async () => {
    const screen = await renderScreen(
      () => (
        <ThemeScope dense>
          <Select testID="pay" bare label="Payment" value="ALL" options={[{ value: 'ALL', label: 'Any payment' }]} onChange={() => {}} />
        </ThemeScope>
      ),
      new FakeBackend(),
    );
    expect(screen.queryByText('Payment')).toBeNull();
    expect(screen.getByText('Any payment')).toBeTruthy();
    expect(screen.getByTestId('pay').props.accessibilityLabel).toBe('Payment');
    expect(style(screen.getByTestId('pay'))).toMatchObject({ minHeight: 32, borderRadius: 6 });
  });
});
