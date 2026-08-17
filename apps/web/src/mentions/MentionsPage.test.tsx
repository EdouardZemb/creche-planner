import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import { MentionsPage } from './MentionsPage';

function afficher() {
  return render(
    <MemoryRouter initialEntries={['/mentions']}>
      <MentionsPage />
    </MemoryRouter>,
  );
}

describe('MentionsPage', () => {
  it('page publique : aucun appel réseau, aucun contexte de foyer requis', () => {
    // Rendue nue (hors `Coquille`, hors `GardeFoyer`) : c'est la garantie qu'un
    // agent d'établissement arrivant depuis un courriel — sans compte ni foyer —
    // obtient bien la page.
    afficher();
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Informations sur vos données',
      }),
    ).toBeInTheDocument();
    expect(document.title).toBe('Informations sur vos données — Martha');
  });

  it('énonce les catégories de données conservées', () => {
    afficher();
    expect(screen.getByText(/revenu fiscal de référence/i)).toBeInTheDocument();
    expect(screen.getByText(/date de naissance/i)).toBeInTheDocument();
    expect(screen.getByText(/e-mail de service/i)).toBeInTheDocument();
  });

  it('reprend les durées du registre (3 ans / 13 mois / 12 mois) SANS les promettre appliquées', () => {
    afficher();
    expect(screen.getByText('trois ans')).toBeInTheDocument();
    expect(screen.getByText('treize mois')).toBeInTheDocument();
    expect(screen.getByText('douze mois')).toBeInTheDocument();
    // Doc 37 § 3 : ce sont des objectifs de gestion, aucune purge liée au temps
    // n'est outillée — le lot 2 a livré l'effacement À LA DEMANDE, pas
    // l'expiration. Écrire « vos données sont supprimées au bout de… » resterait
    // un mensonge tant que la borne temporelle n'existe pas.
    expect(
      screen.getByText(/rien ne s’efface tout seul à l’échéance/i),
    ).toBeInTheDocument();
  });

  it('nomme les tiers par leur rôle (courriels, tunnel d’accès, sauvegardes chiffrées)', () => {
    afficher();
    expect(screen.getByText(/acheminement des courriels/i)).toBeInTheDocument();
    expect(screen.getByText(/tunnel d’accès/i)).toBeInTheDocument();
    // La sauvegarde hors-site est le seul tiers qui ne voit RIEN en clair : la
    // page doit le dire, sinon elle met tous les tiers sur le même plan.
    expect(
      screen.getByText(/chiffrée avant d’être envoyée/i),
    ).toBeInTheDocument();
  });

  it('ne propose que le droit réellement outillé, et renvoie vers « Mon profil »', () => {
    afficher();
    expect(screen.getByText(/lien de désabonnement/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mon profil' })).toHaveAttribute(
      'href',
      '/mon-profil',
    );
  });

  it('annonce l’effacement livré, en nommant l’écran qui le porte', () => {
    afficher();
    // Le lot 2 a livré le geste d'ensemble : la page doit le dire, et dire OÙ.
    // Une page qui décrirait un droit sans son chemin d'accès ne sert personne.
    expect(screen.getByText(/Effacer cette famille/i)).toBeInTheDocument();
    expect(screen.getByText(/Ma famille/i)).toBeInTheDocument();
    // Le point qui change vraiment pour une personne concernée : un parent
    // retiré laissait jusqu'ici son nom et son e-mail en base (`actif = false`).
    expect(
      screen.getByText(/parents précédemment retirés/i),
    ).toBeInTheDocument();
  });

  // Le lot 3 a rendu vraie une phrase qui disait le contraire. La page annonce
  // désormais l'export — et, symétriquement, ce qu'il ne rend PAS : une page qui
  // promettrait « toutes vos données » en taisant ses exclusions serait fausse
  // d'une façon plus coûteuse que l'ancienne, qui ne promettait rien.
  it('annonce l’export ET ses deux exclusions', () => {
    afficher();
    expect(screen.getByText(/Télécharger\s+mes données/i)).toBeInTheDocument();
    expect(screen.getByText('copies')).toBeInTheDocument();
    expect(screen.getByText(/jetons\s+secrets/i)).toBeInTheDocument();
  });

  it('n’annonce plus l’absence d’export', () => {
    afficher();
    expect(screen.queryByText(/toujours pas d’export/i)).toBeNull();
  });

  it('adresse une phrase à l’agent d’établissement venu d’un courriel', () => {
    afficher();
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: /Vous recevez le récapitulatif d’une famille/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/aucun compte à créer/i)).toBeInTheDocument();
  });

  it('renvoie au registre pour le détail (elle ne le recopie pas)', () => {
    afficher();
    const lien = screen.getByRole('link', {
      name: /registre des traitements/i,
    });
    expect(lien.getAttribute('href')).toContain(
      'docs/37-registre-des-traitements.md',
    );
  });

  it('ne revendique AUCUNE conformité (ADR-0007 : exemption domestique assumée)', () => {
    // Garde-fou éditorial : la décision du 2026-08-11 est que le dépôt ne
    // revendique pas la conformité au RGPD. Un ajout bien intentionné de
    // « conformément au RGPD » / « vos droits RGPD » contredirait l'ADR — et
    // relire un texte long ne le rattrape pas de façon fiable.
    afficher();
    const texte = document.body.textContent ?? '';
    expect(texte).not.toMatch(/RGPD/i);
    expect(texte).not.toMatch(/conform/i);
    expect(texte).not.toMatch(/responsable de traitement/i);
    expect(texte).not.toMatch(/sous-traitant/i);
  });
});
