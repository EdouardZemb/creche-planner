import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { LegendePlanning } from './LegendePlanning';

describe('LegendePlanning', () => {
  it('expose un groupe nommé pour la légende (nom accessible)', () => {
    render(
      <LegendePlanning
        couleurGarde="#123456"
        libelleGarde="Gardé (contrat)"
        ecartJours={0}
      />,
    );
    expect(
      screen.getByRole('group', { name: /Légende du calendrier/i }),
    ).toBeInTheDocument();
  });

  it('rend les libellés de légende en texte (pas seulement la couleur)', () => {
    render(
      <LegendePlanning
        couleurGarde="#123456"
        libelleGarde="Cantine (contrat)"
        ecartJours={0}
      />,
    );
    expect(screen.getByText('Cantine (contrat)')).toBeInTheDocument();
    expect(screen.getByText('Ajouté')).toBeInTheDocument();
    expect(screen.getByText('Retiré / absent')).toBeInTheDocument();
  });

  it('annonce un écart nul comme « conforme au contrat »', () => {
    render(
      <LegendePlanning
        couleurGarde="#123456"
        libelleGarde="Gardé"
        ecartJours={0}
      />,
    );
    expect(
      screen.getByText(/Écart : conforme au contrat/i),
    ).toBeInTheDocument();
  });

  it('accorde le pluriel et le signe de l écart (lisible par lecteur d écran)', () => {
    const { rerender } = render(
      <LegendePlanning
        couleurGarde="#123456"
        libelleGarde="Gardé"
        ecartJours={1}
      />,
    );
    expect(
      screen.getByText(/Écart : \+1 jour vs contrat/i),
    ).toBeInTheDocument();

    rerender(
      <LegendePlanning
        couleurGarde="#123456"
        libelleGarde="Gardé"
        ecartJours={-2}
      />,
    );
    expect(
      screen.getByText(/Écart : -2 jours vs contrat/i),
    ).toBeInTheDocument();
  });
});
