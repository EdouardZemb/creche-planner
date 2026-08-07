import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FrontiereErreur } from './FrontiereErreur';
import { PageEnErreur } from './EcransRecuperation';
import { reinitialiserRemonteeErreurs } from '../api/signalerErreur';

/**
 * React journalise en console toute erreur interceptée par une frontière
 * (`onCaughtError`). C'est le comportement attendu ici : on le tait pour ne pas
 * noyer la sortie des tests, sans masquer autre chose.
 */
function taireConsole() {
  return vi.spyOn(console, 'error').mockImplementation(() => undefined);
}

function Explose({ quand = true }: { quand?: boolean }) {
  if (quand) throw new Error('rendu impossible');
  return <p>contenu sain</p>;
}

describe('FrontiereErreur', () => {
  let console_: ReturnType<typeof taireConsole>;

  beforeEach(() => {
    reinitialiserRemonteeErreurs();
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 204,
      }),
    );
    console_ = taireConsole();
  });

  afterEach(() => {
    console_.mockRestore();
    vi.restoreAllMocks();
  });

  it('rend ses enfants quand rien ne plante', () => {
    render(
      <FrontiereErreur origine="route" rendu={() => <p>repli</p>}>
        <Explose quand={false} />
      </FrontiereErreur>,
    );

    expect(screen.getByText('contenu sain')).toBeInTheDocument();
    expect(screen.queryByText('repli')).not.toBeInTheDocument();
  });

  it('intercepte l’exception de rendu et affiche l’écran de récupération', () => {
    render(
      <MemoryRouter>
        <FrontiereErreur
          origine="route"
          rendu={({ reinitialiser }) => (
            <PageEnErreur reinitialiser={reinitialiser} />
          )}
        >
          <Explose />
        </FrontiereErreur>
      </MemoryRouter>,
    );

    // Le défaut fermé par C7 : sans frontière, l'arbre entier disparaît (#root vide).
    expect(
      screen.getByRole('heading', { level: 1, name: /n’a pas pu s’afficher/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Réessayer' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Revenir à l’accueil' }),
    ).toBeInTheDocument();
  });

  it('remonte le plantage avec son origine, sa route et sa pile de composants', () => {
    render(
      <FrontiereErreur origine="application" rendu={() => <p>repli</p>}>
        <Explose />
      </FrontiereErreur>,
    );

    const init = vi.mocked(globalThis.fetch).mock.calls[0]?.[1];
    const corps = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(corps['origine']).toBe('application');
    expect(corps['message']).toBe('rendu impossible');
    expect(corps['route']).toBe(window.location.pathname);
    expect(String(corps['composant'])).toContain('Explose');
  });

  it('« Réessayer » réarme la frontière (le contenu revient s’il est réparé)', async () => {
    const utilisateur = userEvent.setup();

    function Ecran() {
      const [casse, setCasse] = useState(true);
      return (
        <MemoryRouter>
          <button
            type="button"
            onClick={() => {
              setCasse(false);
            }}
          >
            réparer
          </button>
          <FrontiereErreur
            origine="route"
            rendu={({ reinitialiser }) => (
              <PageEnErreur reinitialiser={reinitialiser} />
            )}
          >
            <Explose quand={casse} />
          </FrontiereErreur>
        </MemoryRouter>
      );
    }

    render(<Ecran />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();

    await utilisateur.click(screen.getByRole('button', { name: 'réparer' }));
    await utilisateur.click(screen.getByRole('button', { name: 'Réessayer' }));

    expect(screen.getByText('contenu sain')).toBeInTheDocument();
  });

  it('se réarme quand une clé change (navigation) — sinon l’écran colle', () => {
    const { rerender } = render(
      <FrontiereErreur
        origine="route"
        clesReinitialisation={['/planning']}
        rendu={() => <p>repli</p>}
      >
        <Explose />
      </FrontiereErreur>,
    );
    expect(screen.getByText('repli')).toBeInTheDocument();

    // Même frontière, nouvelle route : elle doit retenter le rendu.
    rerender(
      <FrontiereErreur
        origine="route"
        clesReinitialisation={['/couts']}
        rendu={() => <p>repli</p>}
      >
        <Explose quand={false} />
      </FrontiereErreur>,
    );

    expect(screen.getByText('contenu sain')).toBeInTheDocument();
    expect(screen.queryByText('repli')).not.toBeInTheDocument();
  });

  it('ne se réarme PAS quand les clés sont inchangées', () => {
    const { rerender } = render(
      <FrontiereErreur
        origine="route"
        clesReinitialisation={['/planning']}
        rendu={() => <p>repli</p>}
      >
        <Explose />
      </FrontiereErreur>,
    );

    rerender(
      <FrontiereErreur
        origine="route"
        clesReinitialisation={['/planning']}
        rendu={() => <p>repli</p>}
      >
        <Explose quand={false} />
      </FrontiereErreur>,
    );

    expect(screen.getByText('repli')).toBeInTheDocument();
  });

  it('normalise une valeur levée qui n’est pas une Error', () => {
    function ExploseChaine(): never {
      throw 'juste une chaîne';
    }

    render(
      <FrontiereErreur
        origine="route"
        rendu={({ erreur }) => <p>{erreur.message}</p>}
      >
        <ExploseChaine />
      </FrontiereErreur>,
    );

    expect(screen.getByText('juste une chaîne')).toBeInTheDocument();
  });
});
