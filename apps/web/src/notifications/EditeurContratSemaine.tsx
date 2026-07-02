import { useCallback, useMemo, useState } from 'react';
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
  plageDepuisHeures,
  plageValide,
  formaterPlage,
} from '../planning/heures';
import { useEcritureSemaine } from './useEcritureSemaine';
import { initBesoins, versCorps, type BesoinsEtat } from './besoinsSemaine';

// Édition des besoins **datés** d'un contrat sur la seule semaine notifiée.
// Contrairement aux calendriers mensuels, la vue hebdomadaire ne connaît pas la
// semaine-type du contrat (le BFF ne renvoie que les entrées datées) : on édite
// donc directement ces entrées, jour par jour, sans repère « jour gardé ».
// L'aplatissement/reconstruction des besoins vit dans `besoinsSemaine.ts` (pur).

/** Forme de la modale d'édition d'un jour (champs selon le mode). */
interface FormJour {
  nature: 'absence' | 'ajout';
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
  nature: 'absence',
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
    ecrire,
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

  // --- Modale d'édition d'un jour -------------------------------------------
  const [dialogDate, setDialogDate] = useState<string | null>(null);
  const [form, setForm] = useState<FormJour>(FORM_DEFAUT);

  const ouvrir = useCallback(
    (date: string) => {
      const f: FormJour = { ...FORM_DEFAUT };
      if (mode === 'CRECHE_PSU') {
        const abs = absenceParDate.get(date);
        const sup = jourSupParDate.get(date);
        if (abs) {
          f.nature = 'absence';
          f.arrivee = versHhmm(abs.debutHeures, abs.debutMinutes);
          f.depart = versHhmm(abs.finHeures, abs.finMinutes);
          f.preavisJours = abs.preavisJours;
          f.certificatMaladie = abs.certificatMaladie;
        } else if (sup) {
          f.nature = 'ajout';
          f.arrivee = versHhmm(sup.debutHeures, sup.debutMinutes);
          f.depart = versHhmm(sup.finHeures, sup.finMinutes);
        }
      } else if (mode === 'ALSH') {
        const j = alshParDate.get(date);
        if (j) {
          f.type = j.type;
          f.repas = j.repas;
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
    [mode, absenceParDate, jourSupParDate, alshParDate, exceptionParDate],
  );

  const fermer = useCallback(() => {
    setDialogDate(null);
  }, []);

  const plageOk = plageValide(form.arrivee, form.depart);

  const confirmer = useCallback(() => {
    if (dialogDate === null) return;
    const date = dialogDate;
    if (mode === 'CRECHE_PSU') {
      if (!plageOk) return;
      const plage = plageDepuisHeures(form.arrivee, form.depart);
      const absences = besoins.absences.filter((a) => a.date !== date);
      const joursSup = besoins.joursSup.filter((j) => j.date !== date);
      if (form.nature === 'absence') {
        absences.push({
          date,
          ...plage,
          preavisJours: form.preavisJours,
          certificatMaladie: form.certificatMaladie,
        });
      } else {
        joursSup.push({ date, ...plage });
      }
      enregistrer({ ...besoins, absences, joursSup });
      annoncer(
        `${form.nature === 'absence' ? 'Absence' : 'Jour ajouté'} enregistré le ${formaterDateFr(date)}`,
      );
    } else if (mode === 'ALSH') {
      const joursAlsh = besoins.joursAlsh.filter((j) => j.date !== date);
      joursAlsh.push({ date, type: form.type, repas: form.repas });
      enregistrer({ ...besoins, joursAlsh });
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
  }, [dialogDate, mode, plageOk, form, besoins, enregistrer, annoncer]);

  const supprimer = useCallback(() => {
    if (dialogDate === null) return;
    const date = dialogDate;
    if (mode === 'CRECHE_PSU') {
      enregistrer({
        ...besoins,
        absences: besoins.absences.filter((a) => a.date !== date),
        joursSup: besoins.joursSup.filter((j) => j.date !== date),
      });
    } else if (mode === 'ALSH') {
      enregistrer({
        ...besoins,
        joursAlsh: besoins.joursAlsh.filter((j) => j.date !== date),
      });
    } else {
      enregistrer({
        ...besoins,
        exceptions: besoins.exceptions.filter((e) => e.date !== date),
      });
    }
    setDialogDate(null);
    annoncer(`Saisie retirée le ${formaterDateFr(date)}`);
  }, [dialogDate, mode, besoins, enregistrer, annoncer]);

  const aSaisie = useCallback(
    (date: string): boolean => {
      if (mode === 'CRECHE_PSU') {
        return absenceParDate.has(date) || jourSupParDate.has(date);
      }
      if (mode === 'ALSH') return alshParDate.has(date);
      return exceptionParDate.has(date);
    },
    [mode, absenceParDate, jourSupParDate, alshParDate, exceptionParDate],
  );

  // Affiche l'horaire EFFECTIF du jour, sans ouvrir la saisie : une exception datée
  // (absence / jour ajouté / ajustement) prime ; à défaut, on retombe sur le planning
  // de BASE du contrat (semaine-type) pour ce jour de la semaine ; sinon « — ».
  const resume = useCallback(
    (date: string): string => {
      const jour = jourSemaineDeIso(date);
      if (mode === 'CRECHE_PSU') {
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
        const j = alshParDate.get(date);
        if (!j) return '—';
        if (j.type === 'DEMI') return 'Demi-journée';
        return j.repas ? 'Journée + repas' : 'Journée';
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
      alshParDate,
      exceptionParDate,
      contrat.semaineType,
      contrat.semaineAbcm,
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

  const etatStatut =
    etatSave === 'enregistre' || etatSave === 'erreur' ? etatSave : 'idle';

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
        <StatutSauvegarde etat={etatStatut} />
        {etatSave === 'erreur' && erreur && (
          <span className="muted" style={{ fontSize: '0.82rem' }}>
            {erreur}
          </span>
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
          {mode === 'CRECHE_PSU' && (
            <>
              <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
                <legend className="muted" style={{ fontSize: '0.85rem' }}>
                  Nature
                </legend>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    margin: 0,
                  }}
                >
                  <input
                    type="radio"
                    name="nature-jour"
                    checked={form.nature === 'absence'}
                    onChange={() => {
                      setForm((f) => ({ ...f, nature: 'absence' }));
                    }}
                    style={{ width: 'auto', padding: 0 }}
                  />
                  Absence
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
                    type="radio"
                    name="nature-jour"
                    checked={form.nature === 'ajout'}
                    onChange={() => {
                      setForm((f) => ({ ...f, nature: 'ajout' }));
                    }}
                    style={{ width: 'auto', padding: 0 }}
                  />
                  Jour ajouté
                </label>
              </fieldset>

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
              {form.nature === 'absence' && (
                <>
                  <label>
                    Préavis (jours)
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
              )}
            </>
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
              disabled={mode === 'CRECHE_PSU' && !plageOk}
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
