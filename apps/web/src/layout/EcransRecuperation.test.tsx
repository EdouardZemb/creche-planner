import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import {
  ApplicationEnErreur,
  ChunkEnErreur,
  PageEnErreur,
} from './EcransRecuperation';

describe('PageEnErreur', () => {
  it('propose une sortie et pose le titre de la page', async () => {
    const reinitialiser = vi.fn();
    render(
      <MemoryRouter>
        <PageEnErreur reinitialiser={reinitialiser} />
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(reinitialiser).toHaveBeenCalledOnce();
    // Le titre alimente l'annonce de route de la coquille (UT-02).
    expect(document.title).toBe('Erreur inattendue — Martha');
  });

  it('renvoie à l’accueil en navigation SPA (la coquille tient encore)', () => {
    render(
      <MemoryRouter>
        <PageEnErreur reinitialiser={vi.fn()} />
      </MemoryRouter>,
    );

    const lien = screen.getByRole('link', { name: 'Revenir à l’accueil' });
    expect(lien).toHaveAttribute('href', '/');
  });
});

describe('ApplicationEnErreur', () => {
  it('recharge réellement la page (réarmer rejouerait le rendu cassé)', async () => {
    const recharger = vi.fn();
    render(
      <MemoryRouter>
        <ApplicationEnErreur recharger={recharger} />
      </MemoryRouter>,
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Recharger la page' }),
    );
    expect(recharger).toHaveBeenCalledOnce();
  });
});

describe('ChunkEnErreur', () => {
  it('nomme ce qui n’a pas pu être chargé et ne propose QUE le rechargement', async () => {
    const recharger = vi.fn();
    render(
      <MemoryRouter>
        <ChunkEnErreur quoi="Le calendrier" recharger={recharger} />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('heading', {
        name: 'Le calendrier n’a pas pu être chargé',
      }),
    ).toBeInTheDocument();
    // Pas de « Réessayer » : `React.lazy` mémorise la promesse rejetée, un
    // nouveau rendu relèverait la même erreur indéfiniment.
    expect(
      screen.queryByRole('button', { name: 'Réessayer' }),
    ).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: 'Recharger la page' }),
    );
    expect(recharger).toHaveBeenCalledOnce();
  });
});
