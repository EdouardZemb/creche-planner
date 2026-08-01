import { useEffect } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { getFoyerId, setFoyerId, effacerFoyerId } from '../utils/store';
import { seReconnecter } from '../utils/reconnexion';
import { useFoyer } from '../hooks/useFoyer';
import { useTitrePage } from '../hooks/useTitrePage';
import { EtatVide, type ActionEtatVide } from '../ui/EtatVide';

/**
 * EX-01 : garde de route des pages foyer. Charge le foyer ; sur 404 affiche un
 * écran de récupération (« créer un foyer », « revenir à mon foyer »), sur 5xx /
 * réseau un écran « service indisponible » avec « Réessayer ». Sinon rend les
 * pages enfants via <Outlet/>.
 */
export function GardeFoyer() {
  const { foyerId } = useParams<{ foyerId: string }>();
  const { data, error, erreurKind, reload } = useFoyer(foyerId ?? '');

  // Mémorise le foyer actif dès qu'il se charge (URL → localStorage) : la racine
  // « / » et les rechargements retrouvent ainsi le dernier foyer ouvert, même
  // arrivé par lien direct. Symétriquement, on oublie un foyer devenu introuvable
  // — mais seulement si c'est lui qui était mémorisé, pour ne pas effacer un bon
  // foyer pendant qu'on consulte l'URL (404) d'un autre.
  useEffect(() => {
    if (data && foyerId) setFoyerId(foyerId);
  }, [data, foyerId]);
  useEffect(() => {
    if (erreurKind === 'introuvable' && getFoyerId() === foyerId) {
      effacerFoyerId();
    }
  }, [erreurKind, foyerId]);

  if (error && erreurKind === 'introuvable') {
    return <FoyerIntrouvable />;
  }
  if (error && erreurKind === 'session-expiree') {
    return <SessionExpiree />;
  }
  if (error) {
    return <FoyerIndisponible onReessayer={reload} />;
  }
  return <Outlet />;
}

/**
 * Session Cloudflare Access expirée (prod uniquement) : le SW sert encore la
 * coquille mais l'API redirige vers la page de connexion. « Réessayer » serait
 * une impasse — la seule sortie est une vraie navigation réseau (cf.
 * `seReconnecter`), qui déclenche la reconnexion puis revient sur l'app.
 */
export function SessionExpiree() {
  useTitrePage('Session expirée');
  return (
    <EtatVide
      titrePrincipal
      titre="Session expirée"
      description="Votre session de connexion a expiré. Reconnectez-vous pour continuer."
      actions={[
        {
          libelle: 'Se reconnecter',
          onClick: () => void seReconnecter(),
          primaire: true,
        },
      ]}
    />
  );
}

export function FoyerIntrouvable() {
  useTitrePage('Famille introuvable');
  const memorise = getFoyerId();
  const actions: ActionEtatVide[] = [
    {
      libelle: 'Créer une nouvelle famille',
      href: '/foyers/new',
      primaire: true,
    },
  ];
  if (memorise) {
    actions.push({
      libelle: 'Revenir à ma famille',
      href: `/foyers/${memorise}/dashboard`,
    });
  }
  return (
    <EtatVide
      titrePrincipal
      titre="Famille introuvable"
      description="Cette famille n'existe pas ou a été supprimée."
      actions={actions}
    />
  );
}

export function FoyerIndisponible({
  onReessayer,
}: {
  onReessayer: () => void;
}) {
  useTitrePage('Service indisponible');
  return (
    <EtatVide
      titrePrincipal
      titre="Service indisponible"
      description="Impossible de charger cette famille pour le moment. Réessayez dans un instant."
      actions={[{ libelle: 'Réessayer', onClick: onReessayer, primaire: true }]}
    />
  );
}
