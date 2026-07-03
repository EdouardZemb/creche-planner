import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ChoixPortee } from './ChoixPortee';

describe('ChoixPortee', () => {
  it('expose un groupe de radios étiqueté (fieldset/legend)', () => {
    render(<ChoixPortee valeur="mois" onChange={vi.fn()} nom="test" />);
    // fieldset + legend → groupe nommé « Appliquer ».
    expect(
      screen.getByRole('group', { name: /Appliquer/i }),
    ).toBeInTheDocument();
  });

  it('propose deux radios mutuellement exclusifs', () => {
    render(<ChoixPortee valeur="mois" onChange={vi.fn()} nom="test" />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
  });

  it('coche par défaut « Seulement cette fois » selon la valeur', () => {
    render(<ChoixPortee valeur="mois" onChange={vi.fn()} nom="test" />);
    expect(
      screen.getByRole('radio', { name: /Seulement cette fois/i }),
    ).toBeChecked();
    expect(
      screen.getByRole('radio', { name: /Toutes les semaines/i }),
    ).not.toBeChecked();
  });

  it('reflète la valeur « tous » sur le bon radio', () => {
    render(<ChoixPortee valeur="tous" onChange={vi.fn()} nom="test" />);
    expect(
      screen.getByRole('radio', {
        name: /Toutes les semaines, durablement \(modifie le contrat\)/i,
      }),
    ).toBeChecked();
  });

  it('remonte le changement de portée au clic', () => {
    const onChange = vi.fn();
    render(<ChoixPortee valeur="mois" onChange={onChange} nom="test" />);
    fireEvent.click(
      screen.getByRole('radio', { name: /Toutes les semaines/i }),
    );
    expect(onChange).toHaveBeenCalledWith('tous');
  });

  it('décrit les conséquences du choix durable (aria-describedby)', () => {
    render(<ChoixPortee valeur="mois" onChange={vi.fn()} nom="test" />);
    const radio = screen.getByRole('radio', { name: /Toutes les semaines/i });
    // Le radio engageant porte une description accessible qui annonce les
    // conséquences concrètes (changement hebdomadaire + saisies effacées).
    expect(radio).toHaveAccessibleDescription(
      /chaque semaine.*saisies déjà faites ce mois-ci seront effacées/i,
    );
    // Le choix ponctuel, lui, n'a pas d'avertissement.
    expect(
      screen.getByRole('radio', { name: /Seulement cette fois/i }),
    ).not.toHaveAttribute('aria-describedby');
  });

  it('isole les groupes via le préfixe `nom` (name unique par instance)', () => {
    const { rerender } = render(
      <ChoixPortee valeur="mois" onChange={vi.fn()} nom="creche" />,
    );
    let radio = screen.getByRole('radio', {
      name: /Seulement cette fois/i,
    }) as HTMLInputElement;
    expect(radio.name).toBe('portee-creche');

    rerender(<ChoixPortee valeur="mois" onChange={vi.fn()} nom="abcm" />);
    radio = screen.getByRole('radio', {
      name: /Seulement cette fois/i,
    }) as HTMLInputElement;
    expect(radio.name).toBe('portee-abcm');
  });
});
