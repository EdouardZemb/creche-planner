import { useCallback, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import type {
  ContratBesoinsSemaine,
  ExceptionAbcm,
  StatutNotification,
} from '../types/bff';
import {
  jourSemaineDeIso,
  formaterDateFr,
  formaterDateCourtFr,
  libelleSemaine,
  LIBELLES_JOURS,
  LIBELLES_JOURS_COURT,
} from '../utils/dates';
import { libelleMode } from '../utils/libelles';
import { messageErreur } from '../utils/erreurs';
import { Bouton } from '../ui/Bouton';
import { StatutSauvegarde } from '../ui/StatutSauvegarde';
import { useAnnonce } from '../hooks/useAnnonce';
import { versHhmm, plageDepuisHeures, plageValide } from '../planning/heures';
import { useEcritureSemaine } from './useEcritureSemaine';
import { alshEffectif, initBesoins, versCorps } from './besoinsSemaine';
import type { BesoinsEtat } from './besoinsSemaine';
import {
  aSaisieJour,
  indexerBesoins,
  plageContratPremiere,
  resumeJour,
} from './indexBesoins';
import { etatDeduitAjustement, type EtatDeduit } from './ajustementDeduit';
import { FORM_DEFAUT, type FormJour } from './champsJourSemaine';
import { ModaleJourSemaine } from './ModaleJourSemaine';

// Édition des besoins **datés** d'un contrat sur la seule semaine notifiée. Le BFF
// fournit désormais aussi le planning de BASE (semaine-type) : sur un jour gardé
// crèche, on saisit donc les heures d'arrivée/départ RÉELLES (préremplies avec le
// contrat) et l'app en déduit l'état (extension facturée / réduction déductible),
// écrit comme une entrée `ajustements`. Sur un jour non gardé, c'est un « jour
// ajouté ». L'aplatissement/reconstruction des besoins vit dans `besoinsSemaine.ts`,
// leur indexation et leur lecture par jour dans `indexBesoins.ts`.

/**
 * Ce que voit un parent quand il n'y a rien à valider pour cette semaine. Il n'y a
 * ni panne ni saisie à corriger : le message le dit, et rappelle que l'édition,
 * elle, a bien été enregistrée — sans quoi le parent croirait avoir tout perdu.
 */
const RIEN_A_VALIDER =
  'Cette semaine n’était pas proposée à la validation pour ce contrat : il n’y ' +
  'a rien à valider ici. Vos modifications sont enregistrées.';

export interface EditeurContratSemaineProps {
  contrat: ContratBesoinsSemaine;
  jours: string[];
  semaineIso: string;
  /** Notifie le parent qu'une écriture a abouti (rafraîchir un éventuel coût). */
  onEnregistre?: () => void;
  /**
   * Notifie le parent du statut d'une validation de ce contrat. Le récap au service
   * étant **agrégé par établissement** (Phase 4), c'est l'éditeur parent qui décide
   * d'afficher la relecture/envoi pour le foyer dès qu'un contrat passe en
   * `VALIDEE_AVEC_MODIFS`.
   */
  onValide?: (statut: StatutNotification) => void;
  /**
   * Vrai si CE contrat a bien une semaine à valider. La vue « besoins » liste
   * **tous** les contrats couvrant la semaine, alors que la validation n'existe
   * que pour ceux qu'un rappel du mardi a notifiés : proposer « Valider » aux
   * autres menait droit à un 404, affiché au parent en « Ressource introuvable ».
   * Absent = information non disponible → on garde le bouton (le 404 reste
   * rattrapé plus bas, avec un message compréhensible).
   */
  validable?: boolean;
}

/**
 * Édite les besoins d'**un contrat** (un enfant × un mode) sur la semaine, puis
 * permet de **valider** ce contrat — la validation reste par contrat (décision
 * produit). Les saisies sont enregistrées en debounce (fusion mois côté serveur).
 */
export function EditeurContratSemaine({
  contrat,
  jours,
  semaineIso,
  onEnregistre,
  onValide,
  validable = true,
}: EditeurContratSemaineProps) {
  const handleEnregistre = useCallback(() => {
    onEnregistre?.();
  }, [onEnregistre]);
  const {
    etat: etatSave,
    erreur,
    enregistreA,
    ecrire,
    reessayer,
  } = useEcritureSemaine(handleEnregistre);
  const { annoncer, regionLiveProps } = useAnnonce();

  const [besoins, setBesoins] = useState<BesoinsEtat>(() =>
    initBesoins(contrat),
  );
  const mode = contrat.mode;

  const index = useMemo(() => indexerBesoins(besoins), [besoins]);

  const enregistrer = useCallback(
    (suivant: BesoinsEtat) => {
      setBesoins(suivant);
      ecrire(contrat.contratId, semaineIso, versCorps(suivant));
    },
    [ecrire, contrat.contratId, semaineIso],
  );

  // --- Modale d'édition d'un jour -------------------------------------------
  const [dialogDate, setDialogDate] = useState<string | null>(null);
  const [form, setForm] = useState<FormJour>(FORM_DEFAUT);

  const ouvrir = useCallback(
    (date: string) => {
      const f: FormJour = { ...FORM_DEFAUT };
      if (mode === 'CRECHE_PSU') {
        // Jour gardé : préremplir avec la plage du contrat (heures réelles) ; sinon
        // laisser les heures par défaut (« jour ajouté »). Une saisie existante prime.
        const base = plageContratPremiere(contrat, date);
        if (base) {
          f.arrivee = base.arrivee;
          f.depart = base.depart;
        }
        const aj = index.ajustements.get(date);
        const abs = index.absences.get(date);
        const sup = index.joursSup.get(date);
        if (aj) {
          f.arrivee = versHhmm(aj.debutHeures, aj.debutMinutes);
          f.depart = versHhmm(aj.finHeures, aj.finMinutes);
          f.preavisJours = aj.preavisJours;
          f.certificatMaladie = aj.certificatMaladie;
        } else if (abs && base) {
          // Jour gardé avec absence existante (dont partielles historiques) →
          // « Absent toute la journée » ; sa fenêtre n'est plus éditée.
          f.absentJournee = true;
          f.preavisJours = abs.preavisJours;
          f.certificatMaladie = abs.certificatMaladie;
        } else if (sup) {
          f.arrivee = versHhmm(sup.debutHeures, sup.debutMinutes);
          f.depart = versHhmm(sup.finHeures, sup.finMinutes);
        } else if (abs) {
          // Jour non gardé avec absence héritée : sa fenêtre devient un jour ajouté.
          f.arrivee = versHhmm(abs.debutHeures, abs.debutMinutes);
          f.depart = versHhmm(abs.finHeures, abs.finMinutes);
        }
      } else if (mode === 'ALSH') {
        // Préremplit depuis l'état EFFECTIF (explicite > exception > récurrence),
        // pour que « Modifier » reparte de ce qui est réservé ce jour-là.
        const j = alshEffectif(
          date,
          index.joursAlsh.get(date),
          index.exceptions.get(date),
          contrat.semaineAbcm,
        );
        if (j) {
          f.type = j.type;
          f.repas = j.repas ?? false;
        }
      } else {
        const e = index.exceptions.get(date);
        if (e) {
          f.cantine = e.cantine ?? false;
          f.matin = e.periMatin ?? false;
          f.soir = e.periSoir ?? false;
        }
      }
      setForm(f);
      setDialogDate(date);
    },
    [mode, contrat, index],
  );

  const fermer = useCallback(() => {
    setDialogDate(null);
  }, []);

  const plageOk = plageValide(form.arrivee, form.depart);

  // Repère « jour gardé » + état déduit de la présence réelle (crèche), recalculés
  // en direct pour la ligne d'annonce (aria-live) et la logique de confirmation.
  const plageContratDialog =
    dialogDate !== null ? plageContratPremiere(contrat, dialogDate) : null;
  const etatDeduit = useMemo<EtatDeduit | null>(() => {
    if (plageContratDialog === null || !plageOk) return null;
    return etatDeduitAjustement(form.arrivee, form.depart, plageContratDialog);
  }, [plageContratDialog, plageOk, form.arrivee, form.depart]);

  const confirmer = useCallback(() => {
    if (dialogDate === null) return;
    const date = dialogDate;
    if (mode === 'CRECHE_PSU') {
      const base = plageContratPremiere(contrat, date);
      // Une seule saisie par jour (A3) : on repart d'un jour « propre ».
      const absences = besoins.absences.filter((a) => a.date !== date);
      const joursSup = besoins.joursSup.filter((j) => j.date !== date);
      const ajustements = besoins.ajustements.filter((a) => a.date !== date);

      if (base !== null) {
        // Jour gardé : absence pleine journée, ajustement d'heures réelles, ou rien.
        if (form.absentJournee) {
          absences.push({
            date,
            ...plageDepuisHeures(base.arrivee, base.depart),
            preavisJours: form.preavisJours,
            certificatMaladie: form.certificatMaladie,
          });
          enregistrer({ ...besoins, absences, joursSup, ajustements });
          annoncer(`Absence enregistrée le ${formaterDateFr(date)}`);
        } else {
          if (!plageOk) return;
          const etat = etatDeduitAjustement(form.arrivee, form.depart, base);
          if (!etat.identique) {
            ajustements.push({
              date,
              ...plageDepuisHeures(form.arrivee, form.depart),
              // Préavis/certificat ne pèsent que sur une réduction déductible ;
              // une extension pure part sans (0 / false).
              preavisJours: etat.reductionPresente ? form.preavisJours : 0,
              certificatMaladie: etat.reductionPresente
                ? form.certificatMaladie
                : false,
            });
            annoncer(`Horaires ajustés le ${formaterDateFr(date)}`);
          } else {
            // Horaires habituels : Confirmer nettoie une éventuelle saisie du jour.
            annoncer(`Horaires habituels le ${formaterDateFr(date)}`);
          }
          enregistrer({ ...besoins, absences, joursSup, ajustements });
        }
      } else {
        // Jour non gardé : c'est un « jour ajouté ».
        if (!plageOk) return;
        joursSup.push({
          date,
          ...plageDepuisHeures(form.arrivee, form.depart),
        });
        enregistrer({ ...besoins, absences, joursSup, ajustements });
        annoncer(`Jour ajouté le ${formaterDateFr(date)}`);
      }
    } else if (mode === 'ALSH') {
      // Confirmer pose un jour EXPLICITE (il prime sur la récurrence) et lève une
      // éventuelle exception `alsh:false` de ce jour, devenue sans objet.
      const joursAlsh = besoins.joursAlsh.filter((j) => j.date !== date);
      joursAlsh.push({ date, type: form.type, repas: form.repas });
      const exceptions = besoins.exceptions.filter((e) => e.date !== date);
      enregistrer({ ...besoins, joursAlsh, exceptions });
      annoncer(`Journée ALSH enregistrée le ${formaterDateFr(date)}`);
    } else {
      const reste = besoins.exceptions.filter((e) => e.date !== date);
      const exc: ExceptionAbcm =
        mode === 'CANTINE'
          ? { date, cantine: form.cantine }
          : { date, periMatin: form.matin, periSoir: form.soir };
      enregistrer({ ...besoins, exceptions: [...reste, exc] });
      annoncer(`Jour ajusté le ${formaterDateFr(date)}`);
    }
    setDialogDate(null);
  }, [
    dialogDate,
    mode,
    plageOk,
    form,
    besoins,
    enregistrer,
    annoncer,
    contrat,
  ]);

  const supprimer = useCallback(() => {
    if (dialogDate === null) return;
    const date = dialogDate;
    if (mode === 'CRECHE_PSU') {
      enregistrer({
        ...besoins,
        absences: besoins.absences.filter((a) => a.date !== date),
        joursSup: besoins.joursSup.filter((j) => j.date !== date),
        ajustements: besoins.ajustements.filter((a) => a.date !== date),
      });
    } else if (mode === 'ALSH') {
      // Retire le jour effectif : on lève le jour explicite, puis — si la
      // récurrence hebdomadaire réserverait encore ce jour — on pose une exception
      // `alsh:false` pour la neutraliser ; sinon on nettoie l'exception résiduelle.
      const joursAlsh = besoins.joursAlsh.filter((j) => j.date !== date);
      const reste = besoins.exceptions.filter((e) => e.date !== date);
      const recurrent = contrat.semaineAbcm?.[jourSemaineDeIso(date)]?.alsh;
      const exceptions = recurrent ? [...reste, { date, alsh: false }] : reste;
      enregistrer({ ...besoins, joursAlsh, exceptions });
    } else {
      enregistrer({
        ...besoins,
        exceptions: besoins.exceptions.filter((e) => e.date !== date),
      });
    }
    setDialogDate(null);
    annoncer(`Saisie retirée le ${formaterDateFr(date)}`);
  }, [dialogDate, mode, besoins, enregistrer, annoncer, contrat.semaineAbcm]);

  // --- Validation par contrat (comportement inchangé) -----------------------
  const [messageValidation, setMessageValidation] = useState<string | null>(
    null,
  );
  const [enValidation, setEnValidation] = useState(false);

  const valider = useCallback(async () => {
    setEnValidation(true);
    setMessageValidation(null);
    try {
      const r = await api.validerSemaine(contrat.contratId, semaineIso);
      setMessageValidation(
        r.statut === 'VALIDEE_AVEC_MODIFS'
          ? 'Semaine validée (avec modifications).'
          : 'Semaine validée.',
      );
      onValide?.(r.statut);
    } catch (err) {
      // 404 = cette semaine n'a jamais été proposée à la validation pour ce
      // contrat (aucun rappel du mardi ne l'a notifiée). Ce n'est PAS une panne,
      // et « Ressource introuvable » — ce que le mapping générique affichait —
      // ne dit rien à un parent qui vient d'enregistrer sa semaine. On nomme la
      // situation, et on rassure sur ce qui a bien été fait.
      setMessageValidation(
        err instanceof ApiError && err.status === 404
          ? RIEN_A_VALIDER
          : messageErreur(err),
      );
    } finally {
      setEnValidation(false);
    }
  }, [contrat.contratId, semaineIso, onValide]);

  return (
    <div className="mb-3">
      <p {...regionLiveProps} className="sr-only" />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          flexWrap: 'wrap',
        }}
      >
        <h5 style={{ margin: '0.25rem 0' }}>
          {contrat.enfant} — {libelleMode(mode)}
        </h5>
        <StatutSauvegarde etat={etatSave} enregistreA={enregistreA} />
        {etatSave === 'erreur' && (
          <>
            {erreur && (
              <span className="muted" style={{ fontSize: '0.82rem' }}>
                {erreur}
              </span>
            )}
            <Bouton variante="secondaire" onClick={reessayer}>
              Réessayer
            </Bouton>
          </>
        )}
      </div>

      <ul className="jours-liste">
        {jours.map((date) => {
          const jour = jourSemaineDeIso(date);
          // Libellé complet (desktop + aria-label daté, dont des tests dépendent)
          // et libellé abrégé (mobile, place limitée) ; la bascule visible se fait
          // en CSS via deux <span> (cf. .jour-libelle-court / -long dans styles.css).
          const libelleJour = `${LIBELLES_JOURS[jour]} ${formaterDateFr(date)}`;
          const libelleCourt = `${LIBELLES_JOURS_COURT[jour]} ${formaterDateCourtFr(date)}`;
          const action = aSaisieJour(contrat, index, date)
            ? 'Modifier'
            : 'Saisir';
          return (
            <li key={date} className="jour-rangee">
              <span className="jour-libelle">
                <span className="jour-libelle-court">{libelleCourt}</span>
                <span className="jour-libelle-long">{libelleJour}</span>
              </span>
              <span className="muted jour-resume">
                {resumeJour(contrat, index, date)}
              </span>
              <Bouton
                variante="secondaire"
                className="jour-action"
                onClick={() => {
                  ouvrir(date);
                }}
                aria-label={`${action} le ${libelleJour}`}
              >
                {action}
              </Bouton>
            </li>
          );
        })}
      </ul>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          flexWrap: 'wrap',
        }}
      >
        {validable ? (
          <Bouton
            onClick={() => {
              void valider();
            }}
            disabled={enValidation || etatSave === 'en-cours'}
            // L'éditeur hebdo empile un bloc par contrat : plusieurs boutons
            // « Valider » coexistent. Le suffixe enfant/mode rend chaque cible
            // unique pour les technologies d'assistance (même pattern que
            // `ariaLabel()` dans EncartValidation).
            aria-label={`Valider la ${libelleSemaine(semaineIso)} — ${contrat.enfant}, ${libelleMode(mode)}`}
          >
            {enValidation ? 'Validation…' : 'Valider'}
          </Bouton>
        ) : (
          // Aucune semaine à valider pour ce contrat : on n'offre pas une action
          // qui ne peut que échouer. Un contrat créé après le rappel du mardi
          // (celui de la rentrée, par exemple) est dans ce cas.
          <span className="muted">{RIEN_A_VALIDER}</span>
        )}
        {messageValidation !== null && (
          <span className="credit" role="status">
            {messageValidation}
          </span>
        )}
      </div>

      {/* Le récap au service est désormais **agrégé par établissement** (Phase 4) :
          il est rendu une seule fois par l'éditeur parent (`EditeurSemaine`) dès qu'un
          contrat passe en `VALIDEE_AVEC_MODIFS`, et non plus par contrat ici. */}

      {dialogDate !== null && (
        <ModaleJourSemaine
          enfant={contrat.enfant}
          date={dialogDate}
          mode={mode}
          form={form}
          setForm={setForm}
          plageOk={plageOk}
          estGarde={plageContratDialog !== null}
          etatDeduit={etatDeduit}
          aSaisie={aSaisieJour(contrat, index, dialogDate)}
          onConfirmer={confirmer}
          onSupprimer={supprimer}
          onFermer={fermer}
        />
      )}
    </div>
  );
}
