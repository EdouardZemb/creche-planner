import { useCallback, useMemo, useState } from 'react';
import { api } from '../api/client';
import type {
  AbsenceCreche,
  ContratBesoinsSemaine,
  EcrireSemaineBesoins,
  ExceptionAbcm,
  JourAlsh,
  JourSupplementaire,
  PlageHoraire,
  StatutNotification,
} from '../types/bff';
import {
  jourSemaineDeIso,
  formaterDateFr,
  LIBELLES_JOURS,
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
import { RelectureEnvoi } from './RelectureEnvoi';
import { useEcritureSemaine } from './useEcritureSemaine';

// Édition des besoins **datés** d'un contrat sur la seule semaine notifiée.
// Contrairement aux calendriers mensuels, la vue hebdomadaire ne connaît pas la
// semaine-type du contrat (le BFF ne renvoie que les entrées datées) : on édite
// donc directement ces entrées, jour par jour, sans repère « jour gardé ».

interface AbsenceEtat extends PlageHoraire {
  date: string;
  preavisJours: number;
  certificatMaladie: boolean;
}

interface JourSupEtat extends PlageHoraire {
  date: string;
}

interface AlshEtat {
  date: string;
  type: 'COMPLETE' | 'DEMI';
  repas: boolean;
}

interface BesoinsEtat {
  absences: AbsenceEtat[];
  joursSup: JourSupEtat[];
  exceptions: ExceptionAbcm[];
  joursAlsh: AlshEtat[];
}

/** Aplati les besoins datés de la semaine (par jour) en listes par catégorie. */
function initBesoins(contrat: ContratBesoinsSemaine): BesoinsEtat {
  const absences: AbsenceEtat[] = [];
  const joursSup: JourSupEtat[] = [];
  const exceptions: ExceptionAbcm[] = [];
  const joursAlsh: AlshEtat[] = [];
  for (const jour of Object.values(contrat.besoins)) {
    for (const a of jour.absences) {
      if (a.date === undefined) continue;
      absences.push({
        date: a.date,
        debutHeures: a.debutHeures,
        debutMinutes: a.debutMinutes,
        finHeures: a.finHeures,
        finMinutes: a.finMinutes,
        preavisJours: a.preavisJours,
        certificatMaladie: a.certificatMaladie,
      });
    }
    for (const j of jour.joursSupplementaires) {
      joursSup.push({
        date: j.date,
        debutHeures: j.debutHeures,
        debutMinutes: j.debutMinutes,
        finHeures: j.finHeures,
        finMinutes: j.finMinutes,
      });
    }
    exceptions.push(...jour.exceptions);
    for (const j of jour.joursAlsh) {
      joursAlsh.push({ date: j.date, type: j.type, repas: j.repas ?? false });
    }
  }
  return { absences, joursSup, exceptions, joursAlsh };
}

/** Corps d'écriture (catégories datées non vides) depuis l'état d'édition. */
function versCorps(etat: BesoinsEtat): EcrireSemaineBesoins {
  const absences: AbsenceCreche[] = etat.absences.map((a) => ({
    date: a.date,
    debutHeures: a.debutHeures,
    debutMinutes: a.debutMinutes,
    finHeures: a.finHeures,
    finMinutes: a.finMinutes,
    preavisJours: a.preavisJours,
    certificatMaladie: a.certificatMaladie,
  }));
  const joursSupplementaires: JourSupplementaire[] = etat.joursSup.map((j) => ({
    date: j.date,
    debutHeures: j.debutHeures,
    debutMinutes: j.debutMinutes,
    finHeures: j.finHeures,
    finMinutes: j.finMinutes,
  }));
  const joursAlsh: JourAlsh[] = etat.joursAlsh.map((j) => ({
    date: j.date,
    type: j.type,
    ...(j.repas ? { repas: j.repas } : {}),
  }));
  return {
    ...(joursSupplementaires.length > 0 ? { joursSupplementaires } : {}),
    ...(absences.length > 0 ? { absences } : {}),
    ...(etat.exceptions.length > 0 ? { exceptions: etat.exceptions } : {}),
    ...(joursAlsh.length > 0 ? { joursAlsh } : {}),
  };
}

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

  const resume = useCallback(
    (date: string): string => {
      if (mode === 'CRECHE_PSU') {
        const abs = absenceParDate.get(date);
        if (abs) return `Absent (${formaterPlage(abs)})`;
        const sup = jourSupParDate.get(date);
        if (sup) return `Jour ajouté (${formaterPlage(sup)})`;
        return '—';
      }
      if (mode === 'ALSH') {
        const j = alshParDate.get(date);
        if (!j) return '—';
        if (j.type === 'DEMI') return 'Demi-journée';
        return j.repas ? 'Journée + repas' : 'Journée';
      }
      const e = exceptionParDate.get(date);
      if (!e) return '—';
      if (mode === 'CANTINE') return e.cantine ? 'Cantine' : 'Sans cantine';
      const parts: string[] = [];
      if (e.periMatin) parts.push('matin');
      if (e.periSoir) parts.push('soir');
      return parts.length > 0 ? `Péri ${parts.join(' + ')}` : 'Sans péri';
    },
    [mode, absenceParDate, jourSupParDate, alshParDate, exceptionParDate],
  );

  // --- Validation par contrat (comportement inchangé) -----------------------
  const [validation, setValidation] = useState<StatutNotification | null>(null);
  const [messageValidation, setMessageValidation] = useState<string | null>(
    null,
  );
  const [enValidation, setEnValidation] = useState(false);

  const valider = useCallback(async () => {
    setEnValidation(true);
    setMessageValidation(null);
    try {
      const r = await api.validerSemaine(contrat.contratId, semaineIso);
      setValidation(r.statut);
      setMessageValidation(
        r.statut === 'VALIDEE_AVEC_MODIFS'
          ? 'Semaine validée (avec modifications).'
          : 'Semaine validée.',
      );
    } catch (err) {
      setMessageValidation(messageErreur(err));
    } finally {
      setEnValidation(false);
    }
  }, [contrat.contratId, semaineIso]);

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

      <ul style={{ listStyle: 'none', margin: '0.25rem 0', padding: 0 }}>
        {jours.map((date) => {
          const libelleJour = `${LIBELLES_JOURS[jourSemaineDeIso(date)]} ${formaterDateFr(date)}`;
          return (
            <li
              key={date}
              style={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '0.5rem',
                padding: '0.2rem 0',
              }}
            >
              <span style={{ minWidth: '11rem' }}>{libelleJour}</span>
              <span className="muted" style={{ fontSize: '0.82rem' }}>
                {resume(date)}
              </span>
              <button
                type="button"
                className="btn secondaire"
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

      {validation === 'VALIDEE_AVEC_MODIFS' && (
        <RelectureEnvoi contratId={contrat.contratId} semaineIso={semaineIso} />
      )}

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
