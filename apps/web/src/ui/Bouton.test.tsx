import { createRef } from 'react';
import type { FormEvent } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { Bouton, BoutonLien, classeBouton } from './Bouton';

describe('Bouton', () => {
  it('émet les classes littérales attendues par la cascade, variante par variante', () => {
    // Ces classes sont load-bearing : `.carte-contrat-actions .btn` &co posent
    // width:100% en mobile, et les états :disabled sont déclinés par variante.
    expect(classeBouton('primaire')).toBe('btn');
    expect(classeBouton('secondaire')).toBe('btn secondaire');
    expect(classeBouton('danger')).toBe('btn danger');
    expect(classeBouton('danger-contour')).toBe('btn danger contour');
    expect(classeBouton()).toBe('btn');
  });

  it('concatène les classes de contexte sans écraser la variante', () => {
    render(
      <Bouton variante="secondaire" className="no-print">
        Imprimer
      </Bouton>,
    );
    const el = screen.getByRole('button', { name: 'Imprimer' });
    expect(el).toHaveClass('btn', 'secondaire', 'no-print');
  });

  it('vaut type="button" par défaut (le défaut HTML submit soumettrait le formulaire hôte)', () => {
    const onSubmit = vi.fn((e: FormEvent) => {
      e.preventDefault();
    });
    render(
      <form onSubmit={onSubmit}>
        <Bouton>Action</Bouton>
      </form>,
    );
    expect(screen.getByRole('button', { name: 'Action' })).toHaveAttribute(
      'type',
      'button',
    );
  });

  it('laisse passer type="submit" quand il est demandé', () => {
    render(<Bouton type="submit">Enregistrer</Bouton>);
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toHaveAttribute(
      'type',
      'submit',
    );
  });

  it('désactive par l’attribut DOM disabled (le piège Tab des modales filtre dessus)', () => {
    render(<Bouton disabled>Valider</Bouton>);
    const el = screen.getByRole('button', { name: 'Valider' });
    expect(el).toBeDisabled();
    // Un aria-disabled laisserait le bouton tabulable dans une <Modale>.
    expect(el).not.toHaveAttribute('aria-disabled');
  });

  it('expose la ref du <button> DOM réel (focus initial des modales)', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Bouton ref={ref}>Annuler</Bouton>);
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Annuler' }));
    ref.current?.focus();
    expect(ref.current).toHaveFocus();
  });

  it('transmet les attributs ARIA et le gestionnaire de clic', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Bouton
        aria-label="Supprimer le contrat de Mia"
        aria-expanded
        onClick={onClick}
      >
        ✕
      </Bouton>,
    );
    const el = screen.getByRole('button', {
      name: 'Supprimer le contrat de Mia',
    });
    expect(el).toHaveAttribute('aria-expanded', 'true');
    await user.click(el);
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('BoutonLien', () => {
  it('rend une transition SPA pour une destination interne', () => {
    render(
      <MemoryRouter>
        <BoutonLien to="/foyers/f1/planning" variante="secondaire">
          Voir le planning
        </BoutonLien>
      </MemoryRouter>,
    );
    const el = screen.getByRole('link', { name: 'Voir le planning' });
    expect(el).toHaveAttribute('href', '/foyers/f1/planning');
    expect(el).toHaveClass('btn', 'secondaire');
  });

  it('rend un <a href> quand un rechargement complet est exigé', () => {
    // Reconnexion Cloudflare Access : une navigation SPA laisserait une session
    // morte. Le repli doit rester un vrai aller-retour réseau.
    render(
      <MemoryRouter>
        <BoutonLien to="/moi" rechargement>
          Se reconnecter
        </BoutonLien>
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('link', { name: 'Se reconnecter' }),
    ).toHaveAttribute('href', '/moi');
  });

  it('rend un <a href> pour une destination externe', () => {
    render(
      <MemoryRouter>
        <BoutonLien to="https://exemple.fr">Aide</BoutonLien>
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Aide' })).toHaveAttribute(
      'href',
      'https://exemple.fr',
    );
  });
});
