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
  jourSuivant,
  libelleDate,
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

/**
 * Libellé lisible d'un état du jour (la couche pure renvoie un jeton stable).
 * Mots de PARENT, volontairement locaux à cet écran (le planning garde les
 * siens) : « Ajusté » (jargon) devient « Horaires modifiés », « ALSH » est
 * explicité en cohérence avec le glossaire (`utils/glossaire.ts`).
 */
const LIBELLES_ETAT: Readonly<Record<EtatJour, string>> = {
  garde: 'Gardé',
  absent: 'Absent',
  'depart-avance': 'Départ avancé',
  'arrivee-retardee': 'Arrivée retardée',
  ajuste: 'Horaires modifiés',
  'jour-ajoute': 'Jour ajouté',
  cantine: 'Cantine',
  peri: 'Périscolaire',
  alsh: 'Centre de loisirs (ALSH)',
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
  contexte,
}: {
  ligne: LigneJour;
  foyerId: string;
  mois: string;
  /**
   * Complément d'aria-label (« demain ») : la page affiche désormais deux
   * sections de lignes (aujourd'hui / demain) — sans lui, deux liens « Modifier
   * la garde de Léa » seraient indistinguables au lecteur d'écran.
   */
  contexte?: string;
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
        className="jour-pastille"
        // Seule la couleur (fonction de l'état/du mode) reste dynamique.
        style={{ backgroundColor: couleurEtat(ligne) }}
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
        aria-label={`Modifier la garde de ${ligne.enfant}${
          contexte === undefined ? '' : ` ${contexte}`
        }`}
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
      <h2 className="titre-carte">
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
    <div className="carte bandeau-cout">
      <span>
        Coût de <strong>{formaterMoisFr(mois)}</strong>
      </span>
      <span className="bandeau-cout-total">
        <strong className="bandeau-cout-montant">
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
 * Section « Demain » (UX dashboard, lot 2) : les gardes du lendemain, toujours
 * visibles et compactes sous la journée — l'ouverture du soir (« qu'est-ce qui
 * est prévu demain ? ») est le cas d'usage principal du parent. Réutilise
 * `RangeeJour` et `lignesDuJour` avec la date de demain.
 *
 * Demain peut tomber dans la semaine ISO suivante (dimanche → lundi) : dans ce
 * cas seulement, un second `lireSemaineBesoins` — silencieux en chargement et
 * en erreur (pattern du `BandeauCoutMois`), pour ne jamais bloquer ni faire
 * échouer l'affichage d'aujourd'hui.
 */
function SectionDemain({
  foyerId,
  demain,
  semaineDemain,
  memeSemaine,
  vueAujourdhui,
}: {
  foyerId: string;
  demain: string;
  semaineDemain: string;
  /** `true` si demain est dans la même semaine ISO qu'aujourd'hui (pas de 2e fetch). */
  memeSemaine: boolean;
  vueAujourdhui: SemaineBesoins;
}) {
  const { data: vueSuivante } = useAsync<SemaineBesoins | null>(
    (signal) =>
      memeSemaine
        ? Promise.resolve(null)
        : api.lireSemaineBesoins(foyerId, semaineDemain, { signal }),
    [foyerId, semaineDemain, memeSemaine],
  );
  const vue = memeSemaine ? vueAujourdhui : vueSuivante;
  if (vue === null) {
    // Fetch secondaire en cours ou en échec : on se tait plutôt que d'afficher
    // un faux « aucune garde » — la journée au-dessus reste intacte.
    return null;
  }
  const lignes = lignesDuJour(vue, demain);
  const jour = jourSemaineDeIso(demain);
  return (
    <section aria-label="Demain">
      <h2 className="titre-avec-date">Demain</h2>
      <p className="muted sous-titre-date">
        {LIBELLES_JOURS[jour]} {formaterDateFr(demain)}
      </p>
      {lignes.length > 0 ? (
        <ul className="jours-liste">
          {lignes.map((ligne) => (
            <RangeeJour
              key={ligne.contratId}
              ligne={ligne}
              foyerId={foyerId}
              // Le deep-link « Modifier » atterrit sur le mois de DEMAIN (qui
              // peut différer d'aujourd'hui en fin de mois).
              mois={demain.slice(0, 7)}
              contexte="demain"
            />
          ))}
        </ul>
      ) : (
        // Volontairement sobre (pas de carte) : c'est une info secondaire.
        <p className="muted">Aucune garde prévue demain.</p>
      )}
    </section>
  );
}

/**
 * Rangée factice de l'état de chargement (lot 3 UX) : même grille que
 * `RangeeJour` (`.jour-rangee` — pastille, deux lignes de texte, action) pour
 * que la carte squelette ait la silhouette du contenu qu'elle annonce.
 * Purement décorative : le parent (`aria-hidden`) la masque aux lecteurs
 * d'écran, qui reçoivent le texte de chargement à la place.
 */
function RangeeSquelette() {
  return (
    <li className="jour-rangee">
      <span className="jour-pastille squelette-bloc" />
      <span>
        <span className="squelette-bloc squelette-texte" />
        <span className="squelette-bloc squelette-texte squelette-texte-courte" />
      </span>
      <span className="squelette-bloc squelette-action" />
    </li>
  );
}

/** Première date (ordre chronologique) où la vue a au moins une ligne de garde. */
function premiereDateAvecGarde(
  vue: SemaineBesoins,
  dates: readonly string[],
): string | undefined {
  return dates.find((d) => lignesDuJour(vue, d).length > 0);
}

/**
 * « Prochaine garde » de l'état vide (lot 4 UX) : quand rien n'est prévu
 * aujourd'hui (week-end typiquement), dire au parent QUAND ça reprend plutôt
 * que le laisser sur un simple constat. Scanne les jours suivants dans la vue
 * déjà chargée (semaine courante), puis la semaine ISO suivante via un fetch
 * silencieux en chargement comme en erreur (pattern `BandeauCoutMois`) — pas
 * au-delà (~2 semaines) : sans garde trouvée, on se tait et l'état vide garde
 * son lien vers le planning.
 */
function ProchaineGarde({
  foyerId,
  aujourdhui,
  vue,
}: {
  foyerId: string;
  aujourdhui: string;
  vue: SemaineBesoins;
}) {
  const semaine = semaineIsoDeDate(aujourdhui);
  // Les 13 lendemains, groupés par semaine ISO. Seules la semaine courante et
  // la suivante sont scannées (les jours qui débordent sur N+2 sont ignorés).
  const parSemaine = new Map<string, string[]>();
  let date = aujourdhui;
  for (let i = 0; i < 13; i += 1) {
    date = jourSuivant(date);
    const s = semaineIsoDeDate(date);
    parSemaine.set(s, [...(parSemaine.get(s) ?? []), date]);
  }
  const trouveeCourante = premiereDateAvecGarde(
    vue,
    parSemaine.get(semaine) ?? [],
  );
  // 13 jours consécutifs franchissent toujours un lundi : la clé existe.
  const semaineSuivante =
    [...parSemaine.keys()].find((s) => s !== semaine) ?? '';

  // Fetch secondaire UNIQUEMENT si la semaine courante n'a rien donné.
  const chercherSuivante = trouveeCourante === undefined;
  const { data: vueSuivante } = useAsync<SemaineBesoins | null>(
    (signal) =>
      chercherSuivante
        ? api.lireSemaineBesoins(foyerId, semaineSuivante, { signal })
        : Promise.resolve(null),
    [foyerId, semaineSuivante, chercherSuivante],
  );
  const prochaine =
    trouveeCourante ??
    (vueSuivante
      ? premiereDateAvecGarde(
          vueSuivante,
          parSemaine.get(semaineSuivante) ?? [],
        )
      : undefined);
  if (prochaine === undefined) {
    return null;
  }
  return (
    <p className="etat-vide-texte">
      Prochaine garde : <strong>{libelleDate(prochaine)}</strong>
    </p>
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
  // Demain (lot 2 UX) : dérivé du même « aujourd'hui » Paris ; sa semaine ISO
  // peut être la suivante (dimanche → lundi), auquel cas `SectionDemain` fera
  // son propre fetch.
  const demain = jourSuivant(aujourdhui);
  const semaineDemain = semaineIsoDeDate(demain);
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
      <h1 className="titre-avec-date">Aujourd’hui</h1>
      <p className="muted sous-titre-date">
        {LIBELLES_JOURS[jour]} {formaterDateFr(aujourdhui)}
      </p>

      {/* Lot 1 UX : la semaine à valider d'abord — c'est LE geste attendu du
          parent quand elle existe ; le reste de la journée vient après. */}
      <CarteAValider foyerId={id} />

      {/* Lot 3 UX : squelette reprenant la silhouette d'une liste de gardes —
          l'écran garde sa structure pendant le chargement au lieu de « poper »
          d'un coup. L'annonce texte reste servie aux lecteurs d'écran. */}
      {loading && !data && (
        <div className="carte" aria-live="polite">
          <p className="sr-only">Chargement de votre journée…</p>
          <ul className="jours-liste" aria-hidden="true">
            <RangeeSquelette />
            <RangeeSquelette />
          </ul>
        </div>
      )}

      {!loading && error && !data && (
        <div className="carte" role="alert">
          {/* Lot 3 UX : libellé générique rassurant plutôt que le message
              remonté par la couche API, dont le repli peut être technique —
              un parent n'a que faire d'un « HTTP 502 ». */}
          <p className="texte-erreur">
            Impossible de charger votre journée. Vérifiez votre connexion et
            réessayez.
          </p>
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
          <p className="etat-vide-texte">Aucune garde prévue aujourd’hui.</p>
          {/* Lot 4 UX : dire quand ça reprend plutôt qu'un cul-de-sac. */}
          <ProchaineGarde foyerId={id} aujourdhui={aujourdhui} vue={data} />
          <Link to={`/foyers/${id}/planning`} className="btn secondaire">
            Voir le planning
          </Link>
        </div>
      )}

      {/* Lot 2 UX : « Demain » toujours visible sous la journée — attend que
          la journée soit chargée (elle porte la vue réutilisée en semaine
          courante), mais ne dépend pas de son contenu. */}
      {data && (
        <SectionDemain
          foyerId={id}
          demain={demain}
          semaineDemain={semaineDemain}
          memeSemaine={semaineDemain === semaine}
          vueAujourdhui={data}
        />
      )}

      {/* P3c, déplacé en bas de page (lot 3 UX) : l'argent passe APRÈS les
          enfants, et comme le bandeau rend null pendant son chargement, son
          apparition tardive ne décale plus les gardes que le parent s'apprête
          à toucher. Toujours rendu (indépendant des états de la journée). */}
      <BandeauCoutMois foyerId={id} mois={mois} />
    </div>
  );
}
