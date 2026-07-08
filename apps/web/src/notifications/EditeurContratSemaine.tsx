import {
  useCallback,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { api } from '../api/client';
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
import { Modale } from '../ui/Modale';
import { StatutSauvegarde } from '../ui/StatutSauvegarde';
import { useAnnonce } from '../hooks/useAnnonce';
import {
  ARRIVEE_DEFAUT,
  DEPART_DEFAUT,
  versHhmm,
  minutesDeHhmm,
  plageDepuisHeures,
  plageValide,
  formaterPlage,
} from '../planning/heures';
import { classerAjustement } from '../planning/etatJourGarde';
import { useEcritureSemaine } from './useEcritureSemaine';
import {
  alshEffectif,
  initBesoins,
  libelleAlsh,
  versCorps,
  type BesoinsEtat,
} from './besoinsSemaine';

// Édition des besoins **datés** d'un contrat sur la seule semaine notifiée. Le BFF
// fournit désormais aussi le planning de BASE (semaine-type) : sur un jour gardé
// crèche, on saisit donc les heures d'arrivée/départ RÉELLES (préremplies avec le
// contrat) et l'app en déduit l'état (extension facturée / réduction déductible),
// écrit comme une entrée `ajustements`. Sur un jour non gardé, c'est un « jour
// ajouté ». L'aplatissement/reconstruction des besoins vit dans `besoinsSemaine.ts`.

/** Forme de la modale d'édition d'un jour (champs selon le mode). */
interface FormJour {
  /** Crèche, jour gardé : absence pleine journée (vs saisie d'heures réelles). */
  absentJournee: boolean;
  arrivee: string;
  depart: string;
  preavisJours: number;
  certificatMaladie: boolean;
  cantine: boolean;
  matin: boolean;
  soir: boolean;
  type: 'COMPLETE' | 'DEMI';
  repas: boolean;
}

const FORM_DEFAUT: FormJour = {
  absentJournee: false,
  arrivee: ARRIVEE_DEFAUT,
  depart: DEPART_DEFAUT,
  preavisJours: 0,
  certificatMaladie: false,
  cantine: false,
  matin: false,
  soir: false,
  type: 'COMPLETE',
  repas: false,
};

/** Durée lisible d'un écart d'horaire : « 45 min », « 1 h », « 1 h 30 ». */
function formaterDuree(minutes: number): string {
  const heures = Math.floor(minutes / 60);
  const reste = minutes % 60;
  if (heures === 0) return `${reste} min`;
  if (reste === 0) return `${heures} h`;
  return `${heures} h ${reste}`;
}

/** État déduit d'une plage de présence réelle au regard de la plage de contrat. */
interface EtatDeduit {
  /** Une réduction (candidate à déduction) est présente → poser préavis/certificat. */
  readonly reductionPresente: boolean;
  /** L'entrée est sans effet (présence = plage de contrat) → rien à enregistrer. */
  readonly identique: boolean;
  /** Message annoncé sous les champs (aria-live), au mot près. */
  readonly message: string;
}

/**
 * Décrit, en mots de parent, l'écart entre la présence réelle saisie et la plage de
 * garde contractuelle du jour : **extension** (minutes hors plage → facturées en
 * complément), **réduction** (minutes de la plage non couvertes → candidate à
 * déduction), les deux, ou rien. Pure : alimente la ligne d'état de la modale.
 * Durées comparées en minutes depuis minuit ; libellés au mot près (plan Lot 2b).
 */
function etatDeduitAjustement(
  arrivee: string,
  depart: string,
  base: { arrivee: string; depart: string },
): EtatDeduit {
  const arriveeContrat = minutesDeHhmm(base.arrivee);
  const departContrat = minutesDeHhmm(base.depart);
  const arriveeReelle = minutesDeHhmm(arrivee);
  const departReel = minutesDeHhmm(depart);
  const extension =
    Math.max(0, arriveeContrat - arriveeReelle) +
    Math.max(0, departReel - departContrat);
  const reduction =
    Math.max(0, arriveeReelle - arriveeContrat) +
    Math.max(0, departContrat - departReel);
  const habituel = `${base.arrivee}–${base.depart}`;

  if (extension > 0 && reduction > 0) {
    return {
      reductionPresente: true,
      identique: false,
      message: `Horaires ajustés (${habituel} habituellement) : ${formaterDuree(
        extension,
      )} en plus (facturés en complément), ${formaterDuree(reduction)} en moins.`,
    };
  }
  if (extension > 0) {
    return {
      reductionPresente: false,
      identique: false,
      message: `${formaterDuree(
        extension,
      )} de plus que les horaires habituels (${habituel}) — facturé en complément.`,
    };
  }
  if (reduction > 0) {
    return {
      reductionPresente: true,
      identique: false,
      message: `${formaterDuree(
        reduction,
      )} de moins que les horaires habituels (${habituel}).`,
    };
  }
  return {
    reductionPresente: false,
    identique: true,
    message: 'Horaires habituels — rien à enregistrer.',
  };
}

/** Champs heure d'arrivée / départ + message de plage invalide (crèche). */
function ChampsHeuresPresence({
  form,
  setForm,
  plageOk,
}: {
  form: FormJour;
  setForm: Dispatch<SetStateAction<FormJour>>;
  plageOk: boolean;
}) {
  return (
    <>
      <div
        style={{
          display: 'flex',
          gap: '0.75rem',
          flexWrap: 'wrap',
          marginTop: '0.5rem',
        }}
      >
        <label>
          Heure d’arrivée
          <input
            type="time"
            value={form.arrivee}
            onChange={(e) => {
              setForm((f) => ({ ...f, arrivee: e.target.value }));
            }}
          />
        </label>
        <label>
          Heure de départ
          <input
            type="time"
            value={form.depart}
            onChange={(e) => {
              setForm((f) => ({ ...f, depart: e.target.value }));
            }}
          />
        </label>
      </div>
      {!plageOk && (
        <div
          className="muted"
          style={{ fontSize: '0.8rem', marginTop: '0.4rem' }}
        >
          L’heure de départ doit être postérieure à l’arrivée.
        </div>
      )}
    </>
  );
}

/** Questions préavis + certificat, communes à l'absence et à la réduction d'heures. */
function ChampsPreavisCertificat({
  form,
  setForm,
}: {
  form: FormJour;
  setForm: Dispatch<SetStateAction<FormJour>>;
}) {
  return (
    <>
      <label>
        Signalée combien de jours à l’avance ?
        <input
          type="number"
          min={0}
          value={form.preavisJours}
          onChange={(e) => {
            setForm((f) => ({
              ...f,
              preavisJours: parseInt(e.target.value, 10) || 0,
            }));
          }}
        />
      </label>
      <label
        style={{
          flexDirection: 'row',
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
          marginTop: '0.5rem',
        }}
      >
        <input
          type="checkbox"
          checked={form.certificatMaladie}
          onChange={(e) => {
            setForm((f) => ({
              ...f,
              certificatMaladie: e.target.checked,
            }));
          }}
          style={{ width: 'auto', padding: 0 }}
        />
        Certificat médical
      </label>
    </>
  );
}

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

  // Index par date pour l'affichage des rangées.
  const absenceParDate = useMemo(
    () => new Map(besoins.absences.map((a) => [a.date, a])),
    [besoins.absences],
  );
  const jourSupParDate = useMemo(
    () => new Map(besoins.joursSup.map((j) => [j.date, j])),
    [besoins.joursSup],
  );
  const ajustementParDate = useMemo(
    () => new Map(besoins.ajustements.map((a) => [a.date, a])),
    [besoins.ajustements],
  );
  const exceptionParDate = useMemo(
    () => new Map(besoins.exceptions.map((e) => [e.date, e])),
    [besoins.exceptions],
  );
  const alshParDate = useMemo(
    () => new Map(besoins.joursAlsh.map((j) => [j.date, j])),
    [besoins.joursAlsh],
  );

  const enregistrer = useCallback(
    (suivant: BesoinsEtat) => {
      setBesoins(suivant);
      ecrire(contrat.contratId, semaineIso, versCorps(suivant));
    },
    [ecrire, contrat.contratId, semaineIso],
  );

  // Plage de garde contractuelle (1re plage de la semaine-type) d'un jour crèche →
  // `{ arrivee, depart }` en `HH:MM`, ou `null` si le jour n'est pas gardé. Sert de
  // repère « jour gardé » et de préremplissage des heures réelles.
  const plageContratPremiere = useCallback(
    (date: string): { arrivee: string; depart: string } | null => {
      const base = contrat.semaineType?.[jourSemaineDeIso(date)]?.[0];
      if (base === undefined) return null;
      return {
        arrivee: versHhmm(base.debutHeures, base.debutMinutes),
        depart: versHhmm(base.finHeures, base.finMinutes),
      };
    },
    [contrat.semaineType],
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
        const base = plageContratPremiere(date);
        if (base) {
          f.arrivee = base.arrivee;
          f.depart = base.depart;
        }
        const aj = ajustementParDate.get(date);
        const abs = absenceParDate.get(date);
        const sup = jourSupParDate.get(date);
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
          alshParDate.get(date),
          exceptionParDate.get(date),
          contrat.semaineAbcm,
        );
        if (j) {
          f.type = j.type;
          f.repas = j.repas ?? false;
        }
      } else {
        const e = exceptionParDate.get(date);
        if (e) {
          f.cantine = e.cantine ?? false;
          f.matin = e.periMatin ?? false;
          f.soir = e.periSoir ?? false;
        }
      }
      setForm(f);
      setDialogDate(date);
    },
    [
      mode,
      absenceParDate,
      jourSupParDate,
      ajustementParDate,
      alshParDate,
      exceptionParDate,
      contrat.semaineAbcm,
      plageContratPremiere,
    ],
  );

  const fermer = useCallback(() => {
    setDialogDate(null);
  }, []);

  const plageOk = plageValide(form.arrivee, form.depart);

  // Repère « jour gardé » + état déduit de la présence réelle (crèche), recalculés
  // en direct pour la ligne d'annonce (aria-live) et la logique de confirmation.
  const plageContratDialog =
    dialogDate !== null ? plageContratPremiere(dialogDate) : null;
  const estGardeDialog = plageContratDialog !== null;
  const etatDeduit = useMemo<EtatDeduit | null>(() => {
    if (plageContratDialog === null || !plageOk) return null;
    return etatDeduitAjustement(form.arrivee, form.depart, plageContratDialog);
  }, [plageContratDialog, plageOk, form.arrivee, form.depart]);

  const confirmer = useCallback(() => {
    if (dialogDate === null) return;
    const date = dialogDate;
    if (mode === 'CRECHE_PSU') {
      const base = plageContratPremiere(date);
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
    plageContratPremiere,
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

  const aSaisie = useCallback(
    (date: string): boolean => {
      if (mode === 'CRECHE_PSU') {
        return (
          absenceParDate.has(date) ||
          jourSupParDate.has(date) ||
          ajustementParDate.has(date)
        );
      }
      if (mode === 'ALSH') {
        // « Modifier » dès qu'un jour est réservé effectivement (explicite ou
        // récurrence active) → la modale propose alors « Supprimer ».
        return (
          alshEffectif(
            date,
            alshParDate.get(date),
            exceptionParDate.get(date),
            contrat.semaineAbcm,
          ) !== null
        );
      }
      return exceptionParDate.has(date);
    },
    [
      mode,
      absenceParDate,
      jourSupParDate,
      ajustementParDate,
      alshParDate,
      exceptionParDate,
      contrat.semaineAbcm,
    ],
  );

  // Affiche l'horaire EFFECTIF du jour, sans ouvrir la saisie : une entrée datée
  // (ajustement / absence / jour ajouté) prime ; à défaut, on retombe sur le planning
  // de BASE du contrat (semaine-type) pour ce jour de la semaine ; sinon « — ».
  const resume = useCallback(
    (date: string): string => {
      const jour = jourSemaineDeIso(date);
      if (mode === 'CRECHE_PSU') {
        const aj = ajustementParDate.get(date);
        if (aj) {
          const classe = classerAjustement(aj, plageContratPremiere(date));
          return `${classe.libelle} ${classe.presence}`;
        }
        const abs = absenceParDate.get(date);
        if (abs) return `Absent (${formaterPlage(abs)})`;
        const sup = jourSupParDate.get(date);
        if (sup) return `Jour ajouté (${formaterPlage(sup)})`;
        const base = contrat.semaineType?.[jour];
        if (base && base.length > 0) {
          return `Gardé ${base.map(formaterPlage).join(', ')}`;
        }
        return '—';
      }
      if (mode === 'ALSH') {
        const j = alshEffectif(
          date,
          alshParDate.get(date),
          exceptionParDate.get(date),
          contrat.semaineAbcm,
        );
        return j ? libelleAlsh(j) : '—';
      }
      const e = exceptionParDate.get(date);
      const base = contrat.semaineAbcm?.[jour];
      if (mode === 'CANTINE') {
        if (e) return e.cantine ? 'Cantine' : 'Sans cantine';
        return base?.cantine ? 'Cantine' : '—';
      }
      const matin = e ? (e.periMatin ?? false) : (base?.periMatin ?? false);
      const soir = e ? (e.periSoir ?? false) : (base?.periSoir ?? false);
      const parts: string[] = [];
      if (matin) parts.push('matin');
      if (soir) parts.push('soir');
      if (parts.length > 0) return `Péri ${parts.join(' + ')}`;
      return e ? 'Sans péri' : '—';
    },
    [
      mode,
      absenceParDate,
      jourSupParDate,
      ajustementParDate,
      alshParDate,
      exceptionParDate,
      contrat.semaineType,
      contrat.semaineAbcm,
      plageContratPremiere,
    ],
  );

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
      setMessageValidation(messageErreur(err));
    } finally {
      setEnValidation(false);
    }
  }, [contrat.contratId, semaineIso, onValide]);

  return (
    <div style={{ marginBottom: '0.75rem' }}>
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
            <button
              type="button"
              className="btn secondaire"
              onClick={reessayer}
            >
              Réessayer
            </button>
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
          return (
            <li key={date} className="jour-rangee">
              <span className="jour-libelle">
                <span className="jour-libelle-court">{libelleCourt}</span>
                <span className="jour-libelle-long">{libelleJour}</span>
              </span>
              <span className="muted jour-resume">{resume(date)}</span>
              <button
                type="button"
                className="btn secondaire jour-action"
                onClick={() => {
                  ouvrir(date);
                }}
                aria-label={`${aSaisie(date) ? 'Modifier' : 'Saisir'} le ${libelleJour}`}
              >
                {aSaisie(date) ? 'Modifier' : 'Saisir'}
              </button>
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
        <button
          type="button"
          className="btn"
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
        </button>
        {messageValidation !== null && (
          <span className="credit" role="status">
            {messageValidation}
          </span>
        )}
      </div>

      {/* Le récap au service est désormais **agrégé par établissement** (Phase 4) :
          il est rendu une seule fois par l'éditeur parent (`EditeurSemaine`) dès qu'un
          contrat passe en `VALIDEE_AVEC_MODIFS`, et non plus par contrat ici. */}

      {/* Modale d'édition d'un jour (champs selon le mode du contrat). */}
      {dialogDate !== null && (
        <Modale
          titre={`${contrat.enfant} — ${formaterDateFr(dialogDate)}`}
          onClose={fermer}
        >
          {mode === 'CRECHE_PSU' && estGardeDialog && (
            <>
              {/* Jour gardé : heures réelles (l'app déduit l'état), ou absence
                  pleine journée. Le radio Absence/Jour ajouté d'antan disparaît. */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  margin: 0,
                }}
              >
                <input
                  type="checkbox"
                  checked={form.absentJournee}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, absentJournee: e.target.checked }));
                  }}
                  style={{ width: 'auto', padding: 0 }}
                />
                Absent toute la journée
              </label>

              {form.absentJournee ? (
                <ChampsPreavisCertificat form={form} setForm={setForm} />
              ) : (
                <>
                  <ChampsHeuresPresence
                    form={form}
                    setForm={setForm}
                    plageOk={plageOk}
                  />
                  {/* État déduit annoncé en direct (durée + effet facturation). */}
                  <p
                    aria-live="polite"
                    className="muted"
                    style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}
                  >
                    {etatDeduit?.message ?? ''}
                  </p>
                  {etatDeduit?.reductionPresente === true && (
                    <ChampsPreavisCertificat form={form} setForm={setForm} />
                  )}
                </>
              )}
            </>
          )}

          {mode === 'CRECHE_PSU' && !estGardeDialog && (
            // Jour non gardé : implicitement un « jour ajouté » (heures par défaut).
            <ChampsHeuresPresence
              form={form}
              setForm={setForm}
              plageOk={plageOk}
            />
          )}

          {mode === 'CANTINE' && (
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                margin: 0,
              }}
            >
              <input
                type="checkbox"
                checked={form.cantine}
                onChange={(e) => {
                  setForm((f) => ({ ...f, cantine: e.target.checked }));
                }}
                style={{ width: 'auto', padding: 0 }}
              />
              Cantine
            </label>
          )}

          {mode === 'PERISCOLAIRE' && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.3rem',
              }}
            >
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  margin: 0,
                }}
              >
                <input
                  type="checkbox"
                  checked={form.matin}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, matin: e.target.checked }));
                  }}
                  style={{ width: 'auto', padding: 0 }}
                />
                Matin
              </label>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  margin: 0,
                }}
              >
                <input
                  type="checkbox"
                  checked={form.soir}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, soir: e.target.checked }));
                  }}
                  style={{ width: 'auto', padding: 0 }}
                />
                Soir
              </label>
            </div>
          )}

          {mode === 'ALSH' && (
            <>
              <label>
                Type
                <select
                  value={form.type}
                  onChange={(e) => {
                    setForm((f) => ({
                      ...f,
                      type: e.target.value as 'COMPLETE' | 'DEMI',
                    }));
                  }}
                >
                  <option value="COMPLETE">Journée complète</option>
                  <option value="DEMI">Demi-journée</option>
                </select>
              </label>
              <label
                style={{
                  flexDirection: 'row',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  marginTop: '0.5rem',
                }}
              >
                <input
                  type="checkbox"
                  checked={form.repas}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, repas: e.target.checked }));
                  }}
                  style={{ width: 'auto', padding: 0 }}
                />
                Repas inclus
              </label>
            </>
          )}

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            <button
              type="button"
              className="btn"
              onClick={confirmer}
              // Une plage valide n'est requise que si l'on saisit des heures
              // (jour gardé sans « absent », ou jour ajouté) ; l'absence pleine
              // journée n'en dépend pas.
              disabled={
                mode === 'CRECHE_PSU' && !form.absentJournee && !plageOk
              }
            >
              Confirmer
            </button>
            {aSaisie(dialogDate) && (
              <button
                type="button"
                className="btn secondaire"
                onClick={supprimer}
              >
                Supprimer
              </button>
            )}
            <button type="button" className="btn secondaire" onClick={fermer}>
              Annuler
            </button>
          </div>
        </Modale>
      )}
    </div>
  );
}
