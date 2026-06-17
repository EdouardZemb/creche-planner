import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Badge } from './Badge';

describe('Badge', () => {
  it('rend la variante par défaut', () => {
    render(<Badge>Info</Badge>);
    const el = screen.getByText('Info');
    expect(el).toHaveClass('badge');
    expect(el).not.toHaveClass('badge-simulation');
  });

  it('rend la variante simulation', () => {
    render(<Badge variante="simulation">SIMULATION</Badge>);
    const el = screen.getByText('SIMULATION');
    expect(el).toHaveClass('badge');
    expect(el).toHaveClass('badge-simulation');
  });
});
