import { useCallback, useEffect, useState } from 'react';
import type {
  AbsenceCreche,
  AjustementJour,
  ContratLocal,
  CreerContratCreche,
  JourSupplementaire,
  LienEtablissementSaisie,
  PlageHoraire,
} from '../types/bff';
import { usePersistanceAbsences } from '../hooks/usePersistanceAbsences';
import {
  socleContratDurable,
  useCalendrierContrat,
  type UseCalendrierContratResultat,
} from './useCalendrierContrat';

// La saisie crèche se fait en heures d'arrivée/départ ; on conserve la plage
// horaire dans l'état (et la persistance) pour un aller-retour fidèle.
export interface EtatAbsence extends PlageHoraire {
  date: string;
  preavisJours: number;
  certificatMaladie: boolean;
}

export interface EtatJourSup extends PlageHoraire {
  date: string;
}

// Ajustement d'heures réelles d'un jour gardé (saisi dans l'éditeur hebdomadaire).
// Le calendrier mensuel ne l'ÉDITE pas mais le PRÉSERVE (l'écriture du mois est un
// remplacement complet) et l'affiche en ambre — sinon un ajustement posé côté
// « valider ma semaine » disparaîtrait à la prochaine édition du mois.
export interface EtatAjustement extends PlageHoraire {
  date: string;
  preavisJours: number;
  certificatMaladie: boolean;
}

export interface UseSaisieCrecheOptions {
  contrat: ContratLocal;
  mois: string;
  simule: boolean;
  onEnregistre: () => void;
  onContratModifie?: (() => void) | undefined;
}

export interface UseSaisieCrecheResultat {
  /** Enveloppe commune (statut, réhydratation, portée, PUT durable). */
  calendrier: UseCalendrierContratResultat<ContratLocal['semaineType']>;
  absences: EtatAbsence[];
  joursSup: EtatJourSup[];
  ajustements: EtatAjustement[];
  complementMinutes: number | undefined;
  majAbsences: (nouvelles: EtatAbsence[]) => void;
  majJoursSup: (nouveaux: EtatJourSup[]) => void;
  /** Écrit la saisie du mois (remplacement complet, debouncé). */
  envoyer: (
    absences: EtatAbsence[],
    joursSup: EtatJourSup[],
    complementMinutes: number | undefined,
  ) => void;
  /** Met à jour le temps de garde en plus et l'envoie dans la foulée. */
  majComplementMinutes: (valeur: number | undefined) => void;
  /**
   * Vrai si le brouillon local ne peut pas être mémorisé (sessionStorage
   * indisponible ou saturé) : la saisie en cours ne survivra pas à un
   * changement de mois avant sauvegarde (AQ-12).
   */
  persistanceIndisponible: boolean;
}

/**
 * Saisie mensuelle d'un contrat crèche : absences, jours ajoutés, ajustements
 * d'heures et temps de garde en plus — avec leur brouillon local, leur
 * réhydratation serveur et leur écriture.
 *
 * Le hook enveloppe `useCalendrierContrat` plutôt que de vivre à côté : la
 * réinitialisation d'après-PUT et l'écriture debouncée se REFERMENT l'une sur
 * l'autre (le contrat a besoin de savoir remettre la saisie à zéro, la saisie a
 * besoin d'écrire). Les tenir séparés obligeait le composant à faire ce
 * chaînage lui-même.
 */
export function useSaisieCreche({
  contrat,
  mois,
  simule,
  onEnregistre,
  onContratModifie,
}: UseSaisieCrecheOptions): UseSaisieCrecheResultat {
  // Persistance locale par (contrat, mois) : brouillon entre deux navigations.
  // La source de vérité reste le serveur (réhydraté ci-dessous).
  //
  // Les fonctions sont DÉSTRUCTURÉES : elles sont stables, alors que l'objet
  // porteur change d'identité dès que `indisponible` bascule. Les lister telles
  // quelles en dépendances (et non `persist.lire`) rend les listes exactes sans
  // rejouer la réhydratation sur un simple échec d'écriture.
  const {
    lire: lireAbsences,
    ecrire: ecrireAbsences,
    indisponible: absencesIndisponibles,
  } = usePersistanceAbsences<EtatAbsence>('creche:absences');
  const {
    lire: lireJoursSup,
    ecrire: ecrireJoursSup,
    indisponible: joursSupIndisponibles,
  } = usePersistanceAbsences<EtatJourSup>('creche:joursSup');
  const { lire: lireAjustements, ecrire: ecrireAjustements } =
    usePersistanceAbsences<EtatAjustement>('creche:ajustements');

  const [complementMinutes, setComplementMinutes] = useState<
    number | undefined
  >(undefined);
  const [absences, setAbsences] = useState<EtatAbsence[]>(() =>
    lireAbsences(contrat.id, mois),
  );
  const [joursSup, setJoursSup] = useState<EtatJourSup[]>(() =>
    lireJoursSup(contrat.id, mois),
  );
  const [ajustements, setAjustements] = useState<EtatAjustement[]>(() =>
    lireAjustements(contrat.id, mois),
  );

  const majAbsences = useCallback(
    (nouvelles: EtatAbsence[]) => {
      setAbsences(nouvelles);
      ecrireAbsences(contrat.id, mois, nouvelles);
    },
    [ecrireAbsences, contrat.id, mois],
  );

  const majJoursSup = useCallback(
    (nouveaux: EtatJourSup[]) => {
      setJoursSup(nouveaux);
      ecrireJoursSup(contrat.id, mois, nouveaux);
    },
    [ecrireJoursSup, contrat.id, mois],
  );

  const majAjustements = useCallback(
    (nouveaux: EtatAjustement[]) => {
      setAjustements(nouveaux);
      ecrireAjustements(contrat.id, mois, nouveaux);
    },
    [ecrireAjustements, contrat.id, mois],
  );

  // Remplacement complet du contrat (PUT) pour la portée « tous les X » : la
  // semaine type modifiée est le payload, le reste du contrat est reconduit.
  const construireCorpsDurable = useCallback(
    (
      semaineTypeModifiee: ContratLocal['semaineType'],
    ): CreerContratCreche & LienEtablissementSaisie => ({
      mode: 'CRECHE_PSU',
      heuresAnnuellesContractualisees:
        contrat.heuresAnnuellesContractualisees ?? 0,
      nbMensualites: contrat.nbMensualites ?? 7,
      semaineType: semaineTypeModifiee ?? {},
      ...socleContratDurable(contrat),
    }),
    [contrat],
  );

  const reinitialiserSaisie = useCallback(() => {
    majAbsences([]);
    majJoursSup([]);
    majAjustements([]);
    setComplementMinutes(undefined);
  }, [majAbsences, majJoursSup, majAjustements]);

  const calendrier = useCalendrierContrat<ContratLocal['semaineType']>({
    contrat,
    mois,
    simule,
    onEnregistre,
    onContratModifie,
    construireCorpsDurable,
    reinitialiserSaisie,
  });
  const {
    ecrire,
    saisieServeur,
    chargee,
    marquerSaisieLocale,
    saisieServeurObsolete,
  } = calendrier;

  // Changement de (contrat, mois) : on repart du brouillon local de la nouvelle
  // clé, en attendant la réhydratation serveur.
  useEffect(() => {
    setAbsences(lireAbsences(contrat.id, mois));
    setJoursSup(lireJoursSup(contrat.id, mois));
    setAjustements(lireAjustements(contrat.id, mois));
    setComplementMinutes(undefined);
  }, [lireAbsences, lireJoursSup, lireAjustements, contrat.id, mois]);

  // À l'arrivée de la saisie serveur : elle devient la source de vérité. Si le
  // serveur ne renvoie rien, on conserve le brouillon local (saisie en cours).
  useEffect(() => {
    if (!chargee || saisieServeur === null) return;
    // Anti-clobber : si le parent a édité PENDANT le chargement, ce GET (plus
    // ancien que l'édition) est périmé — on le laisse tomber pour ne pas faire
    // « réapparaître » l'ancien état serveur par-dessus la saisie récente.
    if (saisieServeurObsolete()) return;
    const abs: EtatAbsence[] = (saisieServeur.absences ?? [])
      .filter(
        (a): a is AbsenceCreche & { date: string } => a.date !== undefined,
      )
      .map((a) => ({
        date: a.date,
        debutHeures: a.debutHeures,
        debutMinutes: a.debutMinutes,
        finHeures: a.finHeures,
        finMinutes: a.finMinutes,
        preavisJours: a.preavisJours,
        certificatMaladie: a.certificatMaladie,
      }));
    const sup: EtatJourSup[] = (saisieServeur.joursSupplementaires ?? []).map(
      (j) => ({
        date: j.date,
        debutHeures: j.debutHeures,
        debutMinutes: j.debutMinutes,
        finHeures: j.finHeures,
        finMinutes: j.finMinutes,
      }),
    );
    const ajust: EtatAjustement[] = (saisieServeur.ajustements ?? []).map(
      (a) => ({
        date: a.date,
        debutHeures: a.debutHeures,
        debutMinutes: a.debutMinutes,
        finHeures: a.finHeures,
        finMinutes: a.finMinutes,
        preavisJours: a.preavisJours,
        certificatMaladie: a.certificatMaladie,
      }),
    );
    setAbsences(abs);
    setJoursSup(sup);
    setAjustements(ajust);
    setComplementMinutes(saisieServeur.complementMinutes);
    ecrireAbsences(contrat.id, mois, abs);
    ecrireJoursSup(contrat.id, mois, sup);
    ecrireAjustements(contrat.id, mois, ajust);
  }, [
    chargee,
    saisieServeur,
    saisieServeurObsolete,
    contrat.id,
    mois,
    ecrireAbsences,
    ecrireJoursSup,
    ecrireAjustements,
  ]);

  const envoyer = useCallback(
    (
      nvAbsences: EtatAbsence[],
      nvJoursSup: EtatJourSup[],
      nvComplementMinutes: number | undefined,
    ) => {
      // Toute édition locale passe par ici : on marque la divergence pour qu'un
      // GET de réhydratation encore en vol ne vienne pas l'écraser à son retour.
      marquerSaisieLocale();
      // L'écriture du mois est un remplacement complet : on réémet les ajustements
      // d'heures (saisis dans l'éditeur hebdo) pour ne pas les perdre. Un jour ne
      // porte qu'une seule saisie (A3) : une absence / un jour ajouté sur une date
      // ajustée fait céder l'ajustement.
      const datesOccupees = new Set<string>([
        ...nvAbsences.map((a) => a.date),
        ...nvJoursSup.map((j) => j.date),
      ]);
      const ajustementsConserves = ajustements.filter(
        (a) => !datesOccupees.has(a.date),
      );
      if (ajustementsConserves.length !== ajustements.length) {
        majAjustements(ajustementsConserves);
      }
      const absencesApi: AbsenceCreche[] = nvAbsences.map((a) => ({
        date: a.date,
        debutHeures: a.debutHeures,
        debutMinutes: a.debutMinutes,
        finHeures: a.finHeures,
        finMinutes: a.finMinutes,
        preavisJours: a.preavisJours,
        certificatMaladie: a.certificatMaladie,
      }));
      const joursSupApi: JourSupplementaire[] = nvJoursSup.map((j) => ({
        date: j.date,
        debutHeures: j.debutHeures,
        debutMinutes: j.debutMinutes,
        finHeures: j.finHeures,
        finMinutes: j.finMinutes,
      }));
      const ajustementsApi: AjustementJour[] = ajustementsConserves.map(
        (a) => ({
          date: a.date,
          debutHeures: a.debutHeures,
          debutMinutes: a.debutMinutes,
          finHeures: a.finHeures,
          finMinutes: a.finMinutes,
          preavisJours: a.preavisJours,
          certificatMaladie: a.certificatMaladie,
        }),
      );
      ecrire(contrat.id, mois, simule, {
        ...(nvComplementMinutes !== undefined
          ? { complementMinutes: nvComplementMinutes }
          : {}),
        ...(joursSupApi.length > 0
          ? { joursSupplementaires: joursSupApi }
          : {}),
        ...(absencesApi.length > 0 ? { absences: absencesApi } : {}),
        ...(ajustementsApi.length > 0 ? { ajustements: ajustementsApi } : {}),
      });
    },
    [
      ecrire,
      contrat.id,
      mois,
      simule,
      marquerSaisieLocale,
      ajustements,
      majAjustements,
    ],
  );

  const majComplementMinutes = useCallback(
    (valeur: number | undefined) => {
      setComplementMinutes(valeur);
      envoyer(absences, joursSup, valeur);
    },
    [absences, joursSup, envoyer],
  );

  return {
    calendrier,
    absences,
    joursSup,
    ajustements,
    complementMinutes,
    majAbsences,
    majJoursSup,
    envoyer,
    majComplementMinutes,
    persistanceIndisponible: absencesIndisponibles || joursSupIndisponibles,
  };
}
