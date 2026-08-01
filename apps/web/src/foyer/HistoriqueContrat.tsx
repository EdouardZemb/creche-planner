import { api } from '../api/client';
import { useAsync } from '../hooks/useAsync';
import type { ContratVersionVue, JourSemaine } from '../types/bff';
import {
  dateJourMoisAnneeFr,
  formaterDateHeureFr,
  LIBELLES_JOURS_COURT,
} from '../utils/dates';
import { JOURS_SEMAINE_OUVRES } from './editeursSemaine';
import { Badge } from '../ui/Badge';
import { Spinner } from '../ui/Spinner';
import { Bouton } from '../ui/Bouton';

export interface HistoriqueContratProps {
  contratId: string;
  /** Prénom de l'enfant (en-tête de l'historique). */
  enfant: string;
  onFermer: () => void;
}

/** Jours (courts) portant une plage horaire dans la semaine type crèche. */
function joursCreche(version: ContratVersionVue): string {
  const semaine = version.semaineType;
  if (!semaine) return '—';
  const jours = JOURS_SEMAINE_OUVRES.filter(
    (j) => (semaine[j]?.length ?? 0) > 0,
  );
  return jours.length > 0
    ? jours.map((j) => LIBELLES_JOURS_COURT[j]).join(' ')
    : 'aucun jour';
}

/** Jours (courts) portant au moins une inscription ABCM. */
function joursAbcm(version: ContratVersionVue): string {
  const semaine = version.semaineAbcm;
  if (!semaine) return '—';
  const jours = JOURS_SEMAINE_OUVRES.filter((j: JourSemaine) => {
    const insc = semaine[j];
    return insc !== undefined && Object.keys(insc).length > 0;
  });
  return jours.length > 0
    ? jours.map((j) => LIBELLES_JOURS_COURT[j]).join(' ')
    : 'aucun jour';
}

/** Résumé en langage parent des paramètres d'une version. */
function resumeVersion(version: ContratVersionVue): string {
  if (version.mode === 'CRECHE_PSU') {
    const morceaux = [joursCreche(version)];
    if (version.heuresAnnuellesContractualisees != null) {
      morceaux.push(`${version.heuresAnnuellesContractualisees} h/an`);
    }
    if (version.nbMensualites != null) {
      morceaux.push(`${version.nbMensualites} mensualités`);
    }
    return morceaux.join(' · ');
  }
  return joursAbcm(version);
}

/**
 * Historique **lecture seule** des versions d'un contrat (SFD 30, US-30-04/06). Chaque
 * ligne : « À partir du <date> — <résumé des paramètres> — saisi le <date> », de la plus
 * récente à la plus ancienne (ordre renvoyé par le BFF). La version ouverte (période sans
 * fin) est signalée « en cours ». Aucun jargon (« version »/« avenant » évités à l'écran).
 */
export function HistoriqueContrat({
  contratId,
  enfant,
  onFermer,
}: HistoriqueContratProps) {
  const etat = useAsync(
    (signal) => api.listerVersions(contratId, { signal }),
    [contratId],
  );

  return (
    <div className="carte">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: '0.5rem',
        }}
      >
        <h2 className="mt-0">Historique — {enfant}</h2>
        <Bouton variante="secondaire" onClick={onFermer}>
          Fermer
        </Bouton>
      </div>

      {etat.loading && (
        <div className="muted" aria-live="polite">
          <Spinner />
          <span className="texte-spinner">Chargement de l’historique…</span>
        </div>
      )}

      {etat.error && (
        <div role="alert">
          <p className="texte-erreur">
            Impossible de charger l’historique : {etat.error}
          </p>
          <Bouton
            variante="secondaire"
            onClick={() => {
              etat.reload();
            }}
          >
            Réessayer
          </Bouton>
        </div>
      )}

      {etat.data && etat.data.length === 0 && (
        <p className="muted">Aucun changement enregistré pour ce contrat.</p>
      )}

      {etat.data && etat.data.length > 0 && (
        <ol
          className="liste-nue"
          aria-label={`Changements du contrat de ${enfant}`}
        >
          {etat.data.map((version) => (
            <li key={version.id} className="carte mb-2">
              <div className="historique-version-titre">
                À partir du {dateJourMoisAnneeFr(version.dateEffet)}
                {version.au === null && <Badge>en cours</Badge>}
              </div>
              <div className="muted" style={{ margin: '0.15rem 0' }}>
                {resumeVersion(version)}
              </div>
              <div className="muted" style={{ fontSize: '0.8rem' }}>
                Saisi le {formaterDateHeureFr(version.saisiLe)}
                {version.motif ? ` — ${version.motif}` : ''}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
