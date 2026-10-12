import { render, screen } from '@testing-library/react';
import { App } from './App';

it('renders the page title', () => {
  render(<App />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Fitness League');
});
