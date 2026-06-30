import { Link, useParams } from 'react-router-dom';
import {
  jourCourantParis,
  semaineIsoDeDate,
} from '@creche-planner/shared-semaine';
import type { SemaineBesoins } from '../types/bff';
import {
  couleurAjoute,
  couleurAjuste,
  couleurRetire,
} from '../planning/couleursPlanning';
import { couleurDuMode } from '../utils/couleurs';
import { libelleMode } from '../utils/libelles';
import {
  formaterDateFr,
  LIBELLES_JOURS,
  jourSemaineDeIso,
} from '../utils/dates';
import { useAsync } from '../hooks/useAsync';
import { useTitrePage } from '../hooks/useTitrePage';
import { api } from '../api/client';
import { lignesDuJour, type EtatJour, type LigneJour } from './jourFoyer';

/** Libellé lisible d'un état du jour (la couche pure renvoie un jeton stable). */
const LIBELLES_ETAT: Readonly<Record<EtatJour, string>> = {
  garde: 'Gardé',
  absent: 'Absent',
  'depart-avance': 'Départ avancé',
  'arrivee-retardee': 'Arrivée retardée',
  ajuste: 'Ajusté',
  'jour-ajoute': 'Jour ajouté',
  cantine: 'Cantine',
  peri: 'Périscolaire',
  alsh: 'ALSH',
};

/**
 * Couleur de la pastille d'un état : déviations via la palette du planning
 * (vert ajouté / ambre ajusté / rouge absent), présence normale via la couleur
 * du mode — même langage visuel que le calendrier.
 */
function couleurEtat(ligne: LigneJour): string {
  switch (ligne.etat) {
    case 'absent':
      return couleurRetire();
    case 'depart-avance':
    case 'arrivee-retardee':
    case 'ajuste':
      return couleurAjuste();
    case 'jour-ajoute':
      return couleurAjoute();
    default:
      return couleurDuMode(ligne.mode);
  }
}

/** Une ligne de garde du jour : pastille colorée, enfant + mode, horaire, action. */
function RangeeJour({
  ligne,
  foyerId,
  mois,
}: {
  ligne: LigneJour;
  foyerId: string;
  mois: string;
}) {
  const etat = LIBELLES_ETAT[ligne.etat];
  // Deep-link (P3a) : « Modifier » ouvre le planning directement sur l'onglet
  // enfant + le sous-onglet mode de CETTE garde, au mois affiché — au lieu du
  // planning générique. `enfant`/`mode`/`mois` sont exactement les paramètres
  // d'URL que lit `PlanningPage` (l'URL est sa source de vérité de sélection).
  const cible = `/foyers/${foyerId}/planning?${new URLSearchParams({
    enfant: ligne.enfant,
    mode: ligne.mode,
    mois,
  }).toString()}`;
  return (
    <li className="jour-rangee">
      <span
        aria-hidden="true"
        style={{
          width: '0.8rem',
          height: '0.8rem',
          borderRadius: '0.2rem',
          backgroundColor: couleurEtat(ligne),
          display: 'inline-block',
        }}
      />
      <span>
        <strong>{ligne.enfant}</strong> — {libelleMode(ligne.mode)}
        {ligne.etablissementLibelle !== null && (
          <span className="muted"> · {ligne.etablissementLibelle}</span>
        )}
        <br />
        <span className="muted">
          {etat}
          {ligne.horaire !== null && ` · ${ligne.horaire}`}
        </span>
      </span>
      <Link
        to={cible}
        className="btn secondaire"
        aria-label={`Modifier la garde de ${ligne.enfant}`}
      >
        Modifier
      </Link>
    </li>
  );
}

/**
 * Tableau de bord « ma journée » : les gardes prévues **aujourd'hui** (fuseau
 * Europe/Paris) pour le foyer, dérivées de la vue hebdomadaire consolidée
 * (`lireSemaineBesoins`) par la logique pure `lignesDuJour`. Per-foyer (route
 * `/foyers/:foyerId/dashboard`, sous `GardeFoyer`) : chaque ligne renvoie au
 * planning pour ajuster. Vue en lecture seule, point d'entrée du quotidien.
 */
export function DashboardJourPage() {
  useTitrePage('Aujourd’hui');
  const { foyerId } = useParams<{ foyerId: string }>();
  const id = foyerId ?? '';

  // Date du jour normalisée en Europe/Paris (la convention métier), puis la
  // semaine ISO qui la contient — clés stables pour `useAsync` sur la journée.
  const aujourdhui = jourCourantParis(new Date());
  const semaine = semaineIsoDeDate(aujourdhui);
  // Mois (`YYYY-MM`) du jour affiché : porté tel quel au planning par le
  // deep-link « Modifier » (P3a), pour atterrir sur le bon mois calendaire.
  const mois = aujourdhui.slice(0, 7);

  const { data, loading, error, reload } = useAsync<SemaineBesoins>(
    (signal) => api.lireSemaineBesoins(id, semaine, { signal }),
    [id, semaine],
  );

  const jour = jourSemaineDeIso(aujourdhui);
  const lignes = data ? lignesDuJour(data, aujourdhui) : [];

  return (
    <div>
      <h1 style={{ marginBottom: '0.25rem' }}>Aujourd’hui</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {LIBELLES_JOURS[jour]} {formaterDateFr(aujourdhui)}
      </p>

      {loading && !data && (
        <div className="carte muted" aria-live="polite">
          Chargement de votre journée…
        </div>
      )}

      {!loading && error && !data && (
        <div className="carte" role="alert">
          <p style={{ color: 'var(--rouge)', margin: '0 0 0.5rem' }}>{error}</p>
          <button type="button" className="btn secondaire" onClick={reload}>
            Réessayer
          </button>
        </div>
      )}

      {data && lignes.length > 0 && (
        <ul className="jours-liste">
          {lignes.map((ligne) => (
            <RangeeJour
              key={ligne.contratId}
              ligne={ligne}
              foyerId={id}
              mois={mois}
            />
          ))}
        </ul>
      )}

      {data && lignes.length === 0 && (
        <div className="carte muted">
          <p style={{ margin: '0 0 0.5rem' }}>
            Aucune garde prévue aujourd’hui.
          </p>
          <Link to={`/foyers/${id}/planning`} className="btn secondaire">
            Voir le planning
          </Link>
        </div>
      )}
    </div>
  );
}
