import { useTitrePage } from '../hooks/useTitrePage';
import { EtatVide } from '../ui/EtatVide';

/** EX-03 : vraie page 404 avec des sorties explicites (pas de redirection muette). */
export function PageIntrouvable() {
  useTitrePage('Page introuvable');
  return (
    <EtatVide
      titrePrincipal
      titre="Page introuvable"
      description="La page demandée n'existe pas ou l'adresse est incorrecte."
      actions={[
        { libelle: 'Accueil', href: '/', primaire: true },
        { libelle: 'Nouvelle famille', href: '/foyers/new' },
      ]}
    />
  );
}
