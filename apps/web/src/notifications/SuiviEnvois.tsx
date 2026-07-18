import { api } from '../api/client';
import type {
  SuiviEnvois as SuiviEnvoisVue,
  SuiviEnvoiEtablissement,
  SuiviRappelHebdo,
} from '../types/bff';
import { useAsync } from '../hooks/useAsync';
import { formaterDateHeureFr } from '../utils/dates';

/**
 * Ligne « rappel hebdo aux parents » selon le statut **persistant** du slot
 * `envoi_recap_hebdo`. Le nombre de parents vient du détail par parent
 * (`envoi_recap_parent`). Libellés en mots de parent (aucun jargon de statut).
 */
function libelleRappel(rappel: SuiviRappelHebdo): string {
  const n = rappel.parents.length;
  switch (rappel.statut) {
    case 'A_ENVOYER':
      return 'Rappel hebdo : envoi prévu mardi.';
    case 'ENVOYE':
      return rappel.envoyeLe
        ? `Rappel envoyé le ${formaterDateHeureFr(rappel.envoyeLe)} (${String(n)} parent(s)).`
        : `Rappel envoyé (${String(n)} parent(s)).`;
    case 'DRY_RUN':
      return 'Rappel en mode test : aucun e-mail réellement envoyé.';
    case 'ECHEC':
      return 'Échec de l’envoi du rappel — nouvelle tentative automatique prévue.';
    case 'ABANDONNE':
      return 'Rappel non envoyé (fenêtre close). Pensez à vérifier votre semaine dans le planning.';
  }
}

/** Ligne « récap envoyé à un établissement » selon le statut de `envoi_etablissement`. */
function libelleEtablissement(e: SuiviEnvoiEtablissement): string {
  const dest = e.destinataire ?? 'l’établissement';
  switch (e.statut) {
    case 'ENVOYE':
      return e.envoyeLe
        ? `Récapitulatif envoyé à ${dest} le ${formaterDateHeureFr(e.envoyeLe)}.`
        : `Récapitulatif envoyé à ${dest}.`;
    case 'ECHEC':
      return `Échec de l’envoi du récapitulatif : ${e.erreur ?? 'erreur inconnue'}.`;
    case 'DRY_RUN':
      return 'Récapitulatif en mode test (aucun e-mail envoyé).';
    case 'EN_COURS':
      return 'Envoi du récapitulatif en cours…';
  }
}

/** Une ligne du suivi (clé stable + texte). */
interface LigneSuivi {
  cle: string;
  texte: string;
}

function lignes(suivi: SuiviEnvoisVue): LigneSuivi[] {
  const out: LigneSuivi[] = [];
  if (suivi.rappel !== null) {
    out.push({ cle: 'rappel', texte: libelleRappel(suivi.rappel) });
  }
  for (const e of suivi.etablissements) {
    out.push({ cle: e.etablissementId, texte: libelleEtablissement(e) });
  }
  return out;
}

/**
 * Bloc « Suivi des envois » (B1) : rend **persistant et consultable** le statut d'envoi
 * du récap hebdo (rappel aux parents + récaps aux établissements) pour une
 * `(foyer, semaine)`. La donnée existait déjà en base ; jusqu'ici le résultat d'envoi ne
 * vivait que dans l'état React de la relecture, perdu au reload. Lecture seule via
 * `api.lireSuiviEnvois`. `version` : incrémenté par le parent (ex. après une validation)
 * pour re-lire le suivi sans recharger la page (le cache `useAsync` n'a pas de clé ici →
 * chaque changement de dépendance relance la requête).
 *
 * Bloc **secondaire** : un échec de lecture affiche une simple ligne discrète (pas de
 * bouton), et rien ne s'affiche tant qu'il n'y a aucun fait à montrer.
 */
export function SuiviEnvois({
  foyerId,
  semaineIso,
  version = 0,
}: {
  foyerId: string;
  semaineIso: string;
  version?: number;
}) {
  const { data, error } = useAsync(
    (signal) => api.lireSuiviEnvois(foyerId, semaineIso, { signal }),
    [foyerId, semaineIso, version],
  );

  if (error !== null) {
    return (
      <p className="muted" role="status" style={{ margin: 'var(--esp-3) 0 0' }}>
        Suivi des envois indisponible.
      </p>
    );
  }

  // Chargement initial (pas d'erreur, pas encore de données) : rien à afficher
  // (bloc secondaire, on n'introduit pas de spinner).
  if (data === null) {
    return null;
  }

  const items = lignes(data);
  if (items.length === 0) {
    return null;
  }

  return (
    <div
      className="suivi-envois"
      role="status"
      style={{ marginTop: 'var(--esp-3)' }}
    >
      <h4 style={{ margin: '0 0 var(--esp-1)', fontSize: 'var(--h4, 1rem)' }}>
        Suivi des envois
      </h4>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {items.map((l) => (
          <li key={l.cle} className="muted">
            {l.texte}
          </li>
        ))}
      </ul>
    </div>
  );
}
