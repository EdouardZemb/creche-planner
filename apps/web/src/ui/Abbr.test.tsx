import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Abbr } from './Abbr';

describe('Abbr', () => {
  it('rend un <abbr> avec le sigle pour texte visible', () => {
    render(<Abbr sigle="RFR" />);
    const abbr = screen.getByText('RFR');
    expect(abbr.tagName).toBe('ABBR');
  });

  it('résout le title depuis le glossaire quand il est absent', () => {
    render(<Abbr sigle="PSU" />);
    expect(screen.getByText('PSU')).toHaveAttribute(
      'title',
      'Prestation de service unique',
    );
  });

  it('privilégie le title explicite quand il est fourni', () => {
    render(<Abbr sigle="RFR" title="Mon libellé" />);
    expect(screen.getByText('RFR')).toHaveAttribute('title', 'Mon libellé');
  });

  it('retombe sur le sigle si inconnu du glossaire', () => {
    render(<Abbr sigle="XYZ" />);
    expect(screen.getByText('XYZ')).toHaveAttribute('title', 'XYZ');
  });

  it('est atteignable au clavier (focusable)', () => {
    render(<Abbr sigle="ALSH" />);
    const abbr = screen.getByText('ALSH');
    expect(abbr).toHaveAttribute('tabindex', '0');
    abbr.focus();
    expect(abbr).toHaveFocus();
  });
});
