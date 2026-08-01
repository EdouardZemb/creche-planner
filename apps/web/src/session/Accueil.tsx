import { Navigate } from 'react-router-dom';
import { api } from '../api/client';
import type { FoyerVue } from '../types/bff';
import { useAsync } from '../hooks/useAsync';
import { getFoyerId } from '../utils/store';
import { ChargementPage } from '../ui/ChargementPage';
import { useMoi } from './MoiContext';

export function Accueil() {
  const moi = useMoi();
  if (moi.loading) {
    return <ChargementPage message="Chargement de votre session…" />;
  }

  // Mode BORNÉ : identité connue (Cloudflare Access B1 / en-tête de dev). Le foyer
  // découle de l'ensemble autorisé `moi.foyers`, plus d'un id localStorage forgeable.
  if (moi.email !== null) {
    // localStorage rétrogradé en simple cache : suivi UNIQUEMENT s'il appartient
    // à l'ensemble autorisé (sinon ignoré — ce n'est plus une source de vérité).
    const cache = getFoyerId();
    if (cache && moi.foyers.includes(cache)) {
      return <Navigate to={`/foyers/${cache}/dashboard`} replace />;
    }
    if (moi.foyers.length === 1) {
      return <Navigate to={`/foyers/${moi.foyers[0]}/dashboard`} replace />;
    }
    // 0 foyer (contactez l'admin) ou N foyers (sélecteur) : page dédiée.
    return <Navigate to="/mes-foyers" replace />;
  }

  // Mode HÉRITÉ : aucune identité (prod `GATEWAY_AUTH_DISABLED=1` sans Cloudflare,
  // ou dev sans en-tête). Comportement historique : cache localStorage puis
  // découverte serveur — la prod actuelle reste inchangée.
  const id = getFoyerId();
  if (id) {
    return <Navigate to={`/foyers/${id}/dashboard`} replace />;
  }
  return <AccueilDecouverte />;
}

/**
 * Aucun foyer mémorisé (première visite, autre navigateur, stockage effacé) :
 * avant de proposer la création, on demande au serveur les foyers déjà
 * configurés (GET /api/v1/foyers). S'il en existe, on ouvre le premier créé sur
 * son tableau de bord « Aujourd'hui » — l'app gère un foyer de référence unique —
 * et GardeFoyer le mémorisera dès son chargement. Liste vide ou erreur réseau →
 * formulaire de création (comportement historique : la découverte ne bloque
 * jamais l'accueil).
 */
function AccueilDecouverte() {
  const { data, loading } = useAsync<FoyerVue[]>(
    (signal) => api.listerFoyers({ signal }),
    [],
  );
  if (loading) {
    return <ChargementPage message="Recherche d’une famille existante…" />;
  }
  const premier = data?.[0];
  return (
    <Navigate
      to={premier ? `/foyers/${premier.id}/dashboard` : '/foyers/new'}
      replace
    />
  );
}
