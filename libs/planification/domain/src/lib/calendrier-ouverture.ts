import {
  differenceEnJours,
  estDateIso,
  joursFeries,
  type Instant,
  type RegimeFeries,
} from '@creche-planner/shared-kernel';
import { jourSemaineDeIso, type JourSemaine } from './jour-semaine.js';
import { joursDuMois } from './mois.js';
import {
  CalendrierIncoherentError,
  ConnaissanceInvalideError,
  DateInvalideError,
} from './planification-error.js';

/**
 * **Calendrier d'ouverture d'un établissement** — domaine pur (SFD 31).
 *
 * Répond, pour un établissement, un jour J **et un instant de connaissance** :
 * « quels services sont réservables, et dans quel contexte ». Aucune base, aucune
 * route, aucune horloge : ce module ne sait pas quel jour on est, on le lui dit.
 *
 * ## Deux axes de temps, jamais interchangeables
 *
 * 1. Le temps **métier** — quand une période a lieu : les bornes `du`/`au`, le jour
 *    d'une exception. Ce sont des dates ISO `YYYY-MM-DD`, comparées
 *    lexicographiquement comme partout dans le domaine.
 * 2. Le temps de **connaissance** — ce que le calendrier disait à un instant donné :
 *    `connuDepuis`/`connuJusqua`, des `Instant` (cf. `instant.ts` du
 *    `shared-kernel`). C'est l'axe exigé par RM-31-03 et par l'amendement PO du
 *    2026-08-16 : **une retouche ne réécrit pas l'interprétation d'un mois déjà
 *    facturé**.
 *
 * ⚠️ `versionnement.ts` (socle SFD 30) ne fournit **pas** le second axe : il
 * versionne le temps métier — exactement celui que le calendrier possède déjà par
 * ses `du`/`au`. L'employer ici confondrait les deux, et le symptôme n'apparaîtrait
 * qu'à la première retouche d'une période passée, en production. Il reste le bon
 * outil pour les bornes d'une période, jamais pour l'historisation des retouches.
 *
 * Les deux axes ne portent d'ailleurs pas la même sémantique de borne : `au` est
 * **inclusif** sur l'axe métier (un jour entier), `connuJusqua` est **exclusif** sur
 * l'axe de connaissance (un instant). Les replier l'un sur l'autre « par confort »
 * décalerait la vérité d'un jour sans rien casser visiblement — d'où le type brandé
 * `Instant`, que le compilateur refuse de confondre avec une date nue.
 *
 * ## Historisation par ligne (append-only)
 *
 * Une retouche **n'écrase ni ne supprime** : elle clôt la ligne précédente
 * (`clore`) et en ouvre une nouvelle. Le modèle retenu est l'historisation par
 * ligne, et non un cliché complet du calendrier par version — un cliché recopierait
 * les trois couches à chaque retouche, pour un gain de lisibilité qui ne compense
 * ni le volume ni la reprise (D6 révisée).
 *
 * **Ce que la persistance devra savoir** (lot 2, qui s'y conforme — jamais
 * l'inverse) : les trois tables portent `connu_depuis` NOT NULL et `connu_jusqua`
 * NULL ; leurs contraintes d'unicité sont **partielles** — uniques parmi les
 * lignes encore ouvertes seulement, sinon elles interdiraient précisément
 * l'historique qu'on veut garder. `verifierUniciteOuverte` en est l'expression de
 * domaine : c'est cette clé-là, et pas une autre, que le `WHERE connu_jusqua IS
 * NULL` doit indexer.
 *
 * ## Priorité des couches (RM-31-01, complétée par RM-31-02)
 *
 * `exception > férié > période > récurrence`. Les fériés ne sont **pas historisés**
 * (`joursFeries`) : ils sont calculés, donc déterministes et identiques quel que
 * soit l'instant de connaissance — un seul axe de temps s'y applique.
 *
 * ⚠️ **Cela vaut pour un régime donné, pas pour le régime lui-même.** `regimeFeries`
 * est une donnée d'établissement portée par une colonne simple (D2), hors de tout
 * axe de connaissance : corriger un `FR` saisi par erreur en `FR_ALSACE_MOSELLE`
 * changerait rétroactivement l'interprétation des mois déjà facturés — deux jours
 * par an, mais exactement le genre de retouche que RM-31-03 interdit. Le calcul est
 * innocent, son entrée ne l'est pas. Suivi en `AM-106`, à trancher au lot 2 : soit
 * la colonne est historisée comme les trois couches, soit la limite est écrite et
 * assumée.
 */

/**
 * Services qu'un calendrier peut ouvrir ou fermer.
 *
 * **Miroir local documenté** (CONVENTIONS.md §4) de `MODES_CONTRAT`
 * (`libs/contracts/kernel/src/lib/modes.ts`, source de vérité unique du dépôt) :
 * cette lib est `type:domain` et ne peut donc pas dépendre d'une lib
 * `type:contracts` (`@nx/enforce-module-boundaries`). Patron de référence :
 * `referentiel-domain/mode-garde.ts`. La recopie est déclarée dans le registre
 * `MIROIRS` de `scripts/verifier-frontieres.mjs`, qui la compare à la source à
 * chaque CI — sans quoi elle dériverait en silence.
 *
 * La distinction ALSH journée / demi-journée reste portée par la **saisie**
 * (`JourAlshHebdo`, `inscription-abcm.ts`), pas par le calendrier (H6).
 */
export const SERVICES_CALENDRIER = [
  'CRECHE_PSU',
  'PERISCOLAIRE',
  'CANTINE',
  'ALSH',
] as const;

/** Service ouvrable par le calendrier (type unitaire dérivé). */
export type ServiceCalendrier = (typeof SERVICES_CALENDRIER)[number];

/**
 * Intervalle de **connaissance** d'une ligne de calendrier : `[connuDepuis,
 * connuJusqua)`. Semi-ouvert — une retouche à l'instant `t` clôt la ligne
 * précédente à `t` et ouvre la nouvelle à `t`, sans recouvrement d'un millième de
 * seconde. `connuJusqua` absent = ligne encore en vigueur.
 */
export interface Connaissance {
  readonly connuDepuis: Instant;
  readonly connuJusqua?: Instant;
}

/** Nature d'une période de calendrier (couche 2). */
export type TypePeriode =
  'PERIODE_SCOLAIRE' | 'VACANCES' | 'FERMETURE_ANNUELLE';

/** Nature d'une exception ponctuelle (couche 1). */
export type TypeException =
  'FERMETURE' | 'OUVERTURE' | 'JOURNEE_PEDAGOGIQUE' | 'PONT';

/** Régime hebdomadaire d'un établissement (couche 3). */
export type RegimeSemaine = 'SCOLAIRE' | 'VACANCES';

/** Contexte rendu pour un jour résolu (langage parent, US-31-04). */
export type ContexteJour =
  'PERIODE_SCOLAIRE' | 'VACANCES' | 'FERIE' | 'FERMETURE';

/**
 * Période datée (couche 2) : bornes `du`/`au` **inclusives**, axe métier.
 * `FERMETURE_ANNUELLE` ferme la période ; `PERIODE_SCOLAIRE`/`VACANCES` en fixent
 * le régime hebdomadaire.
 */
export interface PeriodeCalendrier extends Connaissance {
  readonly type: TypePeriode;
  readonly libelle: string;
  readonly du: string;
  readonly au: string;
}

/**
 * Exception ponctuelle (couche 1), la plus forte. `services` absent = **tous les
 * services** : une fermeture totale, ou une ouverture qui rétablit simplement la
 * récurrence du jour.
 */
export interface ExceptionCalendrier extends Connaissance {
  readonly jour: string;
  readonly type: TypeException;
  readonly libelle: string;
  readonly services?: readonly ServiceCalendrier[];
}

/** Récurrence hebdomadaire (couche 3), par régime et jour de semaine. */
export interface RecurrenceCalendrier extends Connaissance {
  readonly regime: RegimeSemaine;
  readonly jourSemaine: JourSemaine;
  readonly services: readonly ServiceCalendrier[];
}

/**
 * Calendrier d'un établissement. `regimeFeries` est une **donnée**
 * d'établissement, jamais une constante (RM-31-05) : Mulhouse relève du droit
 * local d'Alsace-Moselle.
 */
export interface CalendrierOuverture {
  readonly regimeFeries: RegimeFeries;
  readonly periodes: readonly PeriodeCalendrier[];
  readonly exceptions: readonly ExceptionCalendrier[];
  readonly recurrences: readonly RecurrenceCalendrier[];
}

/** Réponse du calendrier pour un jour. */
export interface JourResolu {
  readonly jour: string;
  readonly contexte: ContexteJour;
  /** Libellé affichable (`''` si aucune couche nommée ne s'applique). */
  readonly libelle: string;
  readonly servicesOuverts: readonly ServiceCalendrier[];
}

/**
 * **L'ancre de connaissance — décision du lot 1, motif écrit ici.**
 *
 * Pour régénérer un mois, il faut un instant auquel interroger le calendrier. Deux
 * candidats étaient ouverts (D6 révisée) :
 *
 * - **(a) l'instant de facturation du mois** — plus juste, mais suppose que la
 *   facturation l'enregistre (une colonne de plus sur le chemin de génération) ;
 * - **(b) l'instant de création des prestations du mois** (`created_at` existant de
 *   `planning_mois`) — gratuit, mais faux dès qu'un mois est régénéré pour une
 *   autre raison.
 *
 * **Retenu : (a).** Le motif n'est pas le coût, c'est la règle elle-même. RM-31-03
 * protège les mois **déjà facturés**, et eux seuls. Avec (b), un mois serait figé
 * dès la création de son planning — souvent des semaines avant d'être facturé — si
 * bien qu'une correction de calendrier faite en septembre ne s'appliquerait pas à
 * un mois d'octobre saisi en août. Ce serait l'inverse du besoin : le parent
 * retouche précisément pour que le **futur** soit juste. (b) viderait de surcroît
 * CA4 de son sens — la liste d'incohérences ne porte que sur les jours non encore
 * facturés, ce qui suppose que ces jours-là suivent le calendrier **courant**.
 *
 * D'où la règle, en une ligne : **un mois facturé garde l'interprétation qu'il
 * avait à sa facturation ; un mois non facturé suit le calendrier d'aujourd'hui.**
 * Un mois régénéré pour une autre raison (correction de saisie, rejeu de
 * projection) conserve donc son interprétation — c'est exactement ce que (b) ne
 * savait pas faire.
 *
 * Ce que cela impose au lot 4 : le chemin de facturation enregistre `factureLe` au
 * premier arrêté du mois et ne le rebouge plus. Tant que la colonne n'existe pas,
 * `factureLe` reste `undefined` et la résolution suit le calendrier courant —
 * comportement identique à l'actuel, donc déployable sans reprise.
 */
export function ancreDeConnaissance(
  maintenant: Instant,
  factureLe?: Instant,
): Instant {
  return factureLe ?? maintenant;
}

/**
 * Clôt une ligne de calendrier à `aLInstant` (modèle append-only : on clôt et on
 * ouvre, on n'écrase jamais). Lève `ConnaissanceInvalideError` si la ligne est
 * déjà close, ou si la clôture précède son ouverture.
 */
export function clore<T extends Connaissance>(
  ligne: T,
  aLInstant: Instant,
): T & { readonly connuJusqua: Instant } {
  if (ligne.connuJusqua !== undefined) {
    throw new ConnaissanceInvalideError(
      `ligne déjà close le ${ligne.connuJusqua} : une ligne ne se clôt qu'une fois`,
    );
  }
  if (aLInstant < ligne.connuDepuis) {
    throw new ConnaissanceInvalideError(
      `clôture (${aLInstant}) antérieure à l'ouverture (${ligne.connuDepuis})`,
    );
  }
  return { ...ligne, connuJusqua: aLInstant };
}

/**
 * Garde-fou de publication : au plus **une ligne ouverte** par clé — un jour pour
 * les exceptions, un couple (régime, jour de semaine) pour les récurrences. C'est
 * l'expression de domaine des unicités **partielles** de la base (D2 révisée) :
 * l'historique conserve autant de lignes closes que de retouches, mais la
 * résolution d'aujourd'hui ne doit jamais être ambiguë. Les périodes n'ont pas
 * d'unicité : plusieurs peuvent légitimement couvrir un même jour (une fermeture
 * annuelle pendant des vacances).
 */
export function verifierUniciteOuverte(calendrier: CalendrierOuverture): void {
  const joursExceptions = new Set<string>();
  for (const exception of calendrier.exceptions) {
    if (exception.connuJusqua !== undefined) {
      continue;
    }
    if (joursExceptions.has(exception.jour)) {
      throw new CalendrierIncoherentError(
        `deux exceptions ouvertes le ${exception.jour} : la résolution serait ambiguë`,
      );
    }
    joursExceptions.add(exception.jour);
  }
  const clesRecurrences = new Set<string>();
  for (const recurrence of calendrier.recurrences) {
    if (recurrence.connuJusqua !== undefined) {
      continue;
    }
    const cle = `${recurrence.regime}|${recurrence.jourSemaine}`;
    if (clesRecurrences.has(cle)) {
      throw new CalendrierIncoherentError(
        `deux récurrences ouvertes pour ${cle} : la résolution serait ambiguë`,
      );
    }
    clesRecurrences.add(cle);
  }
}

/** Vrai si la ligne était connue à `aLaDate` (intervalle semi-ouvert). */
function connuA(ligne: Connaissance, aLaDate: Instant): boolean {
  if (ligne.connuDepuis > aLaDate) {
    return false;
  }
  return ligne.connuJusqua === undefined || aLaDate < ligne.connuJusqua;
}

/**
 * La ligne la plus récemment connue d'un ensemble. Départage un calendrier dont
 * l'unicité partielle aurait été violée en base : la plus récente l'emporte, comme
 * `selectionnerVersionApplicable` sur l'axe métier. À `connuDepuis` égal, la
 * première rencontrée est retenue — le résultat reste déterministe.
 */
function plusRecente<T extends Connaissance>(
  lignes: readonly T[],
): T | undefined {
  return lignes.reduce<T | undefined>(
    (retenue, ligne) =>
      retenue === undefined || ligne.connuDepuis > retenue.connuDepuis
        ? ligne
        : retenue,
    undefined,
  );
}

/**
 * La période **la plus spécifique** d'un ensemble qui couvre déjà le même jour.
 *
 * Les périodes se chevauchent par construction : l'open data ne publie que les
 * **vacances**, l'année scolaire est saisie d'un bloc, et une semaine de vacances
 * tombe donc *dans* la période scolaire. Départager par l'instant de connaissance
 * — comme on le fait pour deux lignes concurrentes d'une même clé — rendrait la
 * réponse dépendante de l'**ordre de saisie** : entrer l'année scolaire après les
 * vacances rouvrirait la cantine en avril. On départage donc par l'**étendue** :
 * la période la plus courte l'emporte, ce qui est aussi la façon dont un parent
 * lit son calendrier.
 *
 * L'ordre est **total**, donc indépendant de l'ordre du tableau : étendue
 * croissante, puis connaissance la plus récente, puis début le plus tardif.
 */
function plusSpecifique(
  periodes: readonly PeriodeCalendrier[],
): PeriodeCalendrier | undefined {
  return periodes.reduce<PeriodeCalendrier | undefined>((retenue, periode) => {
    if (retenue === undefined) {
      return periode;
    }
    const ecart =
      differenceEnJours(periode.du, periode.au) -
      differenceEnJours(retenue.du, retenue.au);
    if (ecart !== 0) {
      return ecart < 0 ? periode : retenue;
    }
    if (periode.connuDepuis !== retenue.connuDepuis) {
      return periode.connuDepuis > retenue.connuDepuis ? periode : retenue;
    }
    return periode.du > retenue.du ? periode : retenue;
  }, undefined);
}

/** Vue du calendrier réduite à ce qui était connu à `aLaDate`. */
interface CalendrierConnu {
  readonly periodes: readonly PeriodeCalendrier[];
  readonly exceptions: readonly ExceptionCalendrier[];
  readonly recurrences: readonly RecurrenceCalendrier[];
  readonly feries: ReadonlyMap<string, string>;
}

function reduireAuConnu(
  calendrier: CalendrierOuverture,
  jours: readonly string[],
  aLaDate: Instant,
): CalendrierConnu {
  const feries = new Map<string, string>();
  for (const annee of new Set(jours.map((jour) => Number(jour.slice(0, 4))))) {
    for (const ferie of joursFeries(annee, calendrier.regimeFeries)) {
      feries.set(ferie.jour, ferie.libelle);
    }
  }
  return {
    periodes: calendrier.periodes.filter((ligne) => connuA(ligne, aLaDate)),
    exceptions: calendrier.exceptions.filter((ligne) => connuA(ligne, aLaDate)),
    recurrences: calendrier.recurrences.filter((ligne) =>
      connuA(ligne, aLaDate),
    ),
    feries,
  };
}

/**
 * Services ouverts par la seule récurrence. **D7** : un établissement sans *aucune*
 * récurrence saisie est ouvert tous les jours (les fériés le referment une couche
 * plus haut) — c'est la clé de la non-régression, les établissements existants ne
 * changent de comportement qu'à la saisie d'une récurrence. Une récurrence saisie
 * mais muette sur ce couple (régime, jour) ferme, elle.
 *
 * ⚠️ « Aucune récurrence » se juge sur les lignes **connues à l'instant interrogé**,
 * jamais sur la table entière — et ce n'est pas un raccourci. Un mois facturé avant
 * que le calendrier n'existe doit se relire comme il se lisait alors : sans
 * contrainte de calendrier. Juger sur la table entière ferait **rétroagir** une
 * récurrence saisie plus tard sur un mois déjà facturé, exactement ce que
 * l'amendement PO interdit (INV-K1 du MBT). Corollaire assumé : clore toutes les
 * récurrences d'un établissement le rouvre — un calendrier qui ne dit plus rien ne
 * contraint plus rien.
 */
function servicesRecurrents(
  recurrences: readonly RecurrenceCalendrier[],
  regime: RegimeSemaine,
  jourSemaine: JourSemaine,
): readonly ServiceCalendrier[] {
  if (recurrences.length === 0) {
    return SERVICES_CALENDRIER;
  }
  const ligne = plusRecente(
    recurrences.filter(
      (r) => r.regime === regime && r.jourSemaine === jourSemaine,
    ),
  );
  return ligne?.services ?? [];
}

/**
 * Applique l'exception (couche 1) au résultat des couches inférieures. Une
 * `OUVERTURE` sans liste de services rétablit la récurrence du jour — c'est le sens
 * d'une ouverture exceptionnelle un jour férié. Une fermeture partielle retire ses
 * services de ce qui serait autrement ouvert.
 */
function appliquerException(
  exception: ExceptionCalendrier,
  base: JourResolu,
  contexteDeBase: ContexteJour,
  servicesDeRecurrence: readonly ServiceCalendrier[],
): JourResolu {
  if (exception.type === 'OUVERTURE') {
    return {
      jour: base.jour,
      contexte: contexteDeBase,
      libelle: exception.libelle,
      servicesOuverts: exception.services ?? servicesDeRecurrence,
    };
  }
  const retires = exception.services;
  const servicesOuverts =
    retires === undefined
      ? []
      : base.servicesOuverts.filter((service) => !retires.includes(service));
  return {
    jour: base.jour,
    contexte: servicesOuverts.length === 0 ? 'FERMETURE' : contexteDeBase,
    libelle: exception.libelle,
    servicesOuverts,
  };
}

function resoudreDepuisConnu(connu: CalendrierConnu, jour: string): JourResolu {
  const couvrantes = connu.periodes.filter((p) => p.du <= jour && jour <= p.au);
  const periodeDeRegime = plusSpecifique(
    couvrantes.filter(
      (p) => p.type === 'PERIODE_SCOLAIRE' || p.type === 'VACANCES',
    ),
  );
  // Aucune période couvrante ⇒ régime `SCOLAIRE` (décision du plan) : c'est le
  // régime **unique** de la crèche, qui n'a pas de notion de vacances. Conséquence
  // pour un établissement scolaire dont seule l'année scolaire est saisie : un jour
  // d'août tombant hors de toute période est lu comme scolaire. Ce trou est
  // détectable et se signale à la saisie, pas ici (`AM-105`).
  const regime: RegimeSemaine =
    periodeDeRegime?.type === 'VACANCES' ? 'VACANCES' : 'SCOLAIRE';
  const contexteDeBase: ContexteJour =
    regime === 'VACANCES' ? 'VACANCES' : 'PERIODE_SCOLAIRE';
  const servicesDeRecurrence = servicesRecurrents(
    connu.recurrences,
    regime,
    jourSemaineDeIso(jour),
  );

  // Couche 3 — récurrence hebdomadaire, la plus faible.
  let resolu: JourResolu = {
    jour,
    contexte: contexteDeBase,
    libelle: periodeDeRegime?.libelle ?? '',
    servicesOuverts: servicesDeRecurrence,
  };

  // Couche 2 — période fermante.
  const fermeture = plusSpecifique(
    couvrantes.filter((p) => p.type === 'FERMETURE_ANNUELLE'),
  );
  if (fermeture !== undefined) {
    resolu = {
      jour,
      contexte: 'FERMETURE',
      libelle: fermeture.libelle,
      servicesOuverts: [],
    };
  }

  // Couche 1 bis — férié (RM-31-02 : fermeture par défaut de tous les services).
  const libelleFerie = connu.feries.get(jour);
  if (libelleFerie !== undefined) {
    resolu = {
      jour,
      contexte: 'FERIE',
      libelle: libelleFerie,
      servicesOuverts: [],
    };
  }

  // Couche 1 — exception ponctuelle, la plus forte.
  const exception = plusRecente(
    connu.exceptions.filter((e) => e.jour === jour),
  );
  if (exception !== undefined) {
    resolu = appliquerException(
      exception,
      resolu,
      contexteDeBase,
      servicesDeRecurrence,
    );
  }
  return resolu;
}

/**
 * Résout un jour ISO `YYYY-MM-DD` **tel qu'il était connu à `aLaDate`**.
 *
 * `aLaDate` n'est pas une commodité : c'est l'axe de connaissance de RM-31-03.
 * L'appelant l'obtient par `ancreDeConnaissance` — jamais d'une horloge lue ici.
 */
export function resoudreJour(
  calendrier: CalendrierOuverture,
  jour: string,
  aLaDate: Instant,
): JourResolu {
  if (!estDateIso(jour)) {
    throw new DateInvalideError(
      `date ISO invalide : ${jour} (format attendu : YYYY-MM-DD)`,
    );
  }
  return resoudreDepuisConnu(reduireAuConnu(calendrier, [jour], aLaDate), jour);
}

/**
 * Résout tous les jours d'un mois `YYYY-MM` au **même** instant de connaissance :
 * un mois se facture d'un bloc, il s'interprète d'un bloc.
 */
export function resoudreMois(
  calendrier: CalendrierOuverture,
  mois: string,
  aLaDate: Instant,
): readonly JourResolu[] {
  const jours = joursDuMois(mois);
  const connu = reduireAuConnu(calendrier, jours, aLaDate);
  return jours.map((jour) => resoudreDepuisConnu(connu, jour));
}
