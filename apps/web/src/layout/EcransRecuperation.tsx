import { useTitrePage } from '../hooks/useTitrePage';
import { EtatVide } from '../ui/EtatVide';

/**
 * Écrans de récupération des frontières d'erreur (lot C7). Même grammaire que les
 * trois écrans de `GardeFoyer` (`EtatVide` titre + description + sorties) : un
 * plantage doit ressembler aux autres impasses de l'app, pas à un écran système.
 *
 * Règle commune : **jamais d'impasse**. Chaque écran offre au moins une sortie,
 * et le libellé dit ce que la sortie fait réellement.
 */

/** Rechargement complet — injectable pour les tests (jsdom ne navigue pas). */
export type Recharger = () => void;

const RECHARGER_DEFAUT: Recharger = () => {
  window.location.reload();
};

/**
 * Frontière de **route** : la page a échoué, la coquille tient. La barre de
 * navigation reste au-dessus (la frontière vit à l'intérieur de `<main>`), donc
 * « Réessayer » peut se contenter de réarmer la frontière — sans rechargement.
 */
export function PageEnErreur({ reinitialiser }: { reinitialiser: () => void }) {
  useTitrePage('Erreur inattendue');
  return (
    <EtatVide
      titrePrincipal
      titre="Cette page n’a pas pu s’afficher"
      description="Un incident inattendu s’est produit. Il a été signalé automatiquement ; vos données ne sont pas perdues."
      actions={[
        { libelle: 'Réessayer', onClick: reinitialiser, primaire: true },
        { libelle: 'Revenir à l’accueil', href: '/' },
      ]}
    />
  );
}

/**
 * Frontière **racine** : la coquille elle-même a échoué (en-tête, session) — il
 * ne reste rien de fiable autour. Les deux sorties sont donc de vraies
 * navigations réseau : réarmer la frontière rejouerait le même rendu cassé, et un
 * `<Link>` SPA ne remonterait rien (le routeur est encore là, mais l'arbre
 * remplacé ne se rerendrait pas).
 */
export function ApplicationEnErreur({
  recharger = RECHARGER_DEFAUT,
}: {
  recharger?: Recharger;
}) {
  useTitrePage('Application indisponible');
  return (
    <EtatVide
      titrePrincipal
      titre="L’application n’a pas pu démarrer"
      description="Un incident inattendu s’est produit au chargement. Il a été signalé automatiquement. Rechargez la page pour repartir."
      actions={[
        { libelle: 'Recharger la page', onClick: recharger, primaire: true },
        { libelle: 'Revenir à l’accueil', href: '/', rechargement: true },
      ]}
    />
  );
}

/**
 * Frontière de **chunk** : un module chargé à la demande (`lazy()`) n'est pas
 * arrivé — réseau coupé au mauvais moment, ou fichier disparu après un
 * déploiement. Mode de défaillance distinct d'une exception de rendu, d'où un
 * écran distinct.
 *
 * ⚠️ **Pas de « Réessayer » ici, et c'est délibéré** : `React.lazy` mémorise la
 * promesse REJETÉE ; un nouveau rendu du même composant relève la même erreur
 * indéfiniment. Seul un rechargement complet reconstruit le cache de modules.
 */
export function ChunkEnErreur({
  quoi,
  recharger = RECHARGER_DEFAUT,
}: {
  quoi: string;
  recharger?: Recharger;
}) {
  return (
    <EtatVide
      titre={`${quoi} n’a pas pu être chargé`}
      description="La connexion a peut-être été interrompue. Rechargez la page pour réessayer."
      actions={[
        { libelle: 'Recharger la page', onClick: recharger, primaire: true },
      ]}
    />
  );
}
