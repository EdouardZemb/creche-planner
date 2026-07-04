import { Link, useParams } from 'react-router-dom';
import {
  jourCourantParis,
  semaineIsoDeDate,
} from '@creche-planner/shared-semaine';
import type { CoutMoisVue, SemaineBesoins } from '../types/bff';
import {
  couleurAjoute,
  couleurAjuste,
  couleurRetire,
} from '../planning/couleursPlanning';
import { couleurDuMode } from '../utils/couleurs';
import { libelleMode } from '../utils/libelles';
import {
  formaterDateFr,
  formaterMoisFr,
  libelleSemaine,
  LIBELLES_JOURS,
  jourSemaineDeIso,
} from '../utils/dates';
import { centimesEnEuros } from '../utils/money';
import { useAsync } from '../hooks/useAsync';
import { useTitrePage } from '../hooks/useTitrePage';
import { useNotifications } from '../notifications/useNotifications';
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
 * Carte « semaine à valider » (UX dashboard, lot 1) : rend le geste hebdomadaire
 * critique — valider le planning notifié le mardi — visible sur la porte d'entrée
 * de l'app, jusqu'ici signalé par la seule pastille du menu. Panneau indicateur
 * uniquement : la validation elle-même reste dans l'`EncartValidation` du
 * planning, vers lequel la carte renvoie. Plusieurs contrats peuvent partager une
 * même semaine notifiée → on dédoublonne par semaine (le détail par enfant vit
 * sur le planning). Silencieuse tant qu'il n'y a rien à valider (chargement,
 * erreur, liste vide) : c'est un rappel, jamais un obstacle à la journée.
 */
function CarteAValider({ foyerId }: { foyerId: string }) {
  const { data } = useNotifications(foyerId);
  const semaines = [...new Set((data ?? []).map((n) => n.semaineIso))].sort();
  if (semaines.length === 0) {
    return null;
  }
  return (
    <section
      className="carte"
      aria-label="Planning à valider"
      // Même accent que l'encart de validation du planning : un seul langage
      // visuel pour une même tâche, d'un écran à l'autre.
      style={{ borderLeft: '4px solid var(--bleu)' }}
    >
      <h2 style={{ marginTop: 0, fontSize: 'var(--h2)' }}>
        {semaines.length > 1 ? 'Semaines à valider' : 'Semaine à valider'}
      </h2>
      {semaines.length === 1 ? (
        <p style={{ margin: '0 0 0.75rem' }}>
          La {libelleSemaine(semaines[0] ?? '')} attend votre validation.
        </p>
      ) : (
        <>
          <p style={{ margin: '0 0 0.25rem' }}>
            Ces semaines attendent votre validation :
          </p>
          <ul style={{ margin: '0 0 0.75rem', paddingLeft: '1.25rem' }}>
            {semaines.map((s) => (
              <li key={s}>{libelleSemaine(s)}</li>
            ))}
          </ul>
        </>
      )}
      <Link to={`/foyers/${foyerId}/planning`} className="btn">
        Vérifier et valider
      </Link>
    </section>
  );
}

/**
 * Bandeau « coût du mois » (P3c) : le coût RÉEL (`simule=false`) du mois courant,
 * en lecture seule, avec un lien vers le détail des coûts. Secondaire et
 * non-bloquant — s'efface silencieusement tant qu'il charge ou s'il échoue, pour
 * ne jamais masquer la journée. Réutilise le client `lireCoutMois` et le
 * formatage `centimesEnEuros` (mêmes conventions que le planning / les coûts).
 */
function BandeauCoutMois({ foyerId, mois }: { foyerId: string; mois: string }) {
  const { data } = useAsync<CoutMoisVue>(
    (signal) => api.lireCoutMois(foyerId, mois, false, { signal }),
    [foyerId, mois],
  );
  if (!data) {
    return null;
  }
  return (
    <div
      className="carte"
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: '0.75rem',
        flexWrap: 'wrap',
      }}
    >
      <span>
        Coût de <strong>{formaterMoisFr(mois)}</strong>
      </span>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem' }}>
        <strong style={{ fontSize: '1.1rem' }}>
          {centimesEnEuros(data.totalCentimes)}
        </strong>
        <Link to={`/foyers/${foyerId}/couts`} className="btn secondaire">
          Détail
        </Link>
      </span>
    </div>
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

      {/* Lot 1 UX : la semaine à valider d'abord — c'est LE geste attendu du
          parent quand elle existe ; le reste de la journée vient après. */}
      <CarteAValider foyerId={id} />

      {/* P3c : coût réel du mois courant, indépendant des gardes du jour →
          toujours rendu (hors états loading/erreur de la journée). */}
      <BandeauCoutMois foyerId={id} mois={mois} />

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
